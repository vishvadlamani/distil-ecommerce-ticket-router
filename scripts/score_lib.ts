/** Shared scoring of a prediction file against the 64-row v6 test set, by slice.
 *
 * Accepts a platform predictions JSONL (prompt, completion, prediction, per-metric
 * scores) or the per-row JSONL our runners write (prompt, ref, prediction,
 * latency_ms, usage). Rows match test rows by rendered user prompt; the first 24
 * test rows are the curated slice, the remaining 40 the real slice.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { scoreOne, summarize, type FieldScore } from "../src/scoring.ts";
import { wilson, pctile } from "./stats.ts";

export const ROOT = join(import.meta.dirname ?? ".", "..");
export const N_CURATED = 24;

export interface TestRow { idx: number; slice: "curated" | "real"; prompt: string; ref: any }
export async function loadTest(): Promise<TestRow[]> {
  const rows = (await readFile(join(ROOT, "platform-v6", "test.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  return rows.map((r, i) => ({ idx: i, slice: i < N_CURATED ? "curated" : "real", prompt: r.messages[0].content, ref: JSON.parse(r.messages[1].content) }));
}

const content = (v: any): string => (typeof v === "string" ? v : Array.isArray(v) ? content(v[0]) : (v?.content ?? ""));

export interface ScoredRow { idx: number; slice: string; s: FieldScore; raw: string; latency_ms: number | null; judge: number | null; inTok: number; outTok: number }
export interface SliceReport { n: number; n_expected: number; pass: number; p: number; lo: number; hi: number; json_valid: number; platform_judge_mean: number | null; fields: Record<string, string>; latency_p50: number | null; latency_p95: number | null; in_tok: number; out_tok: number }
export interface FileReport { file: string; n_predictions: number; unmatched: number; missing: number[]; slices: Record<"curated" | "real" | "blended", SliceReport>; rows: ScoredRow[] }

export async function scoreFile(file: string): Promise<FileReport> {
  const test = await loadTest();
  const byPrompt = new Map(test.map((t) => [t.prompt, t]));
  const preds = (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const rows: ScoredRow[] = [];
  let unmatched = 0;
  for (const p of preds) {
    const t = byPrompt.get(content(p.prompt));
    if (!t) { unmatched++; continue; }
    const u = p.usage ?? {};
    rows.push({
      idx: t.idx, slice: t.slice, s: scoreOne(t.ref, content(p.prediction)), raw: content(p.prediction),
      latency_ms: typeof p.latency_ms === "number" ? p.latency_ms : null,
      judge: typeof p["llm-as-a-judge"] === "number" ? p["llm-as-a-judge"] : null,
      inTok: u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount ?? 0,
      outTok: u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount ?? 0,
    });
  }
  rows.sort((a, b) => a.idx - b.idx);
  const seen = new Set(rows.map((r) => r.idx));
  const missing = test.map((t) => t.idx).filter((i) => !seen.has(i));
  const slice = (name: "curated" | "real" | "blended"): SliceReport => {
    const g = name === "blended" ? rows : rows.filter((r) => r.slice === name);
    const nExpected = name === "blended" ? test.length : name === "curated" ? N_CURATED : test.length - N_CURATED;
    const pass = g.filter((r) => r.s.judgePass).length;
    const w = wilson(pass, g.length);
    const judge = g.map((r) => r.judge).filter((v): v is number => v !== null);
    const lat = g.map((r) => r.latency_ms).filter((v): v is number => v !== null);
    return {
      n: g.length, n_expected: nExpected, pass, p: w.p, lo: w.lo, hi: w.hi,
      json_valid: g.filter((r) => r.s.schema).length,
      platform_judge_mean: judge.length ? judge.reduce((a, b) => a + b, 0) / judge.length : null,
      fields: summarize(g.map((r) => r.s)),
      latency_p50: lat.length ? pctile(lat, 50) : null, latency_p95: lat.length ? pctile(lat, 95) : null,
      in_tok: g.length ? g.reduce((a, r) => a + r.inTok, 0) / g.length : 0, out_tok: g.length ? g.reduce((a, r) => a + r.outTok, 0) / g.length : 0,
    };
  };
  return { file, n_predictions: preds.length, unmatched, missing, slices: { curated: slice("curated"), real: slice("real"), blended: slice("blended") }, rows };
}
