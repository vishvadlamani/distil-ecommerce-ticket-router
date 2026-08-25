/** Production dispatch layer: model call + validation + mechanical guardrails.
 *
 * The model does the reading; this layer enforces the contract's hard rules
 * regardless of what the model says:
 *   - output must parse and validate against RouterOutputSchema (one retry,
 *     then fail closed to a human)
 *   - action must be allowed for the intent (else remapped to the intent's
 *     escalation action)
 *   - escalate actions imply needs_human, no_action implies not
 *   - previous_contacts >= 2 forces needs_human
 *   - order_id must appear verbatim in the ticket or metadata (else replaced
 *     with the metadata id, or null)
 * Guardrail hits are reported on the decision so they can be monitored: a
 * rising clamp rate means the model and the contract are drifting apart.
 */
import { ROUTER_SYSTEM, buildRouterPrompt, cleanJsonOutput } from "./router.ts";
import { ACTION_TABLE, RouterOutputSchema, type Action, type Intent, type RouterOutput, type TicketInput } from "./types.ts";

const ESCALATE: Record<Intent, Action> = {
  order_status: "escalate_to_agent", delivery_issue: "escalate_to_agent",
  return_request: "escalate_to_agent", refund_status: "escalate_to_billing",
  exchange: "escalate_to_agent", cancellation: "escalate_to_agent",
  product_question: "escalate_to_agent", sizing_fit: "send_sizing_guide",
  damaged_item: "escalate_to_agent", billing_issue: "escalate_to_billing",
  account_access: "escalate_to_agent", other: "escalate_to_agent",
};

export interface RouteDecision {
  ok: boolean;              // false = model output unusable, ticket sent to a human
  decision: RouterOutput;   // final, post-guardrail decision
  raw: string;              // model text, for logging
  clamps: string[];         // guardrails that fired
  latencyMs: number;
}

export interface DispatchOptions {
  model?: string;
  baseUrl?: string;
  retries?: number;
}

const FAIL_CLOSED = (t: TicketInput): RouterOutput => ({
  intent: "other", urgency: 3, order_id: t.meta.order_id, sentiment: "neutral",
  suggested_action: "escalate_to_agent", needs_human: true,
});

export async function route(ticket: TicketInput, opts: DispatchOptions = {}): Promise<RouteDecision> {
  const model = opts.model ?? "ecom-router-1.7b-v5";
  const baseUrl = opts.baseUrl ?? "http://localhost:11434";
  const retries = opts.retries ?? 1;
  const t0 = performance.now();
  let raw = "";

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: ROUTER_SYSTEM },
          { role: "user", content: buildRouterPrompt(ticket) },
        ],
        stream: false, think: false, keep_alive: "15m",
        options: { temperature: 0.1, num_predict: 512 },
      }),
    });
    if (!res.ok) continue;
    raw = ((await res.json()) as any).message?.content ?? "";

    let parsed: RouterOutput;
    try {
      parsed = RouterOutputSchema.parse(JSON.parse(cleanJsonOutput(raw)));
    } catch {
      continue; // retry once, then fail closed
    }
    return { ok: true, ...applyGuardrails(parsed, ticket), raw, latencyMs: performance.now() - t0 };
  }
  return { ok: false, decision: FAIL_CLOSED(ticket), raw, clamps: ["fail_closed"], latencyMs: performance.now() - t0 };
}

export function applyGuardrails(out: RouterOutput, ticket: TicketInput): { decision: RouterOutput; clamps: string[] } {
  const d = { ...out };
  const clamps: string[] = [];

  if (!ACTION_TABLE[d.intent].includes(d.suggested_action)) {
    d.suggested_action = d.needs_human ? ESCALATE[d.intent] : ACTION_TABLE[d.intent][0];
    clamps.push("action_table");
  }
  if (ticket.meta.previous_contacts >= 2 && !d.needs_human) {
    d.needs_human = true;
    clamps.push("previous_contacts");
  }
  if ((d.suggested_action === "escalate_to_agent" || d.suggested_action === "escalate_to_billing") && !d.needs_human) {
    d.needs_human = true;
    clamps.push("escalate_implies_human");
  }
  if (d.order_id !== null) {
    const inTicket = ticket.body.includes(d.order_id) || (ticket.subject ?? "").includes(d.order_id) || ticket.meta.order_id === d.order_id;
    if (!inTicket) {
      d.order_id = ticket.meta.order_id;
      clamps.push("order_id_verbatim");
    }
  }
  return { decision: d, clamps };
}
