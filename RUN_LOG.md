# RUN_LOG: ecommerce ticket router, round 2 (platform-native)

Every platform id, command and number for the October 2026 rerun. If the container is
reclaimed, sign in again (`distil auth`) and pick up from the last entry here.

Kickoff: `prompts/ROUTER_ROUND2_KICKOFF.md` in `vishvadlamani/distil-models` (branch
`claude/markdown-file-review-5onp3w`, carried onto `claude/charming-pascal-a32gey`).
Rules: `DISTIL_MODEL_BUILDING_GUIDE.md` sections 3, 5 (superseded block), 6, 7, 10, 11, Appendix C 2026-10-12.

## Environment

- Date: 2026-10-12
- distil CLI 0.34.0 (`curl -fsSL https://cli-assets.distillabs.ai/install.sh | sh`), signed in as vish@safe.app
  (user_01M3S079N4WKG3A470V06FXZDN) via the device-code flow.
- distil skill for coding agents installed with `distil skill install` (`~/.agents/skills/distil-cli`, v10.0.3): the
  current documented flow.
- Runtimes: bun 1.4.2, node 22.22, python 3.13. No Ollama.
- `OPENAI_API_KEY`, `GEMINI_API_KEY`: not set in this container (external baselines runner written, see step 7).
- Router repo branch: `round2-platform-native`. Guide repo branch: `claude/charming-pascal-a32gey`.

## CLI surface change (0.34.0 as installed, differs from the guide's section 10)

The guide and kickoff name `seed-dataset create`, `training-dataset create-from-seed-dataset`,
`training-dataset sample|status`, `slm create-from-training-dataset`. The installed 0.34.0 has
replaced those with one `dataset` entity:

| Kickoff step | Command actually used |
|---|---|
| `seed-dataset create --data ./platform-v6` | `distil dataset create --data ./platform-v6` (credit `datasets_post`) |
| `teacher-evaluation create-from-seed-dataset <seed-id>` | `distil teacher-evaluation create-from-dataset <dataset-id>` |
| `training-dataset create-from-seed-dataset <seed-id>` | `distil dataset generate-synthetic-data-train <dataset-id>` (credit `datasets_from_datasets_generate_synthetic_data_post`) |
| `training-dataset sample <td-id>` (free 128-row sample) | `distil dataset generate-synthetic-data-train --smoke <dataset-id>` (128 rows, a side-branch dataset, credit `datasets_from_datasets_smoke_post`), then `distil dataset download` |
| `training-dataset status` | `distil dataset status --output json` |
| `slm create-from-training-dataset <td-id>` | `distil slm create-from-dataset [--config <complete file>] <dataset-id>` |
| `deployment endpoint` | not in the CLI; `GET https://api.distillabs.ai/deployments/<id>/endpoint` with `distil access-token` |

Old entities remain readable: `distil seed-dataset|training-dataset list|download|download-metadata`.
Overrides still replace the whole file (no merge). `inference_endpoints_post` balance is 0, so the
throughput sweep calls the deployment's own vLLM endpoint, not an inference endpoint.

## Credits before the run (2026-10-12 06:34 UTC)

```
datasets_post 5 | datasets_from_datasets_generate_synthetic_data_post 5 | datasets_from_datasets_smoke_post 20
teacher_evaluations_post 5 | slms_from_datasets_post 5 | slms_from_datasets_smoke_post 20
deployments_from_slms_post 17 | inference_endpoints_post 0 | prepared_traces_post 120 | slms_post 20
```

Planned spend: 1 dataset upload, 1 smoke generation (+1 if the teacher changes), 1 teacher evaluation,
1 full generation (+1 if the teacher changes), 2 trainings, 2 deployments.

## August entities (reference, read-only)

- Seed datasets: 732b69c7 (08-14), f447b17b, 34da8c5d (08-14), 8a08814d (08-21), bebf7133 (08-22, real-40 teacher eval seed)
- Training datasets: 39ccafc8/49e0cf6d/81ee571f (generated), 32e0f9b1 (generated 08-21), bda85397, 8363786b,
  1e37c60d, **8db82ae9-7526-4bfe-a704-89f0cd01c70d** (v5 direct upload 08-22 09:39, the 64-row test set of record)
- SLMs: latest **46bf8b2b-839e-4175-a731-4443146ce21c** (08-22 09:40, v5 Qwen3-1.7B, the public model)
- Deployments (08-15, all stopped): 8c85d7a0, f62386fc, fa82690e, f6deb676, 7094e513

## Step log

### Step 1: seed directory platform-v6/ (2026-10-12)

