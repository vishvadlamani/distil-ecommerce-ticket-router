/** Build the round-2 results table from prediction files, correct-of-n with 95%
 * Wilson intervals on curated 24 / real 40 / blended 64, plus JSON validity,
 * latency and cost per 1,000 tickets.
 *
 * Input: a manifest JSON, a list of rows:
 *   { "name": "Tuned Qwen3-1.7B", "file": "results/slm-1p7b-predictions.jsonl",
 *     "cost_per_1000": 0.0123, "cost_note": "measured: $3/h at 67.7 rps",
 *     "latency_file": "results/endpoint-1p7b.jsonl" }        // optional: latency from another file
 * Usage: bun scripts/results_table.ts results/manifest.json [--md results/RESULTS.md]
 */
import { readFile, writeFile } from "node:fs/promises";
import { scoreFile } from "./score_lib.ts";

const args = process.argv.slice(2);
const manifestPath = args.find((a) => !a.startsWith("--"));
if (!manifestPath) { console.error("usage: bun scripts/results_table.ts <manifest.json> [--md out.md]"); process.exit(2); }
const mdOut = (() => { const i = args.indexOf("--md"); return i >= 0 ? args[i + 1] : null; })();
const manifest: { name: string; file: string; cost_per_1000?: number | null; cost_note?: string; latency_file?: string }[] = JSON.parse(await readFile(manifestPath, "utf8"));

const cell = (s: { pass: number; n: number; lo: number; hi: number }) => `${s.pass}/${s.n} (${(100 * s.pass / Math.max(1, s.n)).toFixed(1)}%, ${(100 * s.lo).toFixed(0)}–${(100 * s.hi).toFixed(0)})`;
const lines: string[] = [];
lines.push(`| Model | Curated 24 | Real 40 | Blended 64 | Valid JSON (64) | Latency p50 / p95 | Cost per 1,000 tickets |`);
lines.push(`|---|---|---|---|---|---|---|`);
for (const m of manifest) {
  const r = await scoreFile(m.file);
  const lat = m.latency_file ? (await scoreFile(m.latency_file)).slices.blended : r.slices.blended;
  const latency = lat.latency_p50 !== null ? `${(lat.latency_p50 / 1000).toFixed(2)} s / ${(lat.latency_p95! / 1000).toFixed(2)} s` : "n/a";
  const cost = m.cost_per_1000 != null ? `$${m.cost_per_1000.toFixed(4)}${m.cost_note ? ` (${m.cost_note})` : ""}` : (m.cost_note ?? "n/a");
  lines.push(`| ${m.name} | ${cell(r.slices.curated)} | ${cell(r.slices.real)} | ${cell(r.slices.blended)} | ${r.slices.blended.json_valid}/${r.slices.blended.n} | ${latency} | ${cost} |`);
  if (r.unmatched || r.missing.length) lines.push(`| | unmatched ${r.unmatched}, missing test rows ${r.missing.join(",")} | | | | | |`);
}
lines.push(``);
lines.push(`Correct = intent, order_id and needs_human exact, urgency within 1, action allowed for the intent (the platform judge's rules, scored locally by src/scoring.ts). Intervals are 95% Wilson.`);
const md = lines.join("\n") + "\n";
console.log(md);
if (mdOut) await writeFile(mdOut, md);
