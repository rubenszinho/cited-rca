# Results

Reference variant: `baseline`. Each cell is mean ± stdev across seeds; delta is versus the reference.

`replayed_calls` equal to `llm_calls` means the run came from the committed cassettes. For those rows `duration_s` and `seconds_per_case` measure replay, not the recorded run; token counts and cost are the recorded values and are comparable.

| variant | runs | cases | cause_accuracy | citation_validity | completion_tokens | cost_usd | duration_s | evidence_recall | llm_calls | pass_rate | prompt_tokens | provider_errors | red_herring_rate | replayed_calls | seconds_per_case |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `baseline` | 3/3 | 12 ± 0 | 0.9167 ± 0 | 0.6111 ± 0.04815 | 2.81e+04 ± 478.8 | 0.8544 ± 0.007219 | 0.4 ± 0.05162 | 0.9444 ± 0.02775 | 12 ± 0 | 0.3611 ± 0.04815 | 1.44e+05 ± 0 | 0 ± 0 | 0.3611 ± 0.04815 | 12 ± 0 | 0.003 ± 0 |
| `agent` | 3/3 | 12 ± 0 (+0.0%) | 1 ± 0 (+9.1%) | 1 ± 0 (+63.6%) | 2.88e+04 ± 1.8e+03 (+2.7%) | 0.7082 ± 0.04904 (-17.1%) | 0.3987 ± 0.03186 (-0.3%) | 0.9444 ± 0 (-0.0%) | 13 ± 1 (+8.3%) | 0.6667 ± 0 (+84.6%) | 9.19e+04 ± 7.37e+03 (-36.4%) | 0 ± 0 | 0.3333 ± 0 (-7.7%) | 13 ± 1 (+8.3%) | 0.003333 ± 0.000577 (+11.1%) |
| `agent-investigate` | 3/3 | 12 ± 0 (+0.0%) | 0.9722 ± 0.04809 (+6.1%) | 1 ± 0 (+63.6%) | 4.46e+04 ± 2.06e+03 (+58.8%) | 1.882 ± 0.03885 (+120.3%) | 497.6 ± 383.9 (+124308.4%) | 0.9537 ± 0.01605 (+1.0%) | 50 ± 0 (+316.7%) | 0.6944 ± 0.09624 (+92.3%) | 4.05e+05 ± 3.08e+03 (+180.1%) | 0 ± 0 | 0.2222 ± 0.04809 (-38.5%) | 19.33 ± 23.86 (+61.1%) | 41.43 ± 31.99 (+1381033.3%) |
| `agent-memory` | 3/3 | 12 ± 0 (+0.0%) | 1 ± 0 (+9.1%) | 1 ± 0 (+63.6%) | 2.84e+04 ± 2.22e+03 (+1.1%) | 0.6967 ± 0.05932 (-18.5%) | 0.3786 ± 0.008261 (-5.3%) | 0.9259 ± 0.01599 (-2.0%) | 12.67 ± 1.155 (+5.6%) | 0.6389 ± 0.04815 (+76.9%) | 9.03e+04 ± 8.68e+03 (-37.4%) | 0 ± 0 | 0.3055 ± 0.04809 (-15.4%) | 12.67 ± 1.155 (+5.6%) | 0.003667 ± 0.000577 (+22.2%) |
| `agent-nosearch` | 3/3 | 12 ± 0 (+0.0%) | 0.9167 ± 0 (+0.0%) | 1 ± 0 (+63.6%) | 3.07e+04 ± 1.69e+03 (+9.3%) | 0.7036 ± 0.041 (-17.7%) | 0.3515 ± 0.000757 (-12.1%) | 0.5926 ± 0.01605 (-37.3%) | 14.33 ± 0.5774 (+19.4%) | 0 ± 0 (-100.0%) | 8.11e+04 ± 5.3e+03 (-43.8%) | 0 ± 0 | 0.2778 ± 0.04809 (-23.1%) | 14.33 ± 0.5774 (+19.4%) | 0.001 ± 0 (-66.7%) |
| `agent-noverify` | 3/3 | 12 ± 0 (+0.0%) | 1 ± 0 (+9.1%) | 0.9722 ± 0.04809 (+59.1%) | 2.82e+04 ± 1.32e+03 (+0.4%) | 0.6908 ± 0.0339 (-19.1%) | 0.3711 ± 0.004029 (-7.2%) | 0.9444 ± 0 (-0.0%) | 12.67 ± 0.5774 (+5.6%) | 0.6389 ± 0.04815 (+76.9%) | 8.93e+04 ± 4.76e+03 (-38.1%) | 0 ± 0 | 0.3333 ± 0 (-7.7%) | 12.67 ± 0.5774 (+5.6%) | 0.003 ± 0 (+0.0%) |
| `agent-withtriage` | 3/3 | 12 ± 0 (+0.0%) | 0.8611 ± 0.04815 (-6.1%) | 1 ± 0 (+63.6%) | 3.57e+04 ± 2.06e+03 (+27.0%) | 1.014 ± 0.05403 (+18.7%) | 0.384 ± 0.01198 (-4.0%) | 0.9629 ± 0.01605 (+2.0%) | 25 ± 1 (+108.3%) | 0.6111 ± 0.04815 (+69.2%) | 1.6e+05 ± 8.36e+03 (+10.7%) | 0 ± 0 | 0.3333 ± 0 (-7.7%) | 25 ± 1 (+108.3%) | 0.004333 ± 0.000577 (+44.4%) |

## Provenance

| variant | commit | container | command |
|---|---|---|---|
| `baseline` | `d4ff9dcedc45` | `host` | `pnpm exec tsx src/baseline/run.ts` |
| `agent` | `d4ff9dcedc45` | `host` | `pnpm exec tsx src/agent/run.ts` |
| `agent-investigate` | `cb6c6a4b6dbd` | `host` | `pnpm exec tsx src/agent/run.ts` |
| `agent-memory` | `61387feabc61` | `host` | `pnpm exec tsx src/agent/run.ts` |
| `agent-nosearch` | `61387feabc61` | `host` | `pnpm exec tsx src/agent/run.ts` |
| `agent-noverify` | `61387feabc61` | `host` | `pnpm exec tsx src/agent/run.ts` |
| `agent-withtriage` | `61387feabc61` | `host` | `pnpm exec tsx src/agent/run.ts` |
