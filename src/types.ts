import { z } from "zod";

export const INTENTS = [
  "order_status",
  "delivery_issue",
  "return_request",
  "refund_status",
  "exchange",
  "cancellation",
  "product_question",
  "sizing_fit",
  "damaged_item",
  "billing_issue",
  "account_access",
  "other",
] as const;
export type Intent = (typeof INTENTS)[number];

export const ACTIONS = [
  "send_tracking_link",
  "open_carrier_investigation",
  "send_return_label",
  "send_refund_timeline",
  "process_exchange",
  "cancel_order",
  "answer_from_faq",
  "send_sizing_guide",
  "send_replacement",
  "escalate_to_billing",
  "send_password_reset",
  "escalate_to_agent",
  "no_action",
] as const;
export type Action = (typeof ACTIONS)[number];

export const SENTIMENTS = ["angry", "frustrated", "neutral", "positive"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const ORDER_STATUSES = [
  "none",
  "processing",
  "shipped",
  "in_transit",
  "delivered",
  "returned",
  "refund_initiated",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const CHANNELS = ["email", "chat", "contact_form"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Which actions a router may take per intent. The action within an intent is
 * context-dependent (cancellation while processing -> cancel_order; after
 * shipping -> escalate_to_agent), never a 1:1 lookup. */
export const ACTION_TABLE: Record<Intent, readonly Action[]> = {
  order_status: ["send_tracking_link", "escalate_to_agent"],
  delivery_issue: ["open_carrier_investigation", "escalate_to_agent"],
  return_request: ["send_return_label", "escalate_to_agent"],
  refund_status: ["send_refund_timeline", "escalate_to_billing", "escalate_to_agent"],
  exchange: ["process_exchange", "escalate_to_agent"],
  cancellation: ["cancel_order", "escalate_to_agent"],
  product_question: ["answer_from_faq", "escalate_to_agent"],
  sizing_fit: ["send_sizing_guide", "answer_from_faq"],
  damaged_item: ["send_replacement", "escalate_to_agent"],
  billing_issue: ["escalate_to_billing", "answer_from_faq"],
  account_access: ["send_password_reset", "escalate_to_agent"],
  other: ["escalate_to_agent", "no_action"],
};

export const RouterOutputSchema = z
  .object({
    intent: z.enum(INTENTS),
    urgency: z.number().int().min(1).max(5),
    order_id: z.string().min(1).nullable(),
    sentiment: z.enum(SENTIMENTS),
    suggested_action: z.enum(ACTIONS),
    needs_human: z.boolean(),
  })
  .strict();
export type RouterOutput = z.infer<typeof RouterOutputSchema>;

export interface OrderMeta {
  order_id: string | null;
  order_status: OrderStatus;
  days_since_order: number | null;
  previous_contacts: number;
}

export interface TicketInput {
  subject: string | null;
  channel: Channel;
  body: string;
  meta: OrderMeta;
}
