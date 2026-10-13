/** External baselines over the 64-row v6 test set: GPT-5.6 Luna (OpenAI) and
 * Gemini Flash-Lite (Google), same ROUTER_SYSTEM, same buildRouterPrompt
 * (the rendered prompts in platform-v6/test.jsonl), temperature 0, scored
 * with the shared scoreOne. Writes one per-row JSONL per model (prompt, ref,
 * prediction, latency_ms, usage) that scripts/score_predictions.ts reads.
 *
 * Keys: OPENAI_API_KEY and GEMINI_API_KEY (or GOOGLE_API_KEY) from the environment.
 *
 * Usage: bun scripts/eval_external.ts [--provider openai|gemini|all]
 *          [--openai-model gpt-5.6-luna] [--gemini-model gemini-3.5-flash-lite]
 *          [--out-dir results/external] [--concurrency 4] [--limit N]
 *
 * Model ids and list prices verified 2026-10-12 on the vendors' pricing pages:
 *   gpt-5.6-luna           $0.20 in / $1.20 out per 1M tokens
 *   gemini-3.5-flash-lite  $0.30 in / $2.50 out per 1M tokens
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROUTER_SYSTEM } from "../src/router.ts";
import { scoreOne, summarize } from "../src/scoring.ts";
import { fmtCorrect } from "./stats.ts";

const ROOT = join(import.meta.dirname ?? ".", "..");
const args = process.argv.slice(2);
const opt = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const PROVIDER = opt("provider", "all");
const OPENAI_MODEL = opt("openai-model", "gpt-5.6-luna");
const GEMINI_MODEL = opt("gemini-model", "gemini-3.5-flash-lite");
const OUT_DIR = opt("out-dir", join(ROOT, "results", "external"));
const CONC = Number(opt("concurrency", "4"));
const LIMIT = Number(opt("limit", "0"));
const OPENAI_API = opt("openai-api", "chat"); // chat | responses

const PRICES: Record<string, { in: number; out: number }> = {
  "gpt-5.6-luna": { in: 0.2, out: 1.2 },
  "gemini-3.5-flash-lite": { in: 0.3, out: 2.5 },
};

const rows = (await readFile(join(ROOT, "platform-v6", "test.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
const cases = rows.slice(0, LIMIT || rows.length).map((r, i) => ({ idx: i, slice: i < 24 ? "curated" : "real", prompt: r.messages[0].content as string, ref: JSON.parse(r.messages[1].content) }));

interface Pred { idx: number; slice: string; prompt: string; ref: any; prediction: string; latency_ms: number; usage: any; error?: string; note?: string }

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e: any) {
      last = e;
      const msg = String(e?.message ?? e);
      if (!/429|5\d\d|fetch failed|ECONN|timeout/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
    }
  }
  throw last;
}

async function openai(prompt: string, key: string): Promise<{ text: string; usage: any; note?: string }> {
  let note: string | undefined;
  const call = async (withTemp: boolean) => {
    if (OPENAI_API === "responses") {
      const body: any = { model: OPENAI_MODEL, instructions: ROUTER_SYSTEM, input: prompt, max_output_tokens: 400, store: false };
      if (withTemp) body.temperature = 0;
      const res = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
      const j: any = await res.json();
      if (!res.ok) throw new Error(`openai ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
      const text = j.output_text ?? (j.output ?? []).flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join("");
      return { text, usage: j.usage };
    }
    const body: any = { model: OPENAI_MODEL, messages: [{ role: "system", content: ROUTER_SYSTEM }, { role: "user", content: prompt }], max_completion_tokens: 400 };
    if (withTemp) body.temperature = 0;
    const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
    const j: any = await res.json();
    if (!res.ok) throw new Error(`openai ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
    return { text: j.choices?.[0]?.message?.content ?? "", usage: j.usage };
  };
  try { return await call(true); } catch (e: any) {
    if (/temperature/i.test(String(e?.message))) { note = "temperature unsupported by model; ran at default"; const r = await call(false); return { ...r, note }; }
    throw e;
  }
}

async function gemini(prompt: string, key: string): Promise<{ text: string; usage: any; note?: string }> {
  const body = {
    systemInstruction: { parts: [{ text: ROUTER_SYSTEM }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  let res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
  let j: any = await res.json();
  let note: string | undefined;
  if (!res.ok && /thinking/i.test(JSON.stringify(j))) {
    note = "thinkingBudget rejected; ran without thinkingConfig";
    delete (body.generationConfig as any).thinkingConfig;
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
    j = await res.json();
  }
  if (!res.ok) throw new Error(`gemini ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
  return { text, usage: j.usageMetadata, note };
}

async function run(name: string, model: string, fn: (p: string) => Promise<{ text: string; usage: any; note?: string }>) {
  const preds: Pred[] = new Array(cases.length);
  let next = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (true) {
      const i = next++;
      if (i >= cases.length) return;
      const c = cases[i];
      const t0 = performance.now();
      try {
        const r = await withRetry(() => fn(c.prompt));
        preds[i] = { idx: c.idx, slice: c.slice, prompt: c.prompt, ref: c.ref, prediction: r.text, latency_ms: Math.round(performance.now() - t0), usage: r.usage, note: r.note };
      } catch (e: any) {
        preds[i] = { idx: c.idx, slice: c.slice, prompt: c.prompt, ref: c.ref, prediction: "", latency_ms: Math.round(performance.now() - t0), usage: null, error: String(e?.message ?? e) };
      }
    }
  }));
  await mkdir(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `${model}.jsonl`);
  await writeFile(file, preds.map((p) => JSON.stringify(p)).join("\n") + "\n");

  const scored = preds.map((p) => ({ p, s: scoreOne(p.ref, p.prediction) }));
  for (const slice of ["curated", "real", "blended"]) {
    const g = slice === "blended" ? scored : scored.filter((x) => x.p.slice === slice);
    const pass = g.filter((x) => x.s.judgePass).length;
    const sum = summarize(g.map((x) => x.s));
    console.log(`[${name} ${model}] ${slice.padEnd(7)} correct ${fmtCorrect(pass, g.length)} | json ${sum.schema} intent ${sum.intent} order_id ${sum.order_id} needs_human ${sum.needs_human} urgency±1 ${sum.urgency_within1} action_ok ${sum.action_allowed}`);
  }
  const errs = preds.filter((p) => p.error);
  const lat = preds.map((p) => p.latency_ms).sort((a, b) => a - b);
  const inTok = preds.reduce((a, p) => a + (p.usage?.prompt_tokens ?? p.usage?.input_tokens ?? p.usage?.promptTokenCount ?? 0), 0);
  const outTok = preds.reduce((a, p) => a + (p.usage?.completion_tokens ?? p.usage?.output_tokens ?? p.usage?.candidatesTokenCount ?? 0), 0);
  const price = PRICES[model];
  const perTicket = price ? (inTok / cases.length / 1e6) * price.in + (outTok / cases.length / 1e6) * price.out : null;
  console.log(`  errors=${errs.length} latency p50=${lat[Math.floor(lat.length / 2)]}ms p95=${lat[Math.floor(lat.length * 0.95)]}ms | tokens/ticket in=${(inTok / cases.length).toFixed(0)} out=${(outTok / cases.length).toFixed(0)}${perTicket !== null ? ` | list-price cost per 1,000 tickets: $${(1000 * perTicket).toFixed(3)}` : ""}`);
  for (const e of errs.slice(0, 3)) console.log(`  error #${e.idx}: ${e.error}`);
  const notes = [...new Set(preds.map((p) => p.note).filter(Boolean))];
  if (notes.length) console.log(`  notes: ${notes.join("; ")}`);
  console.log(`  wrote ${file}`);
}

const oaKey = process.env.OPENAI_API_KEY ?? "";
const gmKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
if (PROVIDER === "openai" || PROVIDER === "all") {
  if (!oaKey) console.log(`OPENAI_API_KEY not set: skipping ${OPENAI_MODEL}`);
  else await run("openai", OPENAI_MODEL, (p) => openai(p, oaKey));
}
if (PROVIDER === "gemini" || PROVIDER === "all") {
  if (!gmKey) console.log(`GEMINI_API_KEY not set: skipping ${GEMINI_MODEL}`);
  else await run("gemini", GEMINI_MODEL, (p) => gemini(p, gmKey));
}
