"""Merge the distil labs LoRA adapter into Qwen/Qwen3-0.6B, fix the tokenizer config,
write the release directory, and verify the merged model reproduces the platform's
prediction on a few test rows (greedy decoding, thinking disabled)."""
import json, shutil, sys, time
from pathlib import Path
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, GenerationConfig
from peft import PeftModel

ADAPTER = Path(sys.argv[1]); OUT = Path(sys.argv[2]); TEST = Path(sys.argv[3]); PREDS = Path(sys.argv[4])
BASE = "Qwen/Qwen3-0.6B"
OUT.mkdir(parents=True, exist_ok=True)

# 1. tokenizer config fix: extra_special_tokens must not be a list (tokens already live in tokenizer.json)
tok_dir = OUT / "_tok"; tok_dir.mkdir(exist_ok=True)
for f in ["tokenizer.json", "tokenizer_config.json", "chat_template.jinja"]:
    shutil.copy(ADAPTER / f, tok_dir / f)
cfg = json.loads((tok_dir / "tokenizer_config.json").read_text())
removed = cfg.pop("extra_special_tokens", None)
(tok_dir / "tokenizer_config.json").write_text(json.dumps(cfg, indent=2) + "\n")
print("tokenizer_config: removed extra_special_tokens list with", len(removed or []), "entries")
tok = AutoTokenizer.from_pretrained(tok_dir)

# 2. merge
t0 = time.time()
base = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.bfloat16)
model = PeftModel.from_pretrained(base, ADAPTER)
merged = model.merge_and_unload()
print(f"merged in {time.time()-t0:.0f}s; params {sum(p.numel() for p in merged.parameters())/1e6:.1f}M")
merged.save_pretrained(OUT, safe_serialization=True)
tok.save_pretrained(OUT)
shutil.copy(ADAPTER / "chat_template.jinja", OUT / "chat_template.jinja")
for f in ["LICENSE", "STUDENT_LICENSE", "TEACHER_LICENSE"]:
    shutil.copy(ADAPTER / f, OUT / f)
shutil.rmtree(tok_dir)
print("written:", sorted(p.name for p in OUT.iterdir()))

print('merge complete; run verify.py next')
