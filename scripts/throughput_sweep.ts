/** Throughput sweep against an OpenAI-compatible chat endpoint (the platform
 * deployment's vLLM server, or any /v1/chat/completions server).
 *
 * Sends the 64 real test prompts (cycled) with the trained system prompt,
 * temperature 0, thinking off, at fixed concurrency levels, and reports
 * requests per second, p50/p95 latency, output tokens and JSON validity per
 * level. Cost per 1,000 tickets = hourly price / (RPS x 3.6).
 *
 * Usage:
 *   bun scripts/throughput_sweep.ts --base-url https://host/v1 --api-key KEY \
 *     [--model model] [--levels 8,16,32,64] [--requests 256] [--hourly 3] [--out sweep.jsonl]
 *
 * --requests is the number of requests per level (at least 4x the level, so
 * the measurement covers several full waves); a 10-request warm-up precedes
 * the first level. Every level runs on the same prompts in the same order.
 */
import { readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { ROUTER_SYSTEM, cleanJsonOutput } from "../src/router.ts";
import { RouterOutputSchema } from "../src/types.ts";
import { pctile } from "./stats.ts";

const ROOT = join(import.meta.dirname ?? ".", "..");
const args = process.argv.slice(2);
const opt = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = opt("base-url", "").replace(/\/$/, "");
const KEY = opt("api-key", process.env.DISTIL_DEPLOYMENT_KEY ?? "EMPTY");
const MODEL = opt("model", "model");
const LEVELS = opt("levels", "8,16,32,64").split(",").map(Number);
const REQUESTS = Number(opt("requests", "256"));
const HOURLY = Number(opt("hourly", "0"));
const OUT = opt("out", "");
const MAX_TOKENS = Number(opt("max-tokens", "160"));
if (!BASE) { console.error("--base-url required"); process.exit(2); }

const prompts = (await readFile(join(ROOT, "platform-v6", "test.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l).messages[0].content as string);

interface R { ms: number; ok: boolean; valid: boolean; outTokens: number; status: number }
async function one(prompt: string): Promise<R> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: ROUTER_SYSTEM }, { role: "user", content: prompt }],
        temperature: 0, max_tokens: MAX_TOKENS,
        chat_template_kwargs: { enable_thinking: false },
      }),
    });
    const ms = performance.now() - t0;
    if (!res.ok) { await res.text(); return { ms, ok: false, valid: false, outTokens: 0, status: res.status }; }
    const j: any = await res.json();
    const text: string = j.choices?.[0]?.message?.content ?? "";
    let valid = false;
    try { RouterOutputSchema.parse(JSON.parse(cleanJsonOutput(text))); valid = true; } catch { /* invalid */ }
    return { ms, ok: true, valid, outTokens: j.usage?.completion_tokens ?? 0, status: res.status };
  } catch (e) {
    return { ms: performance.now() - t0, ok: false, valid: false, outTokens: 0, status: 0 };
  }
}

async function level(conc: number, n: number): Promise<{ rps: number; p50: number; p95: number; errors: number; valid: number; tokens: number; wall: number }> {
  const results: R[] = [];
  let next = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: conc }, async () => {
    while (true) {
      const i = next++;
      if (i >= n) return;
      results.push(await one(prompts[i % prompts.length]));
    }
  }));
  const wall = (performance.now() - t0) / 1000;
  const ok = results.filter((r) => r.ok);
  return {
    rps: ok.length / wall, p50: pctile(ok.map((r) => r.ms), 50), p95: pctile(ok.map((r) => r.ms), 95),
    errors: results.length - ok.length, valid: results.filter((r) => r.valid).length,
    tokens: ok.reduce((a, r) => a + r.outTokens, 0) / Math.max(1, ok.length), wall,
  };
}

console.log(`endpoint=${BASE} model=${MODEL} prompts=${prompts.length} levels=${LEVELS.join(",")} requests/level=${REQUESTS} max_tokens=${MAX_TOKENS}`);
const warm = await level(4, 10);
console.log(`warm-up: ${warm.errors} errors, ${warm.valid}/10 valid JSON, p50 ${warm.p50.toFixed(0)} ms`);
if (warm.errors === 10) { console.error("every warm-up request failed; check base url / key / model name"); process.exit(1); }

for (const c of LEVELS) {
  const n = Math.max(REQUESTS, 4 * c);
  const r = await level(c, n);
  const cost = HOURLY > 0 ? HOURLY / (r.rps * 3.6) : null;
  const line = { concurrency: c, requests: n, rps: +r.rps.toFixed(2), p50_ms: Math.round(r.p50), p95_ms: Math.round(r.p95), errors: r.errors, json_valid: r.valid, avg_output_tokens: +r.tokens.toFixed(1), wall_s: +r.wall.toFixed(1), hourly_usd: HOURLY || null, cost_per_1000_usd: cost === null ? null : +cost.toFixed(4) };
  console.log(`conc=${String(c).padStart(3)} n=${n} rps=${line.rps} p50=${line.p50_ms}ms p95=${line.p95_ms}ms errors=${r.errors} valid=${r.valid}/${n} out_tok=${line.avg_output_tokens}${cost !== null ? ` cost/1k=$${cost.toFixed(4)}` : ""}`);
  if (OUT) await appendFile(OUT, JSON.stringify({ ts: new Date().toISOString(), endpoint: BASE, model: MODEL, ...line }) + "\n");
}
