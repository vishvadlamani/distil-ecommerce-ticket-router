"""Publish a round-2 release directory to Hugging Face.

Expects HF_TOKEN in the environment (a write token for the target account). Uploads every file
except README.md first, then README.md last, so the model card is never clobbered by the
platform's stub (the August trap). Layout expected in <release-dir>:

  merged/   config.json generation_config.json model.safetensors tokenizer.json tokenizer_config.json chat_template.jinja
  adapter/  adapter_config.json adapter_model.safetensors
  *.gguf Modelfile model_client.py LICENSE STUDENT_LICENSE TEACHER_LICENSE README.md

Usage: python scripts/publish_hf.py <release-dir> <repo-id>   e.g. vishinvents/distil-qwen3-0.6b-ecom-ticket-router
"""
import os, sys
from pathlib import Path
from huggingface_hub import HfApi

rel, repo = Path(sys.argv[1]), sys.argv[2]
token = os.environ.get("HF_TOKEN")
if not token:
    sys.exit("HF_TOKEN is not set; add it as an environment secret and start a new session")
api = HfApi(token=token)
api.create_repo(repo, repo_type="model", exist_ok=True)
# 1. merged weights at the repo root
api.upload_folder(repo_id=repo, folder_path=str(rel / "merged"), path_in_repo=".", ignore_patterns=["README.md"], commit_message="merged weights and tokenizer")
# 2. adapter, gguf, client, licenses, Modelfile
api.upload_folder(repo_id=repo, folder_path=str(rel / "adapter"), path_in_repo="adapter", commit_message="LoRA adapter")
for f in sorted(rel.glob("*")):
    if f.is_file() and f.name != "README.md":
        api.upload_file(repo_id=repo, path_or_fileobj=str(f), path_in_repo=f.name, commit_message=f"add {f.name}")
# 3. the model card last
api.upload_file(repo_id=repo, path_or_fileobj=str(rel / "README.md"), path_in_repo="README.md", commit_message="model card")
print("published", f"https://huggingface.co/{repo}")
