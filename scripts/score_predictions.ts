/** Score a prediction file against the 64-row v6 test set, by slice (curated 24 /
 * real 40 / blended 64), with 95% Wilson intervals. See score_lib.ts for inputs.
 *
 * Usage: bun scripts/score_predictions.ts <predictions.jsonl> [--name <label>] [--json <out.json>] [--misses]
 */
import { writeFile } from "node:fs/promises";
import { scoreFile, loadTest } from "./score_lib.ts";
import { fmtCorrect } from "./stats.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) { console.error("usage: bun scripts/score_predictions.ts <predictions.jsonl> [--name x] [--json out] [--misses]"); process.exit(2); }
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const NAME = opt("name") ?? file;

const r = await scoreFile(file);
for (const slice of ["curated", "real", "blended"] as const) {
  const s = r.slices[slice];
  console.log(`[${NAME}] ${slice.padEnd(7)} correct ${fmtCorrect(s.pass, s.n)}${s.n !== s.n_expected ? ` (expected n=${s.n_expected})` : ""} | json ${s.json_valid}/${s.n} | intent ${s.fields.intent} order_id ${s.fields.order_id} needs_human ${s.fields.needs_human} urgency±1 ${s.fields.urgency_within1} action_ok ${s.fields.action_allowed}${s.platform_judge_mean !== null ? ` | platform judge ${(100 * s.platform_judge_mean).toFixed(1)}%` : ""}${s.latency_p50 !== null ? ` | p50 ${s.latency_p50.toFixed(0)}ms p95 ${s.latency_p95!.toFixed(0)}ms` : ""}`);
}
if (r.unmatched || r.missing.length) console.log(`  unmatched predictions: ${r.unmatched}; test rows without a prediction: ${r.missing.join(",") || "none"}`);
if (args.includes("--misses")) {
  const test = await loadTest();
  for (const x of r.rows.filter((x) => !x.s.judgePass || x.s.deviations.length)) {
    const prompt = test[x.idx].prompt;
    const subj = /Subject: (.*)/.exec(prompt)?.[1];
    const body = (/Body:\n([\s\S]*?)\n"""/.exec(prompt)?.[1] ?? "").slice(0, 60).replace(/\n/g, " ");
    console.log(`  ${x.s.judgePass ? "pass" : "FAIL"} #${String(x.idx).padStart(2, "0")} ${x.slice.padEnd(7)} "${subj === "(no subject)" ? body : subj}": ${x.s.deviations.join("; ")}`);
  }
}
const out = opt("json");
if (out) { const { rows, ...rest } = r; await writeFile(out, JSON.stringify({ name: NAME, ...rest }, null, 2) + "\n"); }
