/** Run the 64-row v6 test set through an OpenAI-compatible chat endpoint (a
 * platform deployment's vLLM server, a local vLLM, or any /v1 server) and write
 * the per-row JSONL that score_predictions.ts reads. Sequential by default so
 * latency_ms is a per-request number, not a queueing number.
 *
 * The deployment serves the trained adapter as `model` and the untrained base
 * student as `base`, so --model base gives the untrained-student column with
 * the same prompts, decoding settings and scorer.
 *
 * Usage: bun scripts/endpoint_eval.ts --base-url https://host/v1 --api-key KEY --model model|base
 *          --out results/<name>.jsonl [--concurrency 1] [--max-tokens 160]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ROUTER_SYSTEM } from "../src/router.ts";
import { loadTest } from "./score_lib.ts";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = opt("base-url", "").replace(/\/$/, "");
const KEY = opt("api-key", process.env.DISTIL_DEPLOYMENT_KEY ?? "EMPTY");
const MODEL = opt("model", "model");
const OUT = opt("out", "");
const CONC = Number(opt("concurrency", "1"));
const MAX_TOKENS = Number(opt("max-tokens", "160"));
if (!BASE || !OUT) { console.error("--base-url and --out required"); process.exit(2); }

const test = await loadTest();
const preds: any[] = new Array(test.length);
let next = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (true) {
    const i = next++;
    if (i >= test.length) return;
    const t = test[i];
    const t0 = performance.now();
    let prediction = "", usage: any = null, error: string | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${BASE}/chat/completions`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
          body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: ROUTER_SYSTEM }, { role: "user", content: t.prompt }], temperature: 0, max_tokens: MAX_TOKENS, chat_template_kwargs: { enable_thinking: false } }),
        });
        const j: any = await res.json();
        if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
        prediction = j.choices?.[0]?.message?.content ?? ""; usage = j.usage; error = undefined; break;
      } catch (e: any) { error = String(e?.message ?? e); await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); }
    }
    preds[i] = { idx: t.idx, slice: t.slice, prompt: t.prompt, ref: t.ref, prediction, latency_ms: Math.round(performance.now() - t0), usage, model: MODEL, endpoint: BASE, error };
  }
}));
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, preds.map((p) => JSON.stringify(p)).join("\n") + "\n");
const errs = preds.filter((p) => p.error).length;
console.log(`wrote ${OUT}: ${preds.length} rows, ${errs} errors, model=${MODEL}`);