- `bun scripts/build_v6_seeds.ts` -> `platform-v6/{train.jsonl,test.jsonl,job_description.json,config.yaml}` and
  `platform-v6/overrides/config_0p6b.yaml`.
- Validator: schema, action table, escalate=>human, no_action=>!human, prev>=2=>human, order_id verbatim, metadata
  coherence, every contract rule in `scripts/contract_rules.ts`, unique bodies, no train/test overlap, per-intent counts.
- (results appended below once run)
- Result: train=115 (hand 49, injection 6, real 60), test=64 (curated 24, real 40); 0 validation errors;
  `check_sample.ts` over the seeds: 0 hard violations, 1 soft flag (the intended partial-cancellation seed).
- Test-set identity: `distil training-dataset download 8db82ae9-7526-4bfe-a704-89f0cd01c70d` (the August v5 upload) ->
  64/64 rows identical in role+content; platform-added keys on download: ['images']. Byte md5 differs only because the platform re-serialises rows on download.
- Generation instructions: 8,100 chars, 14 numbered label rules + input template + metadata rules + variety (text in
  `platform-v6/job_description.json`, source `scripts/build_v6_seeds.ts`). Mutators: order_state (7 values, weighted),
  register (7), manipulation (4, 85% plain). Teacher `zai.glm-5.3-low-thinking`, `teacher_temperature: 0.6`, judge fixed to
  the same model, `num_positive_exemplars_per_generation: 2` (what the August platform config actually ran with).
- New scripts: `contract_rules.ts` (rules as checks), `check_sample.ts` (audit, --skip), `stats.ts` (Wilson),
  `score_predictions.ts` (per-slice scoring of any prediction file), `eval_external.ts` (GPT-5.6 Luna / Gemini 3.5
  Flash-Lite, waits for keys), `throughput_sweep.ts` (concurrency sweep + cost per 1,000).
