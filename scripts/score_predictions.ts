/** Score a prediction file against the 64-row v6 test set, by slice.
 *
 * Accepts either a platform predictions JSONL (`distil teacher-evaluation
 * download-predictions`, `distil slm download-predictions`: rows with prompt,
 * completion, prediction and per-metric scores) or the per-row JSONL our own
 * runners write (eval_external.ts, endpoint_eval.ts: rows with prompt, ref,
 * prediction). Rows are matched to test rows by rendered user prompt; the
 * slice (curated / real) comes from the test set order (first 24 curated).
 *
 * Usage: bun scripts/score_predictions.ts <predictions.jsonl> [--name <label>] [--json <out.json>] [--misses]
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scoreOne, summarize, type FieldScore } from "../src/scoring.ts";
import { fmtCorrect, wilson } from "./stats.ts";

const ROOT = join(import.meta.dirname ?? ".", "..");
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) { console.error("usage: bun scripts/score_predictions.ts <predictions.jsonl> [--name x] [--json out] [--misses]"); process.exit(2); }
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const NAME = opt("name") ?? file;
const JSON_OUT = opt("json");
const MISSES = args.includes("--misses");

const testRows = (await readFile(join(ROOT, "platform-v6", "test.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
const N_CURATED = 24;
const refByPrompt = new Map<string, { ref: any; idx: number; slice: "curated" | "real" }>();
testRows.forEach((r, i) => refByPrompt.set(r.messages[0].content, { ref: JSON.parse(r.messages[1].content), idx: i, slice: i < N_CURATED ? "curated" : "real" }));

const content = (v: any): string => (typeof v === "string" ? v : Array.isArray(v) ? content(v[0]) : (v?.content ?? ""));
const preds = (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

interface Scored { idx: number; slice: string; s: FieldScore; raw: string; ms?: number; judge?: number }
const scored: Scored[] = [];
let unmatched = 0;
for (const p of preds) {
  const prompt = content(p.prompt);
  const hit = refByPrompt.get(prompt);
  if (!hit) { unmatched++; continue; }
  const raw = content(p.prediction);
  scored.push({ idx: hit.idx, slice: hit.slice, s: scoreOne(hit.ref, raw), raw, ms: p.latency_ms, judge: p["llm-as-a-judge"] });
}
scored.sort((a, b) => a.idx - b.idx);
const seen = new Set(scored.map((x) => x.idx));
const missing = testRows.map((_, i) => i).filter((i) => !seen.has(i));

const report: Record<string, any> = { name: NAME, file, n_predictions: preds.length, unmatched, missing_test_rows: missing };
for (const slice of ["curated", "real", "blended"]) {
  const g = slice === "blended" ? scored : scored.filter((x) => x.slice === slice);
  const nExpected = slice === "blended" ? testRows.length : slice === "curated" ? N_CURATED : testRows.length - N_CURATED;
  const pass = g.filter((x) => x.s.judgePass).length;
  const valid = g.filter((x) => x.s.schema).length;
  const sum = summarize(g.map((x) => x.s));
  const judgeVals = g.map((x) => x.judge).filter((v): v is number => typeof v === "number");
  report[slice] = {
    n: g.length, n_expected: nExpected, pass, pass_rate: wilson(pass, g.length), json_valid: valid,
    platform_judge_mean: judgeVals.length ? judgeVals.reduce((a, b) => a + b, 0) / judgeVals.length : null,
    fields: sum,
  };
  console.log(`[${NAME}] ${slice.padEnd(7)} correct ${fmtCorrect(pass, g.length)}${g.length !== nExpected ? ` (expected n=${nExpected})` : ""} | json ${valid}/${g.length} | intent ${sum.intent} order_id ${sum.order_id} needs_human ${sum.needs_human} urgency±1 ${sum.urgency_within1} action_ok ${sum.action_allowed}${judgeVals.length ? ` | platform judge ${(100 * report[slice].platform_judge_mean).toFixed(1)}% (n=${judgeVals.length})` : ""}`);
}
if (unmatched || missing.length) console.log(`  unmatched predictions: ${unmatched}; test rows without a prediction: ${missing.join(",") || "none"}`);
if (MISSES) {
  for (const x of scored.filter((x) => !x.s.judgePass || x.s.deviations.length)) {
    const subj = /Subject: (.*)/.exec(testRows[x.idx].messages[0].content)?.[1];
    const body = (/Body:\n([\s\S]*?)\n"""/.exec(testRows[x.idx].messages[0].content)?.[1] ?? "").slice(0, 60).replace(/\n/g, " ");
    console.log(`  ${x.s.judgePass ? "pass" : "FAIL"} #${String(x.idx).padStart(2, "0")} ${x.slice} "${subj === "(no subject)" ? body : subj}": ${x.s.deviations.join("; ")}`);
  }
}
if (JSON_OUT) await writeFile(JSON_OUT, JSON.stringify(report, null, 2) + "\n");
