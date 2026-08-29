# Results

Reference variant: `baseline`. Each cell is mean ± stdev across seeds; delta is versus the reference.

`replayed_calls` equal to `llm_calls` means the run came from the committed cassettes. For those rows `duration_s` and `seconds_per_case` measure replay, not the recorded run; token counts and cost are the recorded values and are comparable.

| variant | runs | cases | cause_accuracy | citation_validity | completion_tokens | cost_usd | duration_s | evidence_recall | llm_calls | pass_rate | prompt_tokens | provider_errors | red_herring_rate | replayed_calls | seconds_per_case |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `baseline` | 3/3 | 12 ± 0 | 0.9167 ± 0 | 0.6111 ± 0.04815 | 2.81e+04 ± 478.8 | 0.8544 ± 0.007219 | 11.48 ± 19.22 | 0.9444 ± 0.02775 | 12 ± 0 | 0.3611 ± 0.04815 | 1.44e+05 ± 0 | 0 ± 0 | 0.3611 ± 0.04815 | 11.67 ± 0.5774 | 0.9277 ± 1.602 |
| `agent` | 3/3 | 12 ± 0 (+0.0%) | 1 ± 0 (+9.1%) | 1 ± 0 (+63.6%) | 2.88e+04 ± 1.8e+03 (+2.7%) | 0.7082 ± 0.04904 (-17.1%) | 9.876 ± 16.44 (-14.0%) | 0.9444 ± 0 (-0.0%) | 13 ± 1 (+8.3%) | 0.6667 ± 0 (+84.6%) | 9.19e+04 ± 7.37e+03 (-36.4%) | 0 ± 0 | 0.3333 ± 0 (-7.7%) | 12.67 ± 0.5774 (+8.6%) | 0.793 ± 1.368 (-14.5%) |
| `agent-memory` | 3/3 | 12 ± 0 (+0.0%) | 1 ± 0 (+9.1%) | 1 ± 0 (+63.6%) | 2.84e+04 ± 2.22e+03 (+1.1%) | 0.6967 ± 0.05932 (-18.5%) | 34.83 ± 2.848 (+203.5%) | 0.9259 ± 0.01599 (-2.0%) | 12.67 ± 1.155 (+5.6%) | 0.6389 ± 0.04815 (+76.9%) | 9.03e+04 ± 8.68e+03 (-37.4%) | 0 ± 0 | 0.3055 ± 0.04809 (-15.4%) | 11.67 ± 1.155 (+0.0%) | 2.873 ± 0.2364 (+209.7%) |
| `agent-nosearch` | 3/3 | 12 ± 0 (+0.0%) | 0.9167 ± 0 (+0.0%) | 1 ± 0 (+63.6%) | 3.07e+04 ± 1.69e+03 (+9.3%) | 0.7036 ± 0.041 (-17.7%) | 35.72 ± 11.2 (+211.2%) | 0.5926 ± 0.01605 (-37.3%) | 14.33 ± 0.5774 (+19.4%) | 0 ± 0 (-100.0%) | 8.11e+04 ± 5.3e+03 (-43.8%) | 0 ± 0 | 0.2778 ± 0.04809 (-23.1%) | 13 ± 0 (+11.4%) | 2.948 ± 0.934 (+217.8%) |
| `agent-noverify` | 3/3 | 12 ± 0 (+0.0%) | 1 ± 0 (+9.1%) | 0.9722 ± 0.04809 (+59.1%) | 2.82e+04 ± 1.32e+03 (+0.4%) | 0.6908 ± 0.0339 (-19.1%) | 0.3764 ± 0.00692 (-96.7%) | 0.9444 ± 0 (-0.0%) | 12.67 ± 0.5774 (+5.6%) | 0.6389 ± 0.04815 (+76.9%) | 8.93e+04 ± 4.76e+03 (-38.1%) | 0 ± 0 | 0.3333 ± 0 (-7.7%) | 12.67 ± 0.5774 (+8.6%) | 0.003 ± 0 (-99.7%) |
| `agent-withtriage` | 3/3 | 12 ± 0 (+0.0%) | 0.8611 ± 0.04815 (-6.1%) | 1 ± 0 (+63.6%) | 3.57e+04 ± 2.06e+03 (+27.0%) | 1.014 ± 0.05403 (+18.7%) | 37.92 ± 6.38 (+230.4%) | 0.9629 ± 0.01605 (+2.0%) | 25 ± 1 (+108.3%) | 0.6111 ± 0.04815 (+69.2%) | 1.6e+05 ± 8.36e+03 (+10.7%) | 0 ± 0 | 0.3333 ± 0 (-7.7%) | 23.33 ± 1.528 (+100.0%) | 3.131 ± 0.5314 (+237.5%) |

## Provenance

| variant | commit | container | command |
|---|---|---|---|
| `baseline` | `4c0d1a80d298` | `host` | `pnpm exec tsx src/baseline/run.ts` |
| `agent` | `4c0d1a80d298` | `host` | `pnpm exec tsx src/agent/run.ts` |
| `agent-memory` | `4c0d1a80d298` | `host` | `pnpm exec tsx src/agent/run.ts` |
| `agent-nosearch` | `4c0d1a80d298` | `host` | `pnpm exec tsx src/agent/run.ts` |
| `agent-noverify` | `4c0d1a80d298` | `host` | `pnpm exec tsx src/agent/run.ts` |
| `agent-withtriage` | `4c0d1a80d298` | `host` | `pnpm exec tsx src/agent/run.ts` |
