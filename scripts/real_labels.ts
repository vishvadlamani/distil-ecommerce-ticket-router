import type { RouterOutput } from "../src/types.ts";


// index-aligned with real_tickets.json; authored 2026-08-21 pre-model (see PLAN.md verification section)
const L = (intent: RouterOutput["intent"], urgency: number, sentiment: RouterOutput["sentiment"], action: RouterOutput["suggested_action"], needs_human: boolean): RouterOutput =>
  ({ intent, urgency: urgency as RouterOutput["urgency"], order_id: null, sentiment, suggested_action: action, needs_human });

export const REAL_LABELS: RouterOutput[] = [
  L("order_status", 2, "neutral", "send_tracking_link", false),          // 00 psn card pending
  L("product_question", 2, "neutral", "answer_from_faq", false),         // 01 nike app coach date
  L("account_access", 2, "frustrated", "escalate_to_agent", true),       // 02 stop marketing emails
  L("other", 1, "neutral", "no_action", false),                          // 03 argos promo
  L("other", 1, "neutral", "no_action", false),                          // 04 news tweet
  L("other", 1, "neutral", "no_action", false),                          // 05 spanish hashtag game
  L("other", 1, "neutral", "no_action", false),                          // 06 promo
  L("other", 1, "neutral", "no_action", false),                          // 07 bath foam remark
  L("product_question", 2, "neutral", "answer_from_faq", false),         // 08 chicken sourcing
  L("other", 2, "neutral", "escalate_to_agent", true),                   // 09 lease for PUDO
  L("other", 1, "neutral", "no_action", false),                          // 10 wine in fridge
  L("other", 1, "neutral", "no_action", false),                          // 11 german promo
  L("other", 1, "frustrated", "no_action", false),                       // 12 employee hours
  L("other", 1, "positive", "no_action", false),                         // 13 praise
  L("damaged_item", 3, "frustrated", "escalate_to_agent", true),         // 14 earphones+trolley rant
  L("order_status", 2, "frustrated", "send_tracking_link", false),       // 15 argos preorder £45
  L("other", 1, "neutral", "no_action", false),                          // 16 spanish contact promo
  L("damaged_item", 4, "frustrated", "escalate_to_agent", true),         // 17 chess wrong pieces, unresolved
  L("other", 1, "positive", "no_action", false),                         // 18 praise
  L("other", 2, "angry", "escalate_to_agent", true),                     // 19 CAPS rant seller mistakes
  L("refund_status", 4, "frustrated", "escalate_to_billing", true),      // 20 7 weeks refund
  L("order_status", 4, "frustrated", "escalate_to_agent", true),         // 21 one-day shipping missed
  L("other", 1, "neutral", "no_action", false),                          // 22 chit chat
  L("other", 1, "neutral", "no_action", false),                          // 23 contest
  L("product_question", 2, "neutral", "answer_from_faq", false),         // 24 alexa ireland
  L("product_question", 2, "frustrated", "answer_from_faq", false),      // 25 prime sound quality
  L("other", 4, "angry", "escalate_to_agent", true),                     // 26 five hours call centers
  L("damaged_item", 4, "frustrated", "escalate_to_agent", true),         // 27 pink chicken
  L("other", 1, "neutral", "no_action", false),                          // 28 nokia promo
  L("product_question", 2, "neutral", "answer_from_faq", false),         // 29 subtitles sync
  L("other", 1, "positive", "no_action", false),                         // 30 prize leek
  L("other", 1, "neutral", "no_action", false),                          // 31 spanish promo
  L("billing_issue", 4, "angry", "escalate_to_billing", true),           // 32 target charged twice
  L("cancellation", 3, "neutral", "cancel_order", false),                // 33 cancel sling
  L("other", 1, "frustrated", "no_action", false),                       // 34 contest winners
  L("damaged_item", 3, "frustrated", "send_replacement", false),         // 35 tesco meal deal
  L("account_access", 4, "frustrated", "escalate_to_agent", true),       // 36 seller account suspended
  L("exchange", 3, "frustrated", "escalate_to_agent", true),             // 37 wrong size no receipt
  L("billing_issue", 2, "frustrated", "answer_from_faq", false),         // 38 usd/eur only
  L("other", 3, "frustrated", "escalate_to_agent", true),                // 39 ebay closed case
];
