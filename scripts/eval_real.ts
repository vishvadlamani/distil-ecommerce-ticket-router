/** Real-world eval: 40 real first-contact customer messages to ecommerce
 * brands (public Twitter customer-support corpus, TNE-AI conversation mirror),
 * hand-labeled against the contract BEFORE any model ran on them.
 * Channel chat, no subject, all-none metadata: the honest cold-inbox case.
 * Usage: bun scripts/eval_real.ts --model <ollama-model> [--emit-seed-dir <dir>]
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildRouterPrompt } from "../src/router.ts";
import { scoreOne, summarize } from "../src/scoring.ts";
import type { RouterOutput, TicketInput } from "../src/types.ts";

import { REAL_LABELS } from "./real_labels.ts";

const REAL_DIR = join(import.meta.dirname ?? ".", "..", "examples", "real");
const tickets: { company: string; body: string }[] = JSON.parse(await readFile(join(REAL_DIR, "real_tickets.json"), "utf8"));
if (tickets.length !== REAL_LABELS.length) throw new Error(`count mismatch ${tickets.length} vs ${REAL_LABELS.length}`);

const toTicket = (t: { body: string }): TicketInput => ({
  subject: null, channel: "chat", body: t.body,
  meta: { order_id: null, order_status: "none", days_since_order: null, previous_contacts: 0 },
});

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

const seedDir = opt("emit-seed-dir");
if (seedDir) {
  // Platform seed dir for teacher-evaluation on the SAME 40 real tickets:
  // train = the existing 49 hand seeds, test = the 40 real rows + my labels.
  await mkdir(seedDir, { recursive: true });
  const ROOT = join(import.meta.dirname ?? ".", "..");
  const train = await readFile(join(ROOT, "platform", "train.jsonl"), "utf8");
  await writeFile(join(seedDir, "train.jsonl"), train);
  await writeFile(join(seedDir, "test.jsonl"), tickets.map((t, i) => JSON.stringify({
    messages: [
      { role: "user", content: buildRouterPrompt(toTicket(t)) },
      { role: "assistant", content: JSON.stringify(REAL_LABELS[i]) },
    ],
  })).join("\n") + "\n");
  for (const f of ["config.yaml", "job_description.json"])
    await writeFile(join(seedDir, f), await readFile(join(ROOT, "platform", f), "utf8"));
  console.log(`seed dir emitted: ${seedDir}`);
  process.exit(0);
}

const MODEL = opt("model");
if (!MODEL) { console.error("--model required (or --emit-seed-dir)"); process.exit(1); }

async function complete(prompt: string): Promise<string> {
  const res = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: (await import("../src/router.ts")).ROUTER_SYSTEM, }, { role: "user", content: prompt }],
      stream: false, think: false, keep_alive: "15m",
      options: { temperature: 0.1, num_predict: 512 },
    }),
  });
  const j: any = await res.json();
  return j.message?.content ?? "";
}

const scores = [];
for (let i = 0; i < tickets.length; i++) {
  const raw = await complete(buildRouterPrompt(toTicket(tickets[i])));
  const s = scoreOne(REAL_LABELS[i], raw);
  scores.push(s);
  if (!s.judgePass || s.deviations.length)
    console.log(`${s.judgePass ? "pass" : "FAIL"} [${String(i).padStart(2, "0")}] ${tickets[i].body.slice(0, 70).replace(/\n/g, " ")} :: ${s.deviations.join("; ")}`);
}
console.log(`\nREAL-40 ${Object.entries(summarize(scores)).map(([k, v]) => `${k}=${v}`).join(" ")}`);
