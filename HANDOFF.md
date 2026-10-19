# Hand-off: ecommerce ticket router, round 2

For distil labs (Jacek). Everything here is measured; every number traces to a file under `results/` or an id in `RUN_LOG.md`. Updated 2026-10-19.

## What changed since August, in one paragraph

The router was rebuilt the way the platform is meant to be used. The contract's rules moved from an off-platform repair script into `synthetic_data_generation_instructions`, variety moved from hand-written rows into `synthgen.mutators`, the human-labelled real messages became seeds, and the teacher became `zai.glm-5.3-low-thinking`. The generated dataset (10,042 rows) broke a hard rule 4 times, against about 13% of rows in August, and was trained on as generated. Two students were trained from it; the Qwen3-0.6B matches the teacher on the unchanged 64-row test and costs $0.0047 per 1,000 tickets, measured at a platform deployment.

## Results

| Model | Curated 24 | Real 40 | Blended 64 | Valid JSON |
|---|---|---|---|---|
| Untrained Qwen3-1.7B | 8/24 | 15/40 | 23/64 (36%, 25–48) | 62/64 |
| Untrained Qwen3-0.6B | 3/24 | 0/40 | 3/64 (5%, 2–13) | 61/64 |
| Teacher GLM 5.3 low-thinking | 22/24 | 25/40 | 47/64 (73%, 62–83) | 64/64 |
| Tuned Qwen3-1.7B | 22/24 | 23/40 | 45/64 (70%, 58–80) | 64/64 |
| **Tuned Qwen3-0.6B** | 23/24 | 24/40 | **47/64 (73%, 62–83)** | 64/64 |

