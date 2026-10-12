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
