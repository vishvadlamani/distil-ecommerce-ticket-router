/** Field-level diff of platform predictions vs the hand-authored test rows.
 * Usage: bun scripts/analyze_predictions.ts <predictions.jsonl>
 * Prediction rows are matched to test rows by rendered user prompt. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ACTION_TABLE, RouterOutputSchema } from "../src/types.ts";
import { cleanJsonOutput } from "../src/router.ts";

const ROOT = join(import.meta.dirname ?? ".", "..");
const testRows = (await readFile(join(ROOT, "platform", "test.jsonl"), "utf8"))
  .trim().split("\n").map((l) => JSON.parse(l));
const refByPrompt = new Map<string, any>(
  testRows.map((r) => [r.messages[0].content, JSON.parse(r.messages[1].content)]),
);

const predLines = (await readFile(process.argv[2], "utf8")).trim().split("\n").map((l) => JSON.parse(l));

let n = 0, schemaOk = 0, intentOk = 0, orderOk = 0, humanOk = 0, actionExact = 0, actionAllowed = 0, sentimentOk = 0;
let urgencyWithin1 = 0, urgencyExact = 0, judgePassEquiv = 0;
const misses: string[] = [];

const content = (v: any): string => (typeof v === "string" ? v : (v?.content ?? ""));
for (const p of predLines) {
  const prompt: string = content(Array.isArray(p.prompt) ? p.prompt[0] : p.prompt);
  const rawPred: string = content(p.prediction);
  const refRaw: string = content(p.completion);
  let ref: any = refByPrompt.get(prompt) ?? null;
  if (!ref && refRaw) { try { ref = JSON.parse(refRaw); } catch { /* fall through */ } }
  if (!ref) { console.log(`UNMATCHED prediction row (keys: ${Object.keys(p).join(",")})`); continue; }
  n++;
  let out: any = null;
  try { out = RouterOutputSchema.parse(JSON.parse(cleanJsonOutput(rawPred))); schemaOk++; } catch { misses.push(`row ${n}: SCHEMA FAIL: ${String(rawPred).slice(0, 120)}`); continue; }

  const fieldMiss: string[] = [];
  if (out.intent === ref.intent) intentOk++; else fieldMiss.push(`intent ${out.intent} vs ${ref.intent}`);
  if (out.order_id === ref.order_id) orderOk++; else fieldMiss.push(`order_id ${out.order_id} vs ${ref.order_id}`);
  if (out.needs_human === ref.needs_human) humanOk++; else fieldMiss.push(`needs_human ${out.needs_human} vs ${ref.needs_human}`);
  if (out.sentiment === ref.sentiment) sentimentOk++; else fieldMiss.push(`sentiment ${out.sentiment} vs ${ref.sentiment}`);
  if (out.urgency === ref.urgency) { urgencyExact++; urgencyWithin1++; }
  else if (Math.abs(out.urgency - ref.urgency) <= 1) { urgencyWithin1++; fieldMiss.push(`urgency ${out.urgency} vs ${ref.urgency} (within 1)`); }
  else fieldMiss.push(`URGENCY ${out.urgency} vs ${ref.urgency} (off by ${Math.abs(out.urgency - ref.urgency)})`);
  if (out.suggested_action === ref.suggested_action) { actionExact++; actionAllowed++; }
  else if ((ACTION_TABLE[ref.intent as keyof typeof ACTION_TABLE] ?? []).includes(out.suggested_action)) { actionAllowed++; fieldMiss.push(`action ${out.suggested_action} vs ${ref.suggested_action} (allowed)`); }
  else fieldMiss.push(`ACTION ${out.suggested_action} vs ${ref.suggested_action} (not allowed for ${ref.intent})`);

  const judgePass = out.intent === ref.intent && out.order_id === ref.order_id && out.needs_human === ref.needs_human
    && Math.abs(out.urgency - ref.urgency) <= 1
    && (out.suggested_action === ref.suggested_action || (ACTION_TABLE[ref.intent as keyof typeof ACTION_TABLE] ?? []).includes(out.suggested_action));
  if (judgePass) judgePassEquiv++;

  if (fieldMiss.length) {
    const subj = /Subject: (.*)/.exec(prompt)?.[1] ?? prompt.slice(0, 40);
    misses.push(`[${judgePass ? "pass" : "FAIL"}] "${subj}" ref=${ref.intent}: ${fieldMiss.join("; ")}`);
  }
}

console.log(`n=${n} schema=${schemaOk} intent=${intentOk} order_id=${orderOk} needs_human=${humanOk} sentiment=${sentimentOk}`);
console.log(`urgency exact=${urgencyExact} within1=${urgencyWithin1} action exact=${actionExact} allowed=${actionAllowed}`);
console.log(`judge-equivalent pass: ${judgePassEquiv}/${n}`);
console.log(`--- deviations ---`);
for (const m of misses) console.log(m);
