/** Assemble the v5 training dataset: round-3 repaired synthetic base plus 60
 * hand-labeled REAL tickets (Twitter customer-support corpus, train slice
 * [40:100] of the seeded shuffle — disjoint from the 40-row real test set)
 * oversampled x4. Test = curated 24 + held-out real 40 (64 rows), so the
 * platform eval covers both slices in one run.
 */
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRouterPrompt } from "../src/router.ts";
import { RouterOutputSchema, ACTION_TABLE, type RouterOutput, type TicketInput } from "../src/types.ts";
import { REAL_LABELS } from "./real_labels.ts";
import { REAL_TRAIN_LABELS } from "./real_train_labels.ts";

const ROOT = join(import.meta.dirname ?? ".", "..");
const REAL_DIR = join(ROOT, "examples", "real");

const toTicket = (body: string): TicketInput => ({
  subject: null, channel: "chat", body,
  meta: { order_id: null, order_status: "none", days_since_order: null, previous_contacts: 0 },
});

async function main() {
  const cands: { body: string }[] = JSON.parse(await readFile(join(REAL_DIR, "real_train_candidates.json"), "utf8"));
  if (cands.length !== REAL_TRAIN_LABELS.length) throw new Error(`count mismatch ${cands.length} vs ${REAL_TRAIN_LABELS.length}`);

  // validate labels: schema + action table + escalate/no_action invariants + verbatim id
  REAL_TRAIN_LABELS.forEach((l, i) => {
    RouterOutputSchema.parse(l);
    if (!ACTION_TABLE[l.intent].includes(l.suggested_action)) throw new Error(`row ${i}: action not allowed`);
    if ((l.suggested_action === "escalate_to_agent" || l.suggested_action === "escalate_to_billing") && !l.needs_human) throw new Error(`row ${i}: escalate needs human`);
    if (l.suggested_action === "no_action" && l.needs_human) throw new Error(`row ${i}: no_action with human`);
    if (l.order_id && !cands[i].body.includes(l.order_id)) throw new Error(`row ${i}: id not verbatim`);
  });

  const realRows = cands.map((c, i) => JSON.stringify({
    messages: [
      { role: "user", content: buildRouterPrompt(toTicket(c.body)) },
      { role: "assistant", content: JSON.stringify(REAL_TRAIN_LABELS[i]) },
    ],
  }));

  const base = (await readFile(join(ROOT, "repaired", "train.jsonl"), "utf8")).trim().split("\n");
  const out = [...base];
  for (let i = 0; i < 4; i++) out.push(...realRows);

  const curatedTest = (await readFile(join(ROOT, "platform", "test.jsonl"), "utf8")).trim().split("\n");
  const realTest: { body: string }[] = JSON.parse(await readFile(join(REAL_DIR, "real_tickets.json"), "utf8"));
  const realTestRows = realTest.map((t, i) => JSON.stringify({
    messages: [
      { role: "user", content: buildRouterPrompt(toTicket(t.body)) },
      { role: "assistant", content: JSON.stringify(REAL_LABELS[i]) },
    ],
  }));

  const DIR = join(ROOT, "repaired-v5");
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, "train.jsonl"), out.join("\n") + "\n");
  await writeFile(join(DIR, "test.jsonl"), [...curatedTest, ...realTestRows].join("\n") + "\n");
  await copyFile(join(ROOT, "repaired", "config.yaml"), join(DIR, "config.yaml"));
  await copyFile(join(ROOT, "repaired", "job_description.json"), join(DIR, "job_description.json"));
  console.log(`train=${out.length} (base ${base.length} + real ${realRows.length}x4) test=${curatedTest.length + realTestRows.length}`);
}

await main();
