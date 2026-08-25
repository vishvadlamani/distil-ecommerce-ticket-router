/** Local eval harness: run an Ollama model over the 24-row platform holdout
 * and/or the 30-row adversarial battery, score with the shared field-level
 * scorer (which reproduces the platform judge), and report latency.
 *
 * Usage: bun scripts/eval.ts --model <ollama-model> [--set holdout|battery|all] [--num-predict 512]
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROUTER_SYSTEM, buildRouterPrompt } from "../src/router.ts";
import { scoreOne, summarize, type FieldScore } from "../src/scoring.ts";
import type { RouterOutput } from "../src/types.ts";
import { BATTERY } from "./battery.ts";

const ROOT = join(import.meta.dirname ?? ".", "..");
const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const MODEL = opt("model", "");
const SET = opt("set", "all");
const NUM_PREDICT = Number(opt("num-predict", "512"));
if (!MODEL) { console.error("--model required"); process.exit(1); }

interface Case { id: string; group: string; prompt: string; ref: RouterOutput }

async function loadCases(): Promise<Case[]> {
  const cases: Case[] = [];
  if (SET === "holdout" || SET === "all") {
    const rows = (await readFile(join(ROOT, "platform", "test.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    rows.forEach((r, i) => cases.push({ id: `holdout-${i + 1}`, group: "holdout", prompt: r.messages[0].content, ref: JSON.parse(r.messages[1].content) }));
  }
  if (SET === "battery" || SET === "all") {
    for (const b of BATTERY) cases.push({ id: b.id, group: b.group, prompt: buildRouterPrompt(b.ticket), ref: b.ref });
  }
  return cases;
}

const RAW = args.includes("--raw");

/** Qwen3's official non-thinking conditioning: empty think block opening the
 * assistant turn (what HF apply_chat_template(enable_thinking=False) emits).
 * Ollama's think:false instead appends " /no_think" to the user message —
 * different tokens in front of the model than training saw. */
function rawPrompt(user: string): string {
  return `<|im_start|>system\n${ROUTER_SYSTEM}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
}

async function complete(prompt: string): Promise<{ text: string; ms: number }> {
  const t0 = performance.now();
  const body = RAW
    ? {
        model: MODEL, prompt: rawPrompt(prompt), raw: true, stream: false, keep_alive: "15m",
        options: { temperature: Number(opt("temp", "0.1")), num_predict: NUM_PREDICT, stop: ["<|im_end|>"] },
      }
    : {
        model: MODEL,
        messages: [
          { role: "system", content: ROUTER_SYSTEM },
          { role: "user", content: prompt },
        ],
        stream: false, think: false, keep_alive: "15m",
        options: { temperature: Number(opt("temp", "0.1")), num_predict: NUM_PREDICT },
      };
  const res = await fetch(`http://localhost:11434/api/${RAW ? "generate" : "chat"}`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const j: any = await res.json();
  return { text: (RAW ? j.response : j.message?.content) ?? "", ms: performance.now() - t0 };
}

function pctile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

const cases = await loadCases();
console.log(`model=${MODEL} set=${SET} cases=${cases.length}`);
await complete("Ticket:\n\"\"\"\nSubject: warmup\nChannel: chat\nBody:\nwarmup\n\"\"\"\n\nOrder metadata:\n\"\"\"\norder_id: none\norder_status: none\ndays_since_order: none\nprevious_contacts: 0\n\"\"\"\n\nReturn JSON now."); // load model, excluded from timing

/** Mechanical invariants the dispatch layer enforces in production regardless
 * of what the model says. --guardrails scores the system (model + clamps)
 * instead of the raw model. */
const GUARDRAILS = args.includes("--guardrails");
function applyGuardrails(raw: string, c: Case): string {
  try {
    const out = JSON.parse(raw.trim());
    const meta = /previous_contacts: (\d+)/.exec(c.prompt);
    if (meta && Number(meta[1]) >= 2) out.needs_human = true;
    if (out.suggested_action === "escalate_to_agent" || out.suggested_action === "escalate_to_billing") out.needs_human = true;
    return JSON.stringify(out);
  } catch {
    return raw;
  }
}

const scores: { c: Case; s: FieldScore; ms: number }[] = [];
for (const c of cases) {
  const { text, ms } = await complete(c.prompt);
  scores.push({ c, s: scoreOne(c.ref, GUARDRAILS ? applyGuardrails(text, c) : text), ms });
}

for (const group of [...new Set(scores.map((x) => x.c.group))]) {
  const g = scores.filter((x) => x.c.group === group);
  const sum = summarize(g.map((x) => x.s));
  console.log(`\n[${group}] ${Object.entries(sum).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  for (const x of g.filter((x) => !x.s.judgePass || x.s.deviations.length))
    console.log(`  ${x.s.judgePass ? "pass" : "FAIL"} ${x.c.id}: ${x.s.deviations.join("; ") || "clean"}`);
}
const all = summarize(scores.map((x) => x.s));
const lat = scores.map((x) => x.ms);
console.log(`\nTOTAL ${Object.entries(all).map(([k, v]) => `${k}=${v}`).join(" ")}`);
console.log(`latency ms: p50=${pctile(lat, 50).toFixed(0)} p95=${pctile(lat, 95).toFixed(0)} max=${Math.max(...lat).toFixed(0)}`);