- Model ids and list prices checked 2026-10-12 on the vendors' pricing pages: `gpt-5.6-luna` $0.20 in / $1.20 out per 1M
  tokens (OpenAI's models page now lists GPT-6 Luna, `gpt-6-luna`, as the current Luna; 5.6 Luna is still priced);
  `gemini-3.5-flash-lite` $0.30 in / $2.50 out per 1M tokens (newest stable Flash-Lite).
- Deployment direct access: `GET https://api.distillabs.ai/deployments/<id>/endpoint` returns `{url, api_key}`
  (null once stopped), so the sweep needs no inference-endpoint credit.

### Step 2: dataset upload and smoke generation (2026-10-12 06:56 UTC)

- `distil dataset create --data ./platform-v6` -> **Dataset 85bcc9fb-2468-4a59-8051-17a41857be2a** (direct_upload, JOB_SUCCESS at once).
  1 `datasets_post` credit. The `overrides/` subfolder was ignored by the uploader.
- `distil dataset generate-synthetic-data-train --smoke --output json 85bcc9fb-2468-4a59-8051-17a41857be2a` ->
  **smoke Dataset ed14b487-e3ff-43f5-a5eb-915dec1cdf40** (parent 85bcc9fb, 128-row target, 1 `datasets_from_datasets_smoke_post` credit).
  Side branch: the full run goes on the parent 85bcc9fb, never on the smoke child.
- Gate: download ed14b487, audit rows after the first 115 (the parent's seeds) with
  `bun scripts/check_sample.ts <train.jsonl> --skip 115`. Hard-violation rate must be near zero.
- Smoke result (07:00 UTC, job ran 06:59:26 to 07:00:16, 50 s for 148 rows in 5 iterations of 32):
  `rows=148 bad_json=0 bad_schema=0 HARD violations 0 (0.0%) SOFT flags 0 FORMAT issues 2 (1.4%)` (one fence written
  as `""`, one duplicated `days_since_order` line). Evidence: `results/smoke-ed14b487/{generated_rows.jsonl,audit.txt}`.
- Boundaries all correct in the sample: cancellation processing x5 -> cancel_order, shipped/in_transit x6 -> escalate;
  return/exchange <=28 d -> automated (one 21 d escalation with a stated reason), 41-52 d -> escalate x4; order_status
  processing 2-7 d -> tracking x10, 9-12 d -> escalate x6. Manual read of 14 random rows: 14/14 labels correct.
- Coverage: intents order_status 29, refund_status 14, damaged_item 13, cancellation 11, exchange 10, sizing_fit 10,
  account_access 10, delivery_issue 9, return_request 9, product_question 8, billing_issue 7, other 18 (no skew toward
  `other` despite 45/115 `other` seeds); ~14% non-English, 6% injection-like, 30% no subject, 4 text-vs-metadata id
  conflicts, 0 seed bodies copied; order_id null 42 / from text 72 / from metadata 34.
- Gap: account_access 10/10 escalate_to_agent, 0 send_password_reset (seeds carry 1 such row in 12). Fix before the
  full run: VARIETY paragraph now asks for both sides of account_access, billing_issue, delivery_issue, cancellation,
  returns and exchanges in balance; template paragraph now says exactly three quote characters and each metadata line
  once. The smoke-1 instructions are at commit 0c6c1f7; the revised ones go in as a `--job-description` override
  on the same parent 85bcc9fb (smoke 2, then the full run), so the generated dataset carries the revised text.

### Step 2b / 3: smoke 2 and teacher evaluation (2026-10-12 07:17 UTC)

- `distil dataset generate-synthetic-data-train --smoke --output json --job-description platform-v6/job_description.json 85bcc9fb-...`
  -> **smoke-2 Dataset dea53daf-d796-4eb1-86dc-f28e87a09a0e** (parent 85bcc9fb, revised instructions as override, 1 smoke credit; 18 left).
- `distil teacher-evaluation create-from-dataset --output json 85bcc9fb-...` -> **TeacherEvaluation 3cb7da8c-5a5f-4f15-a279-02ed8b3172de**
  (teacher and judge `zai.glm-5.3-low-thinking`, 1 few-shot from train, 64-row test; 1 `teacher_evaluations_post` credit; 4 left).
- Watchers: smoke 2 -> download, `check_sample.ts --skip 115`, gate (bad_json=0, bad_schema=0, hard-violation rows <= 2%,
  format rows <= 3%) -> on PASS launch the full run on parent 85bcc9fb with the same `--job-description` override.
  Teacher eval -> `metrics`, `download-predictions` into `results/teacher-eval-3cb7da8c/`, `score_predictions.ts --misses`.

### INCIDENT: platform teacher provider out of credits (2026-10-12 07:20 UTC)

- Teacher evaluation 3cb7da8c ran 07:20:48 to 07:20:56 and reported **JOB_SUCCESS** with
  `rouge 0, binary 0, llm-as-a-judge null` and 64/64 empty predictions (`{"role":"assistant","content":""}`).
  Its log (`results/teacher-eval-3cb7da8c/job_log.txt`) holds 192 lines of
  `WARNING LLM call failed, returning an empty reply: APIStatusError("Error code: 402 - Insufficient credits. Add more using
  https://openrouter.ai/settings/credits ... limit_source: openrouter_credits")`. The platform's own OpenRouter account,
  through which hosted teachers are called, has no balance. Nothing on our side changed between smoke 1 (06:59, clean) and
  this job.
- Smoke 2 dea53daf started its generation calls at 07:20:31 and hit the same 402 on every call: by 07:24:20 its log showed
  658 iterations with "generated 0 examples" and 5,272 402 errors, status still JOB_RUNNING (the job loops instead of
  failing; no CLI or documented API route stops a dataset job).
- The smoke-2 watcher was killed before it could evaluate its gate; the **full generation was not launched**.
- Credits consumed by the two failed jobs: 1 `teacher_evaluations_post` (4 left), 1 `datasets_from_datasets_smoke_post` (18 left).
- Resume plan once distil labs restores the provider: re-run the teacher evaluation first (its log shows within a minute
  whether 402s persist), then smoke 2 with the revised instructions, then the full run on parent 85bcc9fb. Platform
  behaviour to report: a job whose every LLM call fails still ends in JOB_SUCCESS (teacher eval) or loops on 0-row
  iterations (generation) rather than failing.

### Resume after the provider top-up (2026-10-12 07:43 UTC)

- Jacek confirmed distil labs' OpenRouter balance was topped up. The old smoke 2 (dea53daf) had meanwhile ended at
  iteration 999 with 0 generated rows and status JOB_SUCCESS (8,000 x 402 in its log; last at 07:26:22). Unusable.
- Teacher evaluation re-run: `distil teacher-evaluation create-from-dataset --output json 85bcc9fb-...` ->
  **TeacherEvaluation b153e39f-e24f-4cc6-aa44-cdf3fc5645f7** (07:43:26; 1 credit; 3 left).
- Smoke 2 re-run: `distil dataset generate-synthetic-data-train --smoke --output json --job-description platform-v6/job_description.json 85bcc9fb-...`
  -> **smoke Dataset 0c718c71-2848-486a-a133-74da1c809276** (1 smoke credit; 17 left). Watcher gate adds: zero 402 lines in the job log.
