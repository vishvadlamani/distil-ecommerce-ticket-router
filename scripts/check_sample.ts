/** Sample gate / dataset audit for generated data (round 2: audit only, never rewrite).
 *
 * Input: a JSONL file of {messages:[user, assistant]} rows (a `distil dataset
 * download` train.jsonl) or the pretty-printed objects an older CLI printed.
 * Every row is parsed, schema-checked and audited against the contract's rules
 * (scripts/contract_rules.ts). Prints per-rule counts, the violation rate and
 * the label/metadata distribution.
 *
 * Usage: bun scripts/check_sample.ts <file> [--skip N] [--show K]
 *   --skip N   ignore the first N rows (the parent dataset's rows; a generated
 *              dataset lists the parent's rows first, then the new ones)
 *   --show K   print up to K example violations per rule (default 3)
 */
import { readFile } from "node:fs/promises";
import { ACTION_TABLE, RouterOutputSchema, INTENTS, ACTIONS } from "../src/types.ts";
import { auditRow, HARD_RULES } from "./contract_rules.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) { console.error("usage: bun scripts/check_sample.ts <file> [--skip N] [--show K]"); process.exit(2); }
const opt = (n: string, d: number) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };
const SKIP = opt("skip", 0), SHOW = opt("show", 3);

const raw = await readFile(file, "utf8");
let objects: any[] = [];
const lines = raw.split("\n").filter((l) => l.trim());
if (lines.every((l) => l.trim().startsWith("{") && l.trim().endsWith("}"))) {
  objects = lines.map((l) => JSON.parse(l));
} else {
  // pretty-printed objects: recover by brace matching
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') inStr = !inStr;
    if (inStr) continue;
    if (c === "{") { if (depth === 0) start = i; depth++; }
    if (c === "}") { depth--; if (depth === 0 && start >= 0) { try { objects.push(JSON.parse(raw.slice(start, i + 1))); } catch { /* skip */ } start = -1; } }
  }
}
objects = objects.slice(SKIP);

const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const ruleCounts = new Map<string, number>(), softCounts = new Map<string, number>(), formatCounts = new Map<string, number>();
const examples = new Map<string, string[]>();
const intents = new Map<string, number>(), actions = new Map<string, number>(), statuses = new Map<string, number>(), channels = new Map<string, number>();
let total = 0, badJson = 0, badSchema = 0, rowsHard = 0, rowsSoft = 0, rowsFormat = 0, human = 0, prev2 = 0, dup = 0, noMeta = 0;
const seen = new Set<string>();
const bodyLens: number[] = [];

for (const obj of objects) {
  if (!obj?.messages || obj.messages.length < 2) continue;
  total++;
  const user = String(obj.messages[0].content ?? "");
  const asst = String(obj.messages.at(-1).content ?? "");
  if (seen.has(user)) dup++;
  seen.add(user);
  const ch = /Channel: (\S+)/.exec(user)?.[1] ?? "?"; count(channels, ch);
  const body = /Body:\n([\s\S]*?)\n"""/.exec(user)?.[1] ?? ""; bodyLens.push(body.length);

  let out: any;
  try { out = JSON.parse(asst); } catch { badJson++; continue; }
  const v = RouterOutputSchema.safeParse(out);
  if (!v.success) { badSchema++; count(ruleCounts, "schema_invalid"); (examples.get("schema_invalid") ?? examples.set("schema_invalid", []).get("schema_invalid")!).push(asst.slice(0, 140)); continue; }
  const o = v.data;
  count(intents, o.intent); count(actions, o.suggested_action);
  if (o.needs_human) human++;

  const a = auditRow(user, o);
  if (!a.meta) noMeta++; else { count(statuses, a.meta.status); if (a.meta.prev >= 2) prev2++; }
  const tag = (rule: string) => rule.split(":")[0];
  for (const r of a.violations) { count(ruleCounts, tag(r)); const ex = examples.get(tag(r)) ?? []; if (ex.length < SHOW) ex.push(`${r} | ${o.intent}/${o.suggested_action}/h=${o.needs_human} | ${a.meta?.raw.replace(/\n/g, " ") ?? "no meta"} | ${body.slice(0, 90).replace(/\n/g, " ")}`); examples.set(tag(r), ex); }
  for (const r of a.soft) { count(softCounts, r); const ex = examples.get(r) ?? []; if (ex.length < SHOW) ex.push(`${o.intent}/${o.suggested_action}/h=${o.needs_human} | ${a.meta?.raw.replace(/\n/g, " ") ?? "no meta"} | ${body.slice(0, 90).replace(/\n/g, " ")}`); examples.set(r, ex); }
  for (const r of a.format) { count(formatCounts, tag(r)); const ex = examples.get(tag(r)) ?? []; if (ex.length < SHOW) ex.push(`${r} | ${user.slice(0, 160).replace(/\n/g, "\\n")}`); examples.set(tag(r), ex); }
  if (a.violations.length) rowsHard++;
  if (a.soft.length) rowsSoft++;
  if (a.format.length) rowsFormat++;
}

const pct = (n: number) => `${((100 * n) / Math.max(1, total)).toFixed(1)}%`;
const fmt = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ");
bodyLens.sort((a, b) => a - b);
console.log(`rows=${total} (skipped ${SKIP}) bad_json=${badJson} bad_schema=${badSchema} duplicate_prompts=${dup} no_metadata_block=${noMeta}`);
console.log(`HARD violations: rows=${rowsHard} (${pct(rowsHard)})  ${fmt(ruleCounts) || "none"}`);
console.log(`FORMAT issues:   rows=${rowsFormat} (${pct(rowsFormat)})  ${fmt(formatCounts) || "none"}`);
console.log(`SOFT flags:      rows=${rowsSoft} (${pct(rowsSoft)})  ${fmt(softCounts) || "none"}`);
console.log(`needs_human=${human}/${total} (${pct(human)}) prev>=2 rows=${prev2}`);
console.log(`intents:  ${INTENTS.map((i) => `${i}=${intents.get(i) ?? 0}`).join(" ")}`);
console.log(`actions:  ${ACTIONS.map((a) => `${a}=${actions.get(a) ?? 0}`).join(" ")}`);
console.log(`statuses: ${fmt(statuses)}`);
console.log(`channels: ${fmt(channels)}`);
console.log(`body chars: p10=${bodyLens[Math.floor(bodyLens.length * 0.1)] ?? 0} p50=${bodyLens[Math.floor(bodyLens.length * 0.5)] ?? 0} p90=${bodyLens[Math.floor(bodyLens.length * 0.9)] ?? 0}`);
for (const [rule, ex] of examples) { console.log(`--- ${rule} (${ruleCounts.get(rule) ?? softCounts.get(rule) ?? formatCounts.get(rule)})`); for (const e of ex) console.log(`    ${e}`); }
console.log(`GATE: hard-violation rate ${pct(rowsHard)} over ${total} rows (hard rules: ${HARD_RULES.join(", ")})`);
