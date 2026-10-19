#!/usr/bin/env bash
# End-to-end release of the round-2 Qwen3-0.6B router to Hugging Face.
#   1. download the SLM from distil labs (adapter + tokenizer + client)
#   2. merge the LoRA into Qwen/Qwen3-0.6B (bf16 safetensors), fix tokenizer_config.json
#   3. verify the merged model reproduces the platform's predictions (greedy, thinking off)
#   4. convert an f16 GGUF with llama.cpp and assemble the release folder
#   5. publish with scripts/publish_hf.py (README last); needs HF_TOKEN in the environment
# Usage: bash release/0.6b/release.sh [work-dir]      (needs: distil CLI signed in, python3, git, ~6 GB disk)
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
REPO=$(cd "$(dirname "$0")/../.." && pwd)
W=${1:-/tmp/router-0p6b-release}; mkdir -p "$W"; cd "$W"
SLM=fc8a659a-fdb5-4159-b507-10ed97528946
HF_REPO=vishinvents/distil-qwen3-0.6b-ecom-ticket-router
GGUF=distil-qwen3-0.6b-ecom-ticket-router-f16.gguf

[ -f slm/model.tar ] || distil slm download -d slm $SLM
[ -d extract/model-adapter ] || { mkdir -p extract && tar -xf slm/model.tar -C extract; }
[ -x venv/bin/python ] || { python3 -m venv venv && venv/bin/pip install -q --upgrade pip && venv/bin/pip install -q torch --index-url https://download.pytorch.org/whl/cpu && venv/bin/pip install -q transformers peft huggingface_hub safetensors accelerate sentencepiece numpy gguf; }
[ -d llama.cpp ] || git clone -q --depth 1 https://github.com/ggml-org/llama.cpp llama.cpp
venv/bin/pip install -q -r llama.cpp/requirements/requirements-convert_hf_to_gguf.txt

export HF_HUB_DISABLE_PROGRESS_BARS=1
[ -f release/merged/model.safetensors ] || venv/bin/python -I "$REPO/release/0.6b/merge.py" extract/model-adapter release/merged
venv/bin/python -I "$REPO/release/0.6b/verify.py" release/merged "$REPO/platform-v6/test.jsonl" "$REPO/results/slm-$SLM/predictions.jsonl" "$REPO/platform-v6/job_description.json" 0,1,10,20,33,44,50,60 | tail -1
[ -f release/$GGUF ] || (cd llama.cpp && ../venv/bin/python convert_hf_to_gguf.py ../release/merged --outfile ../release/$GGUF --outtype f16 >/dev/null)
mkdir -p release/adapter && cp extract/model-adapter/adapter_config.json extract/model-adapter/adapter_model.safetensors release/adapter/
cp extract/model_client.py extract/model-adapter/LICENSE extract/model-adapter/STUDENT_LICENSE extract/model-adapter/TEACHER_LICENSE release/
cp "$REPO/release/0.6b/Modelfile" release/Modelfile && cp "$REPO/release/0.6b/MODEL_CARD.md" release/README.md
ls -la release release/adapter
if [ -n "${HF_TOKEN:-}" ]; then venv/bin/python -I "$REPO/scripts/publish_hf.py" release $HF_REPO; else echo "HF_TOKEN not set: release folder ready at $W/release; set the token and re-run to publish"; fi
