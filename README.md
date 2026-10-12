# Ecommerce Support Ticket Router

Small fine-tuned Qwen3 models that read a support ticket plus light order metadata and emit one routable JSON object. Trained on the [Distil Labs](https://www.distillabs.ai) platform. Round 2 (October 2026) is platform-native: the contract's rules live in the platform's data generation instructions, the 10,042 generated tickets were trained on as generated, and the 0.6B student matches its GLM 5.3 teacher on the 64-row held-out test at $0.0047 per 1,000 tickets on the platform's $1/hour GPU. Round 1 (August 2026) is kept below for reference; its weights are public at [vishinvents/distil-qwen3-1.7b-ecom-ticket-router](https://huggingface.co/vishinvents/distil-qwen3-1.7b-ecom-ticket-router).

Every ticket in, one object out:

```json
{
  "intent": "delivery_issue",
  "urgency": 4,
  "order_id": "AC-92831",
  "sentiment": "frustrated",
  "suggested_action": "open_carrier_investigation",
  "needs_human": false
}
```

## Results (round 2, October 2026)

Measured, not estimated. Same 64-row held-out test as August (24 curated tickets plus 40 real customer messages, labelled before any model ran). A row is correct when intent, order id and the human flag are exact, urgency is within one, and the action is allowed for the intent (the platform judge's rules, scored locally by [src/scoring.ts](src/scoring.ts); the platform judge agreed on every slice). 95% Wilson intervals in parentheses. Prediction files for every row are under [results/](results/).

| Model | Curated 24 | Real 40 | Blended 64 | Valid JSON |
|---|---|---|---|---|
| Untrained Qwen3-1.7B | 8/24 (33%, 18–53) | 15/40 (38%, 24–53) | 23/64 (36%, 25–48) | 62/64 |
| Untrained Qwen3-0.6B | 3/24 (13%, 4–31) | 0/40 (0%, 0–9) | 3/64 (5%, 2–13) | 61/64 |
| Teacher: GLM 5.3 low-thinking | 22/24 (92%, 74–98) | 25/40 (63%, 47–76) | 47/64 (73%, 62–83) | 64/64 |
| **Tuned Qwen3-1.7B** | 22/24 (92%, 74–98) | 23/40 (58%, 42–71) | 45/64 (70%, 58–80) | 64/64 |
| **Tuned Qwen3-0.6B** | 23/24 (96%, 80–99) | 24/40 (60%, 45–74) | 47/64 (73%, 62–83) | 64/64 |

At n = 64 the intervals are about 22 points wide: the 0.6B matches its teacher and the 1.7B is two rows behind. GPT-5.6 Luna and Gemini 3.5 Flash-Lite run with `bun run eval-external` once `OPENAI_API_KEY` and `GEMINI_API_KEY` are set; those rows are pending.

Cost, measured on the platform's deployments with the 64 real prompts at rising concurrency ([results/deploy-*/sweep.jsonl](results/)):

| Student | GPU tier | Sustained rate | Latency, one request at a time | Cost per 1,000 tickets |
|---|---|---|---|---|
| Tuned Qwen3-0.6B | $1/h | 59 rps at 512 in flight (plateau) | p50 3.1 s, p95 5.0 s | **$0.0047** |
| Tuned Qwen3-1.7B | $3/h | 101 rps at 128 in flight (still rising) | p50 0.8 s, p95 1.1 s | **≤ $0.0083** |

API list prices for the same ticket shape (about 1,100 input and 60 output tokens): GPT-5.6 Luna about $0.29 per 1,000, Gemini 3.5 Flash-Lite about $0.48.

## Reproduce round 2

Needs [bun](https://bun.sh) and the [distil CLI](https://www.distillabs.ai/docs) (`curl -fsSL https://cli-assets.distillabs.ai/install.sh | sh`, then `distil auth`).

```bash
bun install
bun run build-v6-seeds                                   # platform-v6/: 115 seeds, 64 test rows, validated
distil dataset create --data ./platform-v6               # dataset id
distil dataset generate-synthetic-data-train --smoke <dataset-id>   # 128-row smoke (side branch)
distil dataset download -d smoke <smoke-id> && bun run check-sample smoke/train.jsonl --skip 115
distil dataset generate-synthetic-data-train <dataset-id>           # full run on the parent
distil teacher-evaluation create-from-dataset <dataset-id>
distil slm create-from-dataset --config <complete config> <generated-dataset-id>   # once per student
distil slm download-predictions <slm-id> && bun run score <predictions.jsonl> --misses
distil deployment create-from-slm <slm-id> && bun run throughput --base-url <url>/v1 --api-key <key> --hourly 3
```

Every id, command and number from the October run is in [RUN_LOG.md](RUN_LOG.md).

## How it routes

- **intent**, one of 12: order_status, delivery_issue, return_request, refund_status, exchange, cancellation, product_question, sizing_fit, damaged_item, billing_issue, account_access, other
- **urgency** 1 to 5 on a fixed rubric
- **order_id** copied character for character from the ticket, metadata as fallback, null when absent. The ticket text wins when the two disagree.
- **sentiment**: angry, frustrated, neutral, positive
- **suggested_action**, one of 13 closed actions, constrained per intent (the table lives in [src/types.ts](src/types.ts))
- **needs_human** from explicit triggers: threats, fraud signals, repeat contact, requests for a person, anything automation cannot resolve

The model reasons over ticket plus metadata together. "Where is my order" with a package in transit for two days gets a tracking link. The same sentence with the carrier reporting delivery six days ago is a lost package and opens a carrier investigation. Keyword rules cannot make that distinction; this is the argument for a model in the loop.

[src/dispatch.ts](src/dispatch.ts) is the production wrapper: schema validation with one retry, fail-closed to a human on unusable output, and mechanical clamps for the contract's hard rules. Clamp rates are surfaced per decision so drift is visible in monitoring.

## Training data

Round 2 is platform-native, with no repair script and no hand-written patch rows:

1. **115 seeds** ([scripts/build_v6_seeds.ts](scripts/build_v6_seeds.ts)): 49 hand-authored tickets, 6 manipulation tickets ([scripts/injection_seeds.ts](scripts/injection_seeds.ts)) and 60 hand-labelled real customer messages ([scripts/real_train_labels.ts](scripts/real_train_labels.ts)), all rendered by the production prompt builder and validated for schema, action coherence, every threshold rule, verbatim ids, unique bodies and split hygiene. The test set is unchanged from August.
2. **The contract's rules in the generation prompt**: `synthetic_data_generation_instructions` in [platform-v6/job_description.json](platform-v6/job_description.json) carries the exact input template, fourteen numbered label rules in the system prompt's words with their symmetric cases, and the variety to cover; `synthgen.mutators` in [platform-v6/config.yaml](platform-v6/config.yaml) spread the rows over order state, register and manipulation type.
3. **Smoke gate before the generation credit**: [scripts/check_sample.ts](scripts/check_sample.ts) audits generated rows against every rule ([scripts/contract_rules.ts](scripts/contract_rules.ts)) without rewriting any. Smoke 1: 148 rows, 0 hard-rule violations, one coverage gap fixed with a sentence; smoke 2: 156 rows, clean.
4. **10,042 generated tickets** from `zai.glm-5.3-low-thinking`: 4 rows (0.04%) break a hard rule, 75 (0.7%) have a template defect, every policy boundary holds across hundreds of rows ([results/full-97b42e81/](results/full-97b42e81/)). Trained on as generated. August's dataset, from gpt-oss-120b with no instructions, had about 13% of rows breaking a rule.

## Limitations

English-first: the model answers non-English tickets in valid JSON but with reduced accuracy. Raw social-media messages without order metadata sit outside the training distribution; accuracy there is 57.5 to 60 percent against the teacher's 62.5, and the misses are largely the teacher's own. Both students still route "any update on my delivery? nothing has arrived yet" on a delivered order as a status question; it is the first seed for round 3. The 1.7B's throughput plateau was not reached in the sweep, so its cost figure is an upper bound. The mid-size API baselines are pending keys.

## Round 1 (August 2026), for reference

The first version trained a Qwen3-1.7B from 73 hand seeds with gpt-oss-120b as teacher and fixed the generated labels with a repair script ([scripts/repair_training_data.ts](scripts/repair_training_data.ts), [scripts/build_v5_dataset.ts](scripts/build_v5_dataset.ts)); that loop is superseded by round 2 and kept as the record. Its scores on the same test: teacher 18/24, 24/40, 42/64; tuned 1.7B 20/24 (83.3%), 23/40, 43/64. Its weights, f16 GGUF and Modelfile are on Hugging Face; `bun run demo`, `bun run eval` and `bun run eval-real` run them under [Ollama](https://ollama.com).

## License

Apache 2.0.
