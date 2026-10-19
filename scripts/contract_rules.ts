/** The contract's mechanical rules as CHECKS (never rewrites).
 *
 * Round 2 keeps the August repair script's diagnosis and drops its repairs:
 * this module audits a (rendered prompt, output) pair against every rule the
 * generation instructions state, and reports which rules a row breaks. It is
 * used three ways: as the seed validator (build_v6_seeds.ts), as the sample
 * gate over generated data (check_sample.ts), and for prediction analysis.
 * Thresholds come from the seed policy: return/exchange window 35 days, stuck
 * processing 8 days.
 */
import { ACTION_TABLE, type Action, type Intent, type RouterOutput } from "../src/types.ts";

export interface Meta { orderId: string | null; status: string; days: number | null; prev: number; raw: string }

/** Parse the metadata block of a rendered prompt. Generated data drifts
 * ("null" for "none", invented statuses), so parse defensively and report. */
export function parseMeta(prompt: string): Meta | null {
  const m = /order_id: (.*)\norder_status: (\S+)\ndays_since_order: (.*)\nprevious_contacts: (\S+)/.exec(prompt);
  if (!m) return null;
  const num = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
  const id = m[1].trim();
  return {
    orderId: id === "none" || id === "null" || id === "" ? null : id,
    status: m[2],
    days: num(m[3]),
    prev: num(m[4]) ?? 0,
    raw: m[0],
  };
}

export const ESCALATE: Record<Intent, Action> = {
  order_status: "escalate_to_agent", delivery_issue: "escalate_to_agent", return_request: "escalate_to_agent",
  refund_status: "escalate_to_billing", exchange: "escalate_to_agent", cancellation: "escalate_to_agent",
  product_question: "escalate_to_agent", sizing_fit: "send_sizing_guide", damaged_item: "escalate_to_agent",
  billing_issue: "escalate_to_billing", account_access: "escalate_to_agent", other: "escalate_to_agent",
};
const AUTOMATED: Action[] = ["send_tracking_link", "open_carrier_investigation", "send_return_label", "send_refund_timeline", "process_exchange", "cancel_order", "answer_from_faq", "send_sizing_guide", "send_replacement", "send_password_reset"];
const isEscalate = (a: Action) => a === "escalate_to_agent" || a === "escalate_to_billing";
const THREAT = /(chargeback|disput(e|ing)|legal|lawyer|attorney|\bsue\b|lawsuit|fraud|unauthori[sz]ed|hacked|police|regulator|bbb\b|consumer protection|small claims)/i;
const HUMAN_ASK = /(talk|speak|connect|chat)\s+(to|with)\s+(a\s+)?(real\s+|live\s+|actual\s+)?(human|person|agent|rep\b|representative|someone|manager|supervisor)|real person|human being|actual person|live agent/i;
const VALID_STATUS = new Set(["none", "processing", "shipped", "in_transit", "delivered", "returned", "refund_initiated"]);

/** Rules that are hard invariants of the contract (any violation is a defect). */
export const HARD_RULES = [
  "action_table", "escalate_without_human", "no_action_with_human", "prev2_without_human",
  "order_id_not_verbatim", "post_ship_cancel_not_escalated", "out_of_window_not_escalated",
  "stuck_processing_not_escalated", "delivery_issue_while_processing",
] as const;
/** Rules on the input format the student will be trained on. */
export const FORMAT_RULES = ["prompt_template_mismatch", "invalid_order_status", "metadata_none_incoherent"] as const;
/** Rules that depend on keyword proxies for triggers; count them, read them, judge. */
export const SOFT_RULES = ["automated_action_with_human_no_trigger", "processing_cancel_escalated"] as const;

export interface Audit { violations: string[]; soft: string[]; format: string[]; meta: Meta | null }

export function auditRow(prompt: string, o: RouterOutput): Audit {
  const violations: string[] = [];
  const soft: string[] = [];
  const format: string[] = [];
  const meta = parseMeta(prompt);

  if (!/^Ticket:\n"""\nSubject: .*\nChannel: (email|chat|contact_form)\nBody:\n[\s\S]*\n"""\n\nOrder metadata:\n"""\norder_id: .*\norder_status: \S+\ndays_since_order: .*\nprevious_contacts: \S+\n"""\n\nReturn JSON now\.$/.test(prompt))
    format.push("prompt_template_mismatch");
  if (meta) {
    if (!VALID_STATUS.has(meta.status)) format.push(`invalid_order_status:${meta.status}`);
    if (meta.status === "none" && (meta.orderId !== null || meta.days !== null)) format.push("metadata_none_incoherent");
  }

  if (!ACTION_TABLE[o.intent].includes(o.suggested_action)) violations.push(`action_table:${o.intent}/${o.suggested_action}`);
  if (isEscalate(o.suggested_action) && !o.needs_human) violations.push("escalate_without_human");
  if (o.suggested_action === "no_action" && o.needs_human) violations.push("no_action_with_human");
  if (meta && meta.prev >= 2 && !o.needs_human) violations.push("prev2_without_human");
  if (o.order_id !== null && !prompt.includes(o.order_id)) violations.push(`order_id_not_verbatim:${o.order_id}`);

  if (meta) {
    if (o.intent === "cancellation" && ["shipped", "in_transit", "delivered"].includes(meta.status) && o.suggested_action !== "escalate_to_agent")
      violations.push(`post_ship_cancel_not_escalated:${meta.status}`);
    if ((o.intent === "return_request" || o.intent === "exchange") && meta.days !== null && meta.days > 35 && !isEscalate(o.suggested_action))
      violations.push(`out_of_window_not_escalated:${meta.days}d`);
    if (o.intent === "order_status" && meta.status === "processing" && meta.days !== null && meta.days >= 8 && o.suggested_action !== "escalate_to_agent")
      violations.push(`stuck_processing_not_escalated:${meta.days}d`);
    if (o.intent === "delivery_issue" && meta.status === "processing") violations.push("delivery_issue_while_processing");

    if (o.intent === "cancellation" && meta.status === "processing" && o.suggested_action === "escalate_to_agent" && meta.prev < 2 && !THREAT.test(prompt) && !HUMAN_ASK.test(prompt))
      soft.push("processing_cancel_escalated");
  }
  if (o.needs_human && AUTOMATED.includes(o.suggested_action) && o.intent !== "other" && (meta?.prev ?? 0) < 2 && !THREAT.test(prompt) && !HUMAN_ASK.test(prompt))
    soft.push("automated_action_with_human_no_trigger");

  return { violations, soft, format, meta };
}
