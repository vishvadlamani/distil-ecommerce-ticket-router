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

const ROOT = join(import.meta.dirname ?? ".", "..");
const REAL_DIR = join(ROOT, "examples", "real");

const L = (intent: RouterOutput["intent"], urgency: number, sentiment: RouterOutput["sentiment"], action: RouterOutput["suggested_action"], needs_human: boolean, order_id: string | null = null): RouterOutput =>
  ({ intent, urgency: urgency as RouterOutput["urgency"], order_id, sentiment, suggested_action: action, needs_human });

/** Index-aligned with real_train_candidates.json (60 rows). */
export const REAL_TRAIN_LABELS: RouterOutput[] = [
  L("other", 2, "frustrated", "escalate_to_agent", true),            // 00 dirty water fountain photo
  L("other", 2, "angry", "escalate_to_agent", true),                 // 01 horrendous phone call
  L("billing_issue", 3, "frustrated", "escalate_to_billing", true),  // 02 price drop not honored
  L("account_access", 2, "frustrated", "escalate_to_agent", true),   // 03 clubcard signup loop
  L("other", 1, "neutral", "no_action", false),                      // 04 spanish promo
  L("product_question", 2, "neutral", "answer_from_faq", false),     // 05 nike runs not syncing
  L("account_access", 2, "frustrated", "escalate_to_agent", true),   // 06 french twitch prime linking
  L("other", 2, "frustrated", "escalate_to_agent", true),            // 07 delivery wagon driving
  L("refund_status", 3, "angry", "escalate_to_billing", true),       // 08 refund problem forced to keep
  L("product_question", 2, "frustrated", "answer_from_faq", false),  // 09 kannada ebooks
  L("damaged_item", 4, "frustrated", "escalate_to_agent", true),     // 10 wrong product + pickup not done
  L("other", 2, "frustrated", "escalate_to_agent", true),            // 11 offer never in stock
  L("other", 2, "neutral", "escalate_to_agent", true),               // 12 car park one-way
  L("damaged_item", 3, "frustrated", "send_replacement", false),     // 13 milk under line
  L("other", 1, "frustrated", "no_action", false),                   // 14 empty shelves venting
  L("product_question", 2, "neutral", "answer_from_faq", false),     // 15 stock BTS albums
  L("product_question", 2, "frustrated", "answer_from_faq", false),  // 16 kindle lending .in
  L("order_status", 4, "frustrated", "escalate_to_agent", true),     // 17 iphone 1-day not received
  L("other", 1, "neutral", "no_action", false),                      // 18 winners promo
  L("other", 1, "neutral", "no_action", false),                      // 19 promo link
  L("other", 1, "angry", "no_action", false),                        // 20 censored video rant
  L("account_access", 3, "frustrated", "escalate_to_agent", true),   // 21 affiliate closed
  L("other", 1, "neutral", "no_action", false),                      // 22 app all markets feature ask
  L("other", 3, "frustrated", "escalate_to_agent", true),            // 23 seller inventory missing
  L("other", 2, "frustrated", "escalate_to_agent", true),            // 24 non-discreet packaging
  L("account_access", 2, "neutral", "escalate_to_agent", true),      // 25 music signup session expired
  L("other", 1, "positive", "no_action", false),                     // 26 coffee maker praise
  L("other", 2, "frustrated", "escalate_to_agent", true),            // 27 store coffee machine broken
  L("other", 1, "positive", "no_action", false),                     // 28 toaster joy
  L("other", 1, "neutral", "no_action", false),                      // 29 german promo
  L("account_access", 2, "neutral", "escalate_to_agent", true),      // 30 german promo email prefs
  L("delivery_issue", 4, "angry", "escalate_to_agent", true),        // 31 delivered wrong city, rep lied
  L("other", 1, "frustrated", "no_action", false),                   // 32 .com vs .in pricing
  L("account_access", 2, "neutral", "escalate_to_agent", true),      // 33 ebay app cannot log in
  L("other", 1, "neutral", "no_action", false),                      // 34 fusion news
  L("billing_issue", 3, "frustrated", "escalate_to_billing", true),  // 35 seller FVF credit
  L("other", 1, "neutral", "no_action", false),                      // 36 tights/detergent critique
  L("other", 1, "positive", "no_action", false),                     // 37 BTS at walmart
  L("other", 1, "neutral", "no_action", false),                      // 38 gift card contest
  L("other", 1, "neutral", "no_action", false),                      // 39 job fair
  L("other", 1, "neutral", "no_action", false),                      // 40 prime day promo
  L("order_status", 3, "frustrated", "escalate_to_agent", true, "404-2154343-7283502"), // 41 order cancelled by sms
  L("other", 1, "neutral", "no_action", false),                      // 42 french book promo
  L("account_access", 2, "neutral", "escalate_to_agent", true),      // 43 find email for old username
  L("order_status", 3, "frustrated", "escalate_to_agent", true),     // 44 second late prime delivery
  L("other", 2, "angry", "escalate_to_agent", true),                 // 45 shame cheating rant
  L("other", 2, "angry", "escalate_to_agent", true),                 // 46 worst service no US reps
  L("other", 4, "angry", "escalate_to_agent", true),                 // 47 diesel pump ruined clothes
  L("other", 1, "frustrated", "no_action", false),                   // 48 kannada content disappointment
  L("damaged_item", 4, "angry", "send_replacement", false),          // 49 broom instead of painting
  L("other", 2, "angry", "escalate_to_agent", true),                 // 50 seller reimbursement rant
  L("damaged_item", 4, "frustrated", "escalate_to_agent", true),     // 51 dented refrigerator remedy dispute
  L("other", 2, "frustrated", "escalate_to_agent", true),            // 52 spanish no answer plea
  L("other", 1, "neutral", "no_action", false),                      // 53 xbox preorder promo
  L("other", 1, "neutral", "no_action", false),                      // 54 up and running tweet
  L("product_question", 2, "neutral", "answer_from_faq", false),     // 55 german appletv availability
  L("account_access", 4, "frustrated", "escalate_to_agent", true),   // 56 new PW doesn't work
  L("other", 1, "positive", "no_action", false),                     // 57 bosch excitement
  L("delivery_issue", 4, "frustrated", "open_carrier_investigation", false), // 58 spanish 40-day delay
  L("other", 2, "neutral", "escalate_to_agent", true),               // 59 contentless plea + link
];

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
