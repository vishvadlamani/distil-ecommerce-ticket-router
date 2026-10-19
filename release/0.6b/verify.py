"""Verify a merged release directory reproduces the platform's predictions (greedy, thinking off)."""
import json, sys
from pathlib import Path
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
OUT, TEST, PREDS, JD = map(Path, sys.argv[1:5])
idx = [int(x) for x in (sys.argv[5] if len(sys.argv) > 5 else "0,1,10,20,33,44").split(",")]
tok = AutoTokenizer.from_pretrained(OUT); model = AutoModelForCausalLM.from_pretrained(OUT, dtype=torch.bfloat16).eval()
sys_prompt = json.loads(JD.read_text())["task_description"]
rows = [json.loads(l) for l in TEST.read_text().splitlines() if l.strip()]
preds = {}
for l in PREDS.read_text().splitlines():
    if not l.strip(): continue
    p = json.loads(l); pr = p["prompt"][0]["content"] if isinstance(p["prompt"], list) else p["prompt"]
    preds[pr] = p["prediction"]["content"] if isinstance(p["prediction"], dict) else p["prediction"]
same = 0
for i in idx:
    user = rows[i]["messages"][0]["content"]
    enc = tok.apply_chat_template([{"role": "system", "content": sys_prompt}, {"role": "user", "content": user}], add_generation_prompt=True, enable_thinking=False, return_tensors="pt", return_dict=True)
    with torch.no_grad():
        out = model.generate(**enc, max_new_tokens=120, do_sample=False)
    text = tok.decode(out[0][enc["input_ids"].shape[1]:], skip_special_tokens=True).strip()
    plat = preds.get(user, "<none>"); ok = text == plat; same += ok
    print(f"row {i:2d} {'SAME' if ok else 'DIFF'} | local: {text[:150]}" + ("" if ok else f"\n        platform: {plat[:150]}"))
print(f"verification: {same}/{len(idx)} rows identical to the platform's predictions")
