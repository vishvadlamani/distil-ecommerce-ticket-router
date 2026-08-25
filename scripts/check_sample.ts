/** Validate a `distil training-dataset sample` dump: parse every assistant
 * JSON, check schema + action coherence + escalate/no_action invariants +
 * order_id-verbatim-in-prompt, report label distribution. Input: file path. */
import { readFile } from "node:fs/promises";
import { ACTION_TABLE, RouterOutputSchema, INTENTS } from "../src/types.ts";

const raw = await readFile(process.argv[2], "utf8");
// The sample output is pretty-printed JSON objects separated by blank lines,
// possibly with a header line and hard line-wraps. Recover objects by brace
// matching on the whole text.
const objects: string[] = [];
let depth = 0, start = -1, inStr = false, esc = false;
for (let i = 0; i < raw.length; i++) {
  const c = raw[i];
  if (esc) { esc = false; continue; }
  if (c === "\\") { esc = true; continue; }
  if (c === '"') inStr = !inStr;
  if (inStr) continue;
  if (c === "{") { if (depth === 0) start = i; depth++; }
  if (c === "}") { depth--; if (depth === 0 && start >= 0) { objects.push(raw.slice(start, i + 1)); start = -1; } }
}

let total = 0, parsedOk = 0;
const errors: string[] = [];
const intentCounts = new Map<string, number>();
const seenPrompts = new Set<string>();
let dupPrompts = 0;

for (const objText of objects) {
  let obj: any;
  try {
    obj = JSON.parse(objText.replace(/\n/g, "\\n"));
  } catch {
    // pretty-printed with real newlines inside strings from terminal wrapping:
    // try stripping newlines + surrounding spaces instead
    try {
      obj = JSON.parse(objText.replace(/\n\s*/g, ""));
    } catch {
      continue;
    }
  }
  if (!obj?.messages || obj.messages.length < 2) continue;
  total++;
  const user = String(obj.messages[0].content ?? "");
  const asst = String(obj.messages[1].content ?? "");
  if (seenPrompts.has(user)) dupPrompts++;
  seenPrompts.add(user);

  let out: any;
  try {
    out = JSON.parse(asst);
  } catch {
    errors.push(`row ${total}: assistant not valid JSON: ${asst.slice(0, 80)}`);
    continue;
  }
  const v = RouterOutputSchema.safeParse(out);
  if (!v.success) { errors.push(`row ${total}: schema fail: ${asst.slice(0, 100)}`); continue; }
  parsedOk++;
  intentCounts.set(out.intent, (intentCounts.get(out.intent) ?? 0) + 1);

  if (!ACTION_TABLE[out.intent as keyof typeof ACTION_TABLE].includes(out.suggested_action))
    errors.push(`row ${total}: action ${out.suggested_action} not allowed for ${out.intent}`);
  if ((out.suggested_action === "escalate_to_agent" || out.suggested_action === "escalate_to_billing") && !out.needs_human)
    errors.push(`row ${total}: escalate without needs_human`);
  if (out.suggested_action === "no_action" && out.needs_human)
    errors.push(`row ${total}: no_action with needs_human`);
  if (out.order_id !== null && !user.includes(out.order_id))
    errors.push(`row ${total}: order_id ${out.order_id} not found in prompt`);
}

console.log(`rows recovered: ${total}, schema-valid: ${parsedOk}, duplicate prompts: ${dupPrompts}`);
console.log(`intent distribution: ${INTENTS.map((i) => `${i}=${intentCounts.get(i) ?? 0}`).join(" ")}`);
if (errors.length) {
  console.log(`ERRORS (${errors.length}):`);
  for (const e of errors.slice(0, 25)) console.log(`  - ${e}`);
} else {
  console.log("no coherence errors");
}
