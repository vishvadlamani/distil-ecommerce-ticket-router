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

### Step 3 result: teacher evaluation b153e39f (2026-10-12 07:46 UTC)

- Job ran 07:46:24 to 07:46:49 (64 rows in 7 s), 0 x 402, 0 warnings. Platform metrics:
  `rouge 0.929, binary 0.609, llm-as-a-judge 0.734, llm-as-a-judge-reference-free 0.891`.
- Local field-level scorer (`scripts/score_predictions.ts`, the judge's rules), 95% Wilson:
  curated **22/24 = 91.7% [74.2, 97.7]**, real **25/40 = 62.5% [47.0, 75.8]**, blended **47/64 = 73.4% [61.5, 82.7]**;
  JSON valid 64/64. The platform judge agrees on every slice (91.7 / 62.5 / 73.4), so local = platform, as in August.
- Against the August teacher (gpt-oss-120b): curated 75.0% -> 91.7% (+4 rows), real 60.0% -> 62.5% (+1), blended 42/64 -> 47/64.
- Misses (full list in `results/teacher-eval-b153e39f/score.txt`): curated #17 (wrong person's parcel: send_replacement/false
  vs escalate/true) and #19 (card declined at checkout: escalate_to_billing vs answer_from_faq; rule 10 of the generation
  instructions covers it, but the evaluation sees only task_description). Real slice: 15 misses, mostly `other` chosen
  over product_question / damaged_item / billing_issue / cancellation on tweets, Twitter handles copied as order ids
  (#39 "@116245", #41 "115821"), needs_human false on rants, and 3 action-table breaks (answer_from_faq for order_status
  on #24, #39, #45). Those are the out-of-domain rows that the 60 real seeds exist for.

### Step 2 result: smoke 2 re-run 0c718c71 passed; full generation launched (2026-10-12 07:50 UTC)

- Smoke 0c718c71 ran 07:47:26 to 07:48:20 (156 rows, 5 iterations), 0 x 402. Audit over the 156 new rows:
  `bad_json=0 bad_schema=0 HARD 0 (0.0%) FORMAT 0 SOFT 0`. Evidence: `results/smoke-0c718c71/{generated_rows.jsonl,audit.txt}`.
- Coverage after the instruction change: account_access 6 escalate / 4 send_password_reset (was 10 / 0); cancellation 6
  cancel_order / 7 escalate; exchange 10 automated / 3 escalate; return 4 / 2; billing_issue 9 answer_from_faq / 1
  escalate_to_billing (small sample; re-checked on the full set). Intents: order_status 28, other 17, refund_status 16,
  damaged_item 16, cancellation 13, exchange 13, sizing_fit 10, account_access 10, billing_issue 10, product_question 9,
  delivery_issue 8, return_request 6.
- Gate PASS (rows>=100, no JSON/schema failures, hard rows <= 2%, format rows <= 3%, zero 402s) -> watcher launched
  `distil dataset generate-synthetic-data-train --output json --job-description platform-v6/job_description.json 85bcc9fb-...`
  -> **full Dataset 97b42e81-2357-4c88-a8ed-3b8c15402e32** (parent 85bcc9fb, target 10,000, 1 generation credit; 4 left).
  Watcher polls every 5 min, then downloads and audits every generated row before any training.

## Feedback for distil labs (running list; turned into a note for Jacek at the end of the run)

Rule (user, 2026-10-12): nothing is filed on distil labs' public repo. This list is for a private note to Jacek,
sent with the results only once each item is confirmed real (reproduced, not observed once) and the run's numbers exist.

Their docs and the `distil-cli` skill (v10.0.3, public at github.com/distil-labs/distil-cli-skill) are the reference this
run follows. Things we hit that belong in those docs or in the platform:

1. **Provider failure is reported as success.** With their OpenRouter balance at zero (07:20 to ~07:40 UTC), the teacher
   evaluation 3cb7da8c returned JOB_SUCCESS with 64/64 empty predictions and metrics `rouge 0, binary 0, judge null`; the
   generation smoke dea53daf looped through 1,000 zero-row iterations (8,000 x 402) and also ended JOB_SUCCESS with no rows.
   Both consumed credits. Expected: fail fast with the provider error in `status`/`logs`, and no credit charged.
2. **Download adds an `images` key to user messages** (`dataset download`, `training-dataset download`). Undocumented;
   harmless for training, but it breaks a byte-identity check against the uploaded file.
3. **Smoke iteration granularity is 32 rows, not `generation_iteration_size` (128).** A 128-row smoke produced 148 and
   156 rows in 5 iterations of ~32. The configuration doc says targets round up to `generation_iteration_size`.
4. **`GET /deployments/<id>/endpoint` returns `{url, api_key}`** for a live deployment, but the CLI has no
   `deployment endpoint` command and the docs say a deployment is never called directly. Either document the direct
   route (it is the right one for load testing a single GPU) or remove it.
5. **A worked example for `synthetic_data_generation_instructions` on a rule-heavy task.** Numbered mechanical label
   rules in the task description's words + the exact input template + a variety paragraph, with GLM 5.3 low-thinking,
   gave 0 hard-rule violations in 304 generated rows across two smokes. The same task in August with gpt-oss-120b and
   no instructions had ~13% of rows breaking a rule. Their job-description page has no example of this shape.
6. **Throughput data point for the docs' "can take 90 minutes":** GLM 5.3 low-thinking generated 156 rows in 54 s
   (smoke) and 380 rows in the first 3 min of the full run at `llm_num_parallel_requests: 4`.
7. **`metrics` on August SLMs** (e.g. 46bf8b2b) answers "No metrics for this SLM yet: the job has not finished" although
   the job finished in August. Legacy entities' metrics look unreadable after the entity migration.
8. **`dataset create --data` silently ignores subdirectories** (our `overrides/`). Worth one line in the CLI reference.
9. **The `training-dataset sample` free sample is gone**; the replacement (`--smoke`) spends a smoke credit and writes a
   side-branch dataset. The migration page covers the commands but not that the sample is now a billed job.

### Overnight approvals (user, 2026-10-12 ~08:55 UTC)

- Approved without further prompts: both trainings (2 training credits) and both deployments (2 deployment credits plus
  GPU time), gated on the full-set audit passing the smoke gate. Deployments are deleted right after their sweep.
- Pipeline: `scripts/overnight_pipeline.sh` (detached, resumable via markers in the scratchpad; auto-appends ids and
  headline numbers here and pushes after each stage). Timed self check-ins every ~30 min keep the session alive.

### Step 4 result: full generation 97b42e81 (auto-logged 2026-10-12T09:39:14Z)

- Audit over every generated row (`check_sample.ts --skip 115`, evidence in `results/full-97b42e81/audit.txt`): gate **PASS rows=10042 bad_json=0 bad_schema=0 hard=4 fmt=75 n402=0**.
- Trainings launched 2026-10-12T09:39:32Z with complete config overrides derived from the generated dataset's expanded config
  (`results/full-97b42e81/train_config_*.yaml`, only `student_model_name` differs):
  - Qwen3-1.7B -> **SLM c1fa3d30-475a-4436-bbca-8833d178563f**
  - Qwen3-0.6B -> **SLM fc8a659a-fdb5-4159-b507-10ed97528946**
  2 `slms_from_datasets_post` credits (3 left).
- Full-set audit detail (10,042 generated rows, 7.47 MB; job 07:52 to 09:35, 82 iterations, 0 x 402): hard-rule rows 4
  (0.04%: 2 prev>=2 labelled no_action on injection-style tickets, 1 escalate with needs_human false, 1 id not verbatim
  in a row with a broken metadata block), template defects 75 (0.7%: `""` fences, `Body: ` with a trailing space, 11
  rows without a parseable metadata block), soft flags 14 (12 processing cancellations escalated with a stated reason,
  2 automated actions with needs_human true). August's dataset: ~13% of rows broke a rule and needed the repair script.
  Trained as generated: no row removed or rewritten.
- Distribution (`results/full-97b42e81/distribution.txt`): every intent >= 393 rows (sizing_fit 393, product_question 424;
  refund_status 1,713, order_status 1,527, other 1,399 largest). Boundaries: post-ship cancellation 325/325 escalate,
  processing cancellation 312 cancel_order / 29 escalate; returns and exchanges within 35 d 892 automated / 33 escalate,
  past 35 d 298/298 escalate; account_access 188 send_password_reset / 393 escalate (the smoke-1 gap is closed).
  Coverage: ~14% non-English, ~7% injection-like, 25% no subject, 340 rows (3.4%) where the text quotes a different id than
  the metadata, 0 seed bodies copied, 34 duplicate bodies (metadata-flip pairs), needs_human 35.5%.
- Risk noted for the student read-out: billing_issue is 475 answer_from_faq vs 108 escalate_to_billing (the balance
  instruction over-corrected toward FAQ); the test set splits billing 50/50. Watch test rows #18 and #32.
- Container restart at ~09:56 UTC (uptime 1 min at the 09:57 check-in) killed the detached pipeline between its 09:44 and
  09:49 polls; files and the distil session survived. Pipeline restarted at 09:58 and resumed at stage D from its markers
  (A, B, C done). Lesson for the guide: a timed self check-in must also verify the detached process is alive and restart it.
