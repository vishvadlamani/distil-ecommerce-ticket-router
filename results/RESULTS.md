| Model | Curated 24 | Real 40 | Blended 64 | Valid JSON (64) | Latency p50 / p95 | Cost per 1,000 tickets |
|---|---|---|---|---|---|---|
| Untrained Qwen3-1.7B | 8/24 (33.3%, 18–53) | 15/40 (37.5%, 24–53) | 23/64 (35.9%, 25–48) | 62/64 | 0.60 s / 0.75 s | same endpoint as the tuned 1.7B |
| Untrained Qwen3-0.6B | 3/24 (12.5%, 4–31) | 0/40 (0.0%, 0–9) | 3/64 (4.7%, 2–13) | 61/64 | 2.87 s / 3.66 s | same endpoint as the tuned 0.6B |
| Teacher: GLM 5.3 low-thinking (platform) | 22/24 (91.7%, 74–98) | 25/40 (62.5%, 47–76) | 47/64 (73.4%, 62–83) | 64/64 | n/a | hosted teacher, no per-call price |
| Tuned Qwen3-1.7B | 22/24 (91.7%, 74–98) | 23/40 (57.5%, 42–71) | 45/64 (70.3%, 58–80) | 64/64 | 0.81 s / 1.06 s | $0.0083 ($3/h GPU at 101.01 rps, 128 in flight, not yet plateaued) |
| Tuned Qwen3-0.6B | 23/24 (95.8%, 80–99) | 24/40 (60.0%, 45–74) | 47/64 (73.4%, 62–83) | 64/64 | 3.09 s / 4.95 s | $0.0047 ($1/h GPU at 59.32 rps, 512 in flight, plateau) |

Correct = intent, order_id and needs_human exact, urgency within 1, action allowed for the intent (the platform judge's rules, scored locally by src/scoring.ts). Intervals are 95% Wilson.
