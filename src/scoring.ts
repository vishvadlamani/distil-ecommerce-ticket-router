import { ACTION_TABLE, RouterOutputSchema, type RouterOutput } from "./types.ts";
import { cleanJsonOutput } from "./router.ts";

export interface FieldScore {
  schema: boolean;
  intent: boolean;
  orderId: boolean;
  needsHuman: boolean;
  sentiment: boolean;
  urgencyExact: boolean;
  urgencyWithin1: boolean;
  actionExact: boolean;
  actionAllowed: boolean;
  /** Mirrors the platform judge: intent + order_id + needs_human exact,
   * urgency within 1, action exact-or-allowed. Sentiment ungraded. */
  judgePass: boolean;
  parsed: RouterOutput | null;
  deviations: string[];
}

export function scoreOne(ref: RouterOutput, rawPred: string): FieldScore {
  const s: FieldScore = {
    schema: false, intent: false, orderId: false, needsHuman: false, sentiment: false,
    urgencyExact: false, urgencyWithin1: false, actionExact: false, actionAllowed: false,
    judgePass: false, parsed: null, deviations: [],
  };
  let out: RouterOutput;
  try {
    out = RouterOutputSchema.parse(JSON.parse(cleanJsonOutput(rawPred)));
  } catch {
    s.deviations.push(`SCHEMA FAIL: ${rawPred.slice(0, 120).replace(/\n/g, " ")}`);
    return s;
  }
  s.schema = true;
  s.parsed = out;

  s.intent = out.intent === ref.intent;
  if (!s.intent) s.deviations.push(`intent ${out.intent} vs ${ref.intent}`);
  s.orderId = out.order_id === ref.order_id;
  if (!s.orderId) s.deviations.push(`order_id ${out.order_id} vs ${ref.order_id}`);
  s.needsHuman = out.needs_human === ref.needs_human;
  if (!s.needsHuman) s.deviations.push(`needs_human ${out.needs_human} vs ${ref.needs_human}`);
  s.sentiment = out.sentiment === ref.sentiment;
  if (!s.sentiment) s.deviations.push(`sentiment ${out.sentiment} vs ${ref.sentiment}`);
  s.urgencyExact = out.urgency === ref.urgency;
  s.urgencyWithin1 = Math.abs(out.urgency - ref.urgency) <= 1;
  if (!s.urgencyExact) s.deviations.push(`urgency ${out.urgency} vs ${ref.urgency}${s.urgencyWithin1 ? " (within 1)" : ` (off by ${Math.abs(out.urgency - ref.urgency)})`}`);
  s.actionExact = out.suggested_action === ref.suggested_action;
  s.actionAllowed = s.actionExact || (ACTION_TABLE[ref.intent] ?? []).includes(out.suggested_action);
  if (!s.actionExact) s.deviations.push(`action ${out.suggested_action} vs ${ref.suggested_action}${s.actionAllowed ? " (allowed)" : ` (not allowed for ${ref.intent})`}`);

  s.judgePass = s.intent && s.orderId && s.needsHuman && s.urgencyWithin1 && s.actionAllowed;
  return s;
}

export function summarize(scores: FieldScore[]): Record<string, string> {
  const n = scores.length || 1;
  const pct = (k: keyof FieldScore) => `${((scores.filter((s) => s[k] === true).length / n) * 100).toFixed(1)}%`;
  return {
    n: String(scores.length),
    schema: pct("schema"),
    intent: pct("intent"),
    order_id: pct("orderId"),
    needs_human: pct("needsHuman"),
    sentiment: pct("sentiment"),
    urgency_within1: pct("urgencyWithin1"),
    action_allowed: pct("actionAllowed"),
    judge_pass: pct("judgePass"),
  };
}