Correct = intent, order_id and needs_human exact, urgency within 1, action allowed for the intent (the judge's rules, scored locally; the platform judge agreed on every slice). 95% Wilson intervals. August: teacher gpt-oss-120b 42/64, tuned 1.7B 43/64. Full table and per-row misses: `results/RESULTS.md`, `results/slm-*/score.txt`, `results/teacher-eval-b153e39f/score.txt`.

Cost, measured on the platform's deployments with the 64 real prompts at rising concurrency (`results/deploy-*/sweep.jsonl`):

| Student | GPU tier | Sustained rate | Latency, one request at a time | Cost per 1,000 tickets |
|---|---|---|---|---|
| Tuned Qwen3-0.6B | $1/h | 59 rps at 512 in flight (plateau) | p50 3.1 s, p95 5.0 s | **$0.0047** |
| Tuned Qwen3-1.7B | $3/h | 101 rps at 128 in flight (still rising) | p50 0.8 s, p95 1.1 s | **≤ $0.0083** |

API list prices for the same ticket shape (about 1,100 input and 60 output tokens): GPT-5.6 Luna about $0.29 per 1,000, Gemini 3.5 Flash-Lite about $0.48.

## The package

| Item | Where |
|---|---|
| Code, seeds, scripts, prediction files, run log | this repo, branch `round2-platform-native`, PR [#1](https://github.com/vishvadlamani/distil-ecommerce-ticket-router/pull/1) |
| Seed directory as uploaded | `platform-v6/` (`train.jsonl` 115 rows, `test.jsonl` 64 rows, `job_description.json` with the generation instructions, `config.yaml` with mutators) |
| The generation instructions | `platform-v6/job_description.json`, key `synthetic_data_generation_instructions`; source in `scripts/build_v6_seeds.ts` |
| Audits of generated data | `results/smoke-ed14b487/`, `results/smoke-0c718c71/`, `results/full-97b42e81/` (audit, gate, distribution, expanded config, training configs) |
| Teacher evaluation | `results/teacher-eval-b153e39f/` (metrics, predictions, score with misses, job log) |
| Trained students | `results/slm-c1fa3d30-…/` (1.7B) and `results/slm-fc8a659a-…/` (0.6B): platform metrics, predictions, local score with misses, `metadata/model_client.py` |
| Deployments and sweeps | `results/deploy-8c45e7de-…/` (1.7B) and `results/deploy-791a667a-…/` (0.6B): endpoint evals of tuned and untrained, sweep logs |
| Live endpoint check (19 Oct) | `results/deploy-ebe71dae-…/`: the 64-row test through the live deployment, with per-row misses |
| Results table | `results/RESULTS.md` (built by `scripts/results_table.ts` from `results/manifest.json`) |
| Hugging Face model card for the 0.6B | `release/0.6b/MODEL_CARD.md`; publish with `release/0.6b/release.sh` (needs `HF_TOKEN`); target `vishinvents/distil-qwen3-0.6b-ecom-ticket-router` |
| Blog post (rewritten around round 2) | `content/ecommerce-ticket-router-blog.md` in `vishvadlamani/distil-models`, PR [#1](https://github.com/vishvadlamani/distil-models/pull/1) |
| Model-building guide with the round-2 appendix and CLI corrections | `DISTIL_MODEL_BUILDING_GUIDE.md` in the same PR (Appendix C, 2026-10-12 entry; section 10) |
| Revised proposals (Order Manager; Small Models You Can Trust) | `proposals/*.md` in the same PR, beside the September PDFs |
| Run log with every id and command | `RUN_LOG.md` |

## Platform entities (account vish@safe.app)

| Entity | Id |
|---|---|
| Dataset (seeds) | `85bcc9fb-2468-4a59-8051-17a41857be2a` |
| Smoke 1 / smoke 2 (generation) | `ed14b487-e3ff-43f5-a5eb-915dec1cdf40` / `0c718c71-2848-486a-a133-74da1c809276` (`dea53daf-…` ran during the provider outage, empty) |
| Full generation (10,042 rows) | `97b42e81-2357-4c88-a8ed-3b8c15402e32` |
| Teacher evaluation | `b153e39f-e24f-4cc6-aa44-cdf3fc5645f7` (`3cb7da8c-…` ran during the outage, empty) |
| SLM Qwen3-1.7B | `c1fa3d30-475a-4436-bbca-8833d178563f` |
| SLM Qwen3-0.6B (the one to ship) | `fc8a659a-fdb5-4159-b507-10ed97528946` |
| Deployments used for the sweeps | `8c45e7de-c4d3-4f21-8396-f30d72de522e` (1.7B), `791a667a-78b3-4ecb-9e63-d96bcf711db4` (0.6B), both deleted after measurement |
| Demo deployment (13 Oct) | `efd698b1-bdf6-48a9-bab5-e124df8e7a4b`, stopped by the platform's session limit |
| **Live deployment (19 Oct 12:21 UTC)** | `ebe71dae-e576-44f7-be7a-1211c229bf39`, endpoint `https://ta-01m5a1r4degkkfwyxtdh9t5eys-8000-4g5mej9g388rmylcdzr9hijwv.w.modal.host/v1` (OpenAI-compatible, model name `model`, untrained base as `base`; key from the endpoint route below). Serving after 240 s; the 64-row test through it scored 50/64 (23/24, 27/40), inside the same interval as the platform's 47/64. The platform stops it after 1 h idle or 6 h total. |

When the live deployment has stopped, the same model comes back with `distil deployment create-from-slm fc8a659a-fdb5-4159-b507-10ed97528946`, about four to five minutes to serving; the direct URL and key come from `GET https://api.distillabs.ai/deployments/<id>/endpoint`. For a permanent endpoint this account needs an `inference_endpoints_post` credit and a permanent primary.

## Open items

1. **Two baseline rows missing**: GPT-5.6 Luna and Gemini 3.5 Flash-Lite over the same 64 rows. `scripts/eval_external.ts` is ready; it needs `OPENAI_API_KEY` and `GEMINI_API_KEY`.
2. **Hugging Face upload**: the release folder (merged bf16 weights verified against the platform's predictions on 8/8 sampled rows, LoRA adapter, f16 GGUF, Modelfile, client, licences, card) is prepared; `release/0.6b/release.sh` publishes it once `HF_TOKEN` is set.
3. **1.7B throughput plateau**: the sweep stopped at 128 in flight while still rising; one redeploy at $3/h for about ten minutes closes it. Not needed for the headline.
4. **Credits to refund**: one teacher evaluation and one generation smoke ran while the platform's OpenRouter balance was zero and produced empty output.

## Feedback for distil labs

Confirmed on this run (reproduced, not observed once):

- A job whose every teacher call fails with a provider 402 still ends in `JOB_SUCCESS`: the teacher evaluation returned 64 empty predictions with zeroed metrics, the generation smoke looped through 1,000 zero-row iterations. Both charged credits. The job log, not the status, is the only signal.
- `GET /deployments/<id>/endpoint` returns a working vLLM URL and key for a live deployment, and the untrained base answers under the model name `base`. Neither is in the docs; together they are exactly what a cost measurement and a like-for-like untrained baseline need.
- Smoke runs come in 32-row batches, so a 128-row smoke returns 148 to 156 rows; the configuration page says targets round up to `generation_iteration_size` (128).
- The `training-dataset sample` free sample is gone; the replacement, `--smoke`, is a billed side-branch dataset. The migration page covers the commands, not the billing change.
- The $1/h and $3/h deployment tiers are different GPUs (p50 3.2 s vs 0.9 s at 8 in flight for models that differ 3x in size), so the pricing page should say to compare cost per 1,000, not requests per second.
- A worked example of `synthetic_data_generation_instructions` on a rule-heavy task: the exact input template, numbered mechanical label rules with their symmetric cases, and a variety paragraph naming both sides of every boundary gave 0.04% hard-rule violations with GLM 5.3 low-thinking. The job-description page has no example of this shape.

Seen once, worth a second look: `dataset download` adds an `images` key to user messages; `metrics` on August SLMs answers "job has not finished"; `dataset create --data` silently ignores subdirectories; deployments came up in 4.5 to 7 minutes.

## Reproduce

```bash
bun install && bun run build-v6-seeds
distil dataset create --data ./platform-v6
distil dataset generate-synthetic-data-train --smoke <dataset-id>      # audit with: bun run check-sample <train.jsonl> --skip 115
distil dataset generate-synthetic-data-train <dataset-id>
distil teacher-evaluation create-from-dataset <dataset-id>
distil slm create-from-dataset --config <complete config> <generated-dataset-id>
distil slm download-predictions <slm-id> && bun run score <predictions.jsonl> --misses
distil deployment create-from-slm <slm-id> && bun run throughput --base-url <url>/v1 --api-key <key> --hourly 1
```
