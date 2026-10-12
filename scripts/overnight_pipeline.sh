#!/usr/bin/env bash
# Round-2 overnight pipeline (detached, resumable). Every stage writes a marker under $STATE and
# skips itself on re-run, so the script can be restarted after a container reset.
#
#   A  wait for the full generation (97b42e81) and its audit (full_audit.txt from the watcher)
#   B  gate: rows >= 9000, no JSON/schema failures, hard-violation rows <= 2%, format rows <= 3%, zero 402s
#   C  download the generated dataset's expanded config, write one override per student, launch both trainings
#   D  poll trainings; on success fetch metrics, predictions, metadata (model_client.py); score locally; commit
#   E  per student: deploy, resolve the direct vLLM endpoint, eval tuned (`model`) and untrained (`base`),
#      concurrency sweep, delete the deployment, confirm stopped; commit
#   F  done marker
#
# Usage: nohup bash scripts/overnight_pipeline.sh > $S/pipeline.log 2>&1 &
set -u
export PATH="$HOME/.local/bin:$PATH"
REPO=/home/user/distil-ecommerce-ticket-router
S=/tmp/claude-0/-home-user/e3056440-6030-592e-b0b4-c5d16c671e46/scratchpad/platform
STATE=$S/state; mkdir -p $STATE
FULL=97b42e81-2357-4c88-a8ed-3b8c15402e32
API=https://api.distillabs.ai
cd $REPO
log() { echo "$(date -u +%FT%TZ) $*"; }
jget() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(d$1 if isinstance(d,dict) else '')" 2>/dev/null; }
commit_push() { git add -A results RUN_LOG.md >/dev/null 2>&1; git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -q -m "$1

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ru75hRTmncG9kyUTorP9Xe" >/dev/null 2>&1 && git push -q origin round2-platform-native >/dev/null 2>&1 && log "pushed: $1" || log "nothing to commit or push failed: $1"; }

# ---------------------------------------------------------------- A: wait for generation + audit
if [ ! -f $STATE/A.done ]; then
  log "A: waiting for full generation $FULL"
  while true; do
    ST=$(distil dataset status --output json $FULL 2>/dev/null | jget "['status']")
    [ "$ST" = "JOB_SUCCESS" ] && break
    if [ "$ST" = "JOB_FAILURE" ] || [ "$ST" = "JOB_STOPPED" ]; then log "A: generation $ST; stopping"; exit 1; fi
    sleep 300
  done
  log "A: generation JOB_SUCCESS; waiting for the watcher's audit"
  for i in $(seq 1 30); do [ -f $S/full_audit.txt ] && break; sleep 30; done
  OUT=$S/full-$FULL
  if [ ! -f $S/full_audit.txt ]; then
    log "A: watcher audit missing; auditing here"; mkdir -p $OUT
    distil dataset download -d $OUT $FULL >/dev/null 2>&1
    bun scripts/check_sample.ts $OUT/train.jsonl --skip 115 --show 5 > $S/full_audit.txt 2>&1
  fi
  [ -f $OUT/job_log.txt ] || distil dataset logs --output json $FULL | python3 -I -c "import json,sys; print(json.load(sys.stdin).get('logs',''))" > $OUT/job_log.txt
  touch $STATE/A.done
fi
OUT=$S/full-$FULL

# ---------------------------------------------------------------- B: gate
if [ ! -f $STATE/B.done ]; then
  N402=$(grep -c 'Error code: 402' $OUT/job_log.txt || true)
  GATE=$(python3 -I - $S/full_audit.txt "$N402" <<'PY'
import re,sys
t=open(sys.argv[1]).read(); n402=int(sys.argv[2])
rows=int(re.search(r"rows=(\d+)",t).group(1)); bj=int(re.search(r"bad_json=(\d+)",t).group(1)); bs=int(re.search(r"bad_schema=(\d+)",t).group(1))
hard=int(re.search(r"HARD violations: rows=(\d+)",t).group(1)); fmt=int(re.search(r"FORMAT issues:\s+rows=(\d+)",t).group(1))
ok = rows>=9000 and bj==0 and bs==0 and hard<=0.02*rows and fmt<=0.03*rows and n402==0
print("PASS" if ok else "FAIL", f"rows={rows} bad_json={bj} bad_schema={bs} hard={hard} fmt={fmt} n402={n402}")
PY
)
  log "B: gate $GATE"; echo "$GATE" > $S/full_gate.txt
  mkdir -p results/full-97b42e81 && cp $S/full_audit.txt results/full-97b42e81/audit.txt && echo "$GATE" > results/full-97b42e81/gate.txt
  cat >> RUN_LOG.md <<EOF

### Step 4 result: full generation 97b42e81 (auto-logged $(date -u +%FT%TZ))

- Audit over every generated row (\`check_sample.ts --skip 115\`, evidence in \`results/full-97b42e81/audit.txt\`): gate **$GATE**.
EOF
  commit_push "Full generation 97b42e81 audited: $GATE"
  echo "$GATE" | grep -q '^PASS' || { log "B: gate failed; no training launched"; exit 2; }
  touch $STATE/B.done
fi

# ---------------------------------------------------------------- C: overrides + trainings
if [ ! -f $STATE/C.done ]; then
  mkdir -p $S/train-overrides results/full-97b42e81
  distil dataset download-metadata -d $S/train-overrides/parent $FULL >/dev/null 2>&1 || { log "C: metadata download failed"; exit 3; }
  cp $S/train-overrides/parent/config.yaml results/full-97b42e81/expanded_config.yaml
  for st in Qwen3-1.7B Qwen3-0.6B; do
    python3 -I - $S/train-overrides/parent/config.yaml $S/train-overrides/config_$st.yaml $st <<'PY'
import re,sys
src,dst,student=sys.argv[1:4]
s=open(src).read()
s2,n=re.subn(r"(?m)^(\s*student_model_name:\s*).*$", r"\g<1>"+student, s)
assert n==1, f"student_model_name lines: {n}"
open(dst,"w").write(s2)
PY
  done
  cp $S/train-overrides/config_Qwen3-1.7B.yaml results/full-97b42e81/train_config_1p7b.yaml
  cp $S/train-overrides/config_Qwen3-0.6B.yaml results/full-97b42e81/train_config_0p6b.yaml
  : > $S/slm_ids
  for st in Qwen3-1.7B Qwen3-0.6B; do
    OUTJ=$(distil slm create-from-dataset --output json --config $S/train-overrides/config_$st.yaml $FULL 2>&1)
    SID=$(echo "$OUTJ" | jget "['id']")
    if [ -z "$SID" ]; then log "C: training launch failed for $st: $OUTJ"; exit 3; fi
    echo "$st $SID" >> $S/slm_ids; log "C: training $st -> SLM $SID"
  done
  {
    echo "- Trainings launched $(date -u +%FT%TZ) with complete config overrides derived from the generated dataset's expanded config"
    echo "  (\`results/full-97b42e81/train_config_*.yaml\`, only \`student_model_name\` differs):"
    while read st sid; do echo "  - $st -> **SLM $sid**"; done < $S/slm_ids
    echo "  2 \`slms_from_datasets_post\` credits (3 left)."
  } >> RUN_LOG.md
  commit_push "Trainings launched on dataset 97b42e81"
  touch $STATE/C.done
fi

# ---------------------------------------------------------------- D: poll trainings, fetch, score
if [ ! -f $STATE/D.done ]; then
  log "D: polling trainings"
  for i in $(seq 1 96); do
    ALL=1
    while read st sid; do
      ST=$(distil slm status --output json $sid 2>/dev/null | jget "['status']")
      echo "$(date -u +%FT%TZ) $st $sid $ST" >> $S/train_watch.log
      case "$ST" in JOB_SUCCESS) ;; JOB_FAILURE|JOB_STOPPED) log "D: $st $sid $ST"; distil slm logs --output json $sid | python3 -I -c "import json,sys; print(json.load(sys.stdin).get('logs','')[-3000:])" > $S/train_fail_$sid.txt; touch $STATE/D_failed_$sid;; *) ALL=0;; esac
    done < $S/slm_ids
    [ $ALL = 1 ] && break
    sleep 300
  done
  while read st sid; do
    [ -f $STATE/D_failed_$sid ] && continue
    D=results/slm-$sid; mkdir -p $D
    distil slm metrics --output json $sid > $D/metrics.json 2>&1
    distil slm download-metadata -d $D/metadata $sid >/dev/null 2>&1
    for t in 1 2 3; do distil slm download-predictions --file-name $D/predictions.jsonl $sid >/dev/null 2>&1 && break; sleep 30; done
    distil slm logs --output json $sid | python3 -I -c "import json,sys; print(json.load(sys.stdin).get('logs',''))" > $D/job_log.txt 2>/dev/null
    bun scripts/score_predictions.ts $D/predictions.jsonl --name "tuned $st" --json $D/score.json --misses > $D/score.txt 2>&1
    log "D: $st scored: $(grep blended $D/score.txt | head -1)"
    PM=$(python3 -I -c "import json; d=json.load(open('$D/metrics.json')); b=d.get('base_model_performance') or {}; t=d.get('tuned_model_performance') or {}; f=lambda x: 'n/a' if x is None else f'{x:.3f}'; print('base judge', f(b.get('llm-as-a-judge')), '/ ref-free', f(b.get('llm-as-a-judge-reference-free')), '| tuned judge', f(t.get('llm-as-a-judge')), '/ ref-free', f(t.get('llm-as-a-judge-reference-free')), '/ binary', f(t.get('binary')))" 2>/dev/null)
    {
      echo "- **$st (SLM $sid)** finished $(date -u +%FT%TZ). Platform metrics (\`results/slm-$sid/metrics.json\`): $PM"
      echo "  Local scorer (\`results/slm-$sid/score.txt\`):"
      grep -E "curated|real   |blended" $D/score.txt | sed 's/^/  /'
    } >> RUN_LOG.md
  done < $S/slm_ids
  commit_push "Trainings finished: metrics, predictions and local scores"
  touch $STATE/D.done
fi

# ---------------------------------------------------------------- E: deploy, eval, sweep, delete
if [ ! -f $STATE/E.done ]; then
  # cleanup after an interrupted run: delete any deployment recorded without a done marker
  if [ -f $S/deployment_ids ]; then
    while read st sid did; do
      [ -f $STATE/E_$sid.done ] && continue
      EST=$(distil deployment status --output json $did 2>/dev/null | jget "['endpoint_status']")
      if [ "$EST" != "stopped" ]; then log "E: cleanup: deleting orphaned deployment $did ($st, endpoint_status=$EST)"; distil deployment delete $did >/dev/null 2>&1; fi
    done < $S/deployment_ids
  fi
  while read st sid; do
    [ -f $STATE/D_failed_$sid ] && continue
    [ -f $STATE/E_$sid.done ] && continue
    case "$st" in Qwen3-1.7B) HOURLY=3;; *) HOURLY=1;; esac
    OUTJ=$(distil deployment create-from-slm --output json $sid 2>&1); DID=$(echo "$OUTJ" | jget "['id']")
    if [ -z "$DID" ]; then log "E: deployment launch failed for $st: $OUTJ"; continue; fi
    log "E: $st deployment $DID (hourly \$$HOURLY)"; echo "$st $sid $DID" >> $S/deployment_ids
    D=results/deploy-$DID; mkdir -p $D
    T0=$(date -u +%s); DST=""; EST=""
    for i in $(seq 1 60); do DS=$(distil deployment status --output json $DID 2>/dev/null); DST=$(echo "$DS" | jget "['deployment_status']"); EST=$(echo "$DS" | jget "['endpoint_status']"); [ "$DST" = "JOB_SUCCESS" ] && break; [ "$DST" = "JOB_FAILURE" ] && break; sleep 30; done
    log "E: $st deployment_status=$DST endpoint_status=$EST after $(( $(date -u +%s) - T0 )) s"
    if [ "$DST" != "JOB_SUCCESS" ]; then distil deployment logs --output json $DID | python3 -I -c "import json,sys; print(json.load(sys.stdin).get('logs','')[-3000:])" > $D/deploy_fail.txt; continue; fi
    EP=$(curl -sS -m 30 -H "Authorization: Bearer $(distil access-token)" $API/deployments/$DID/endpoint)
    URL=$(echo "$EP" | jget "['url']"); export DISTIL_DEPLOYMENT_KEY=$(echo "$EP" | jget "['api_key']")
    if [ -z "$URL" ] || [ "$URL" = "None" ]; then log "E: no endpoint url for $DID"; distil deployment delete $DID >/dev/null 2>&1; continue; fi
    echo "url=$URL" > $D/endpoint.txt
    BASE=""; CODE=""
    for cand in "${URL%/}/v1" "${URL%/}"; do
      for i in $(seq 1 40); do
        CODE=$(curl -sS -m 60 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $DISTIL_DEPLOYMENT_KEY" -H 'Content-Type: application/json' -d '{"model":"model","messages":[{"role":"user","content":"ping"}],"max_tokens":4}' "$cand/chat/completions")
        [ "$CODE" = "200" ] && { BASE=$cand; break 2; }
        [ "$CODE" = "404" ] && [ $i -gt 3 ] && break
        sleep 15
      done
    done
    if [ -z "$BASE" ]; then log "E: endpoint never answered 200 for $DID (last code $CODE)"; distil deployment delete $DID >/dev/null 2>&1; continue; fi
    log "E: endpoint ready at ${BASE} (model=model)"; echo "base_url=$BASE" >> $D/endpoint.txt
    bun scripts/endpoint_eval.ts --base-url $BASE --model model --out $D/endpoint_eval_model.jsonl --concurrency 1 > $D/endpoint_eval_model.log 2>&1
    bun scripts/endpoint_eval.ts --base-url $BASE --model base --out $D/endpoint_eval_base.jsonl --concurrency 1 > $D/endpoint_eval_base.log 2>&1 || log "E: base-model eval failed (see log)"
    bun scripts/throughput_sweep.ts --base-url $BASE --levels 8,16,32,64 --requests 256 --hourly $HOURLY --out $D/sweep.jsonl > $D/sweep.log 2>&1
    EXT=$(python3 -I - $D/sweep.jsonl <<'PY'
import json,sys
try:
    r={json.loads(l)["concurrency"]:json.loads(l)["rps"] for l in open(sys.argv[1]) if l.strip()}
    print("yes" if 32 in r and 64 in r and r[64] > 1.15*r[32] else "no")
except Exception: print("no")
PY
)
    [ "$EXT" = "yes" ] && bun scripts/throughput_sweep.ts --base-url $BASE --levels 96,128 --requests 384 --hourly $HOURLY --out $D/sweep.jsonl >> $D/sweep.log 2>&1
    distil deployment delete $DID >/dev/null 2>&1
    for i in $(seq 1 20); do EST=$(distil deployment status --output json $DID 2>/dev/null | jget "['endpoint_status']"); [ "$EST" = "stopped" ] && break; sleep 15; done
    log "E: $st deployment $DID deleted; endpoint_status=$EST; total deployment time $(( $(date -u +%s) - T0 )) s"
    unset DISTIL_DEPLOYMENT_KEY
    bun scripts/score_predictions.ts $D/endpoint_eval_model.jsonl --name "tuned $st via deployment" --json $D/score_model.json --misses > $D/score_model.txt 2>&1
    [ -s $D/endpoint_eval_base.jsonl ] && bun scripts/score_predictions.ts $D/endpoint_eval_base.jsonl --name "untrained $st via deployment" --json $D/score_base.json --misses > $D/score_base.txt 2>&1
    {
      echo "- **Deployment $DID** ($st, SLM $sid, \$$HOURLY/h) $(date -u +%FT%TZ): endpoint_status after delete = $EST, deployment time $(( $(date -u +%s) - T0 )) s."
      echo "  Endpoint eval (64 rows, sequential): $(grep blended $D/score_model.txt | head -1)"
      echo "  Untrained base via the same endpoint: $(grep blended $D/score_base.txt 2>/dev/null | head -1 || echo "n/a")"
      echo "  Sweep (\`results/deploy-$DID/sweep.jsonl\`):"
      grep -E "^conc=" $D/sweep.log | sed 's/^/  /'
    } >> RUN_LOG.md
    touch $STATE/E_$sid.done
    commit_push "Deployment $DID: endpoint eval and throughput sweep for $st"
  done < $S/slm_ids
  touch $STATE/E.done
fi
touch $STATE/F.done; log "F: pipeline complete"
