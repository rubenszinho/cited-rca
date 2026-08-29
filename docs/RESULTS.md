# Results

Reference variant: `baseline`. Each cell is mean ± stdev across seeds; delta is versus the reference.

`replayed_calls` equal to `llm_calls` means the run came from the committed cassettes. For those rows `duration_s` and `seconds_per_case` measure replay, not the recorded run; token counts and cost are the recorded values and are comparable.

| variant | runs | cases | cause_accuracy | citation_validity | completion_tokens | cost_usd | duration_s | evidence_recall | llm_calls | pass_rate | prompt_tokens | provider_errors | red_herring_rate | replayed_calls | seconds_per_case |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `baseline` | 3/3 | 12 ± 0 | 0.8333 ± 0 | 0.6111 ± 0.04815 | 2.79e+04 ± 598.8 | 0.8512 ± 0.008954 | 0.3995 ± 0.006188 | 0.9259 ± 0.01599 | 12 ± 0 | 0.3611 ± 0.04815 | 1.44e+05 ± 0 | 0 ± 0 | 0.3889 ± 0.04815 | 12 ± 0 | 0.003 ± 0 |
| `agent` | 3/3 | 12 ± 0 (+0.0%) | 0.9167 ± 0 (+10.0%) | 1 ± 0 (+63.6%) | 2.87e+04 ± 1.68e+03 (+3.1%) | 0.7064 ± 0.04719 (-17.0%) | 0.4157 ± 0.02668 (+4.1%) | 0.9259 ± 0.01599 (+0.0%) | 13 ± 1 (+8.3%) | 0.6667 ± 0 (+84.6%) | 9.19e+04 ± 7.37e+03 (-36.4%) | 0 ± 0 | 0.3055 ± 0.04809 (-21.4%) | 13 ± 1 (+8.3%) | 0.003333 ± 0.000577 (+11.1%) |
| `agent-memory` | 3/3 | 12 ± 0 (+0.0%) | 1 ± 0 (+20.0%) | 1 ± 0 (+63.6%) | 2.81e+04 ± 2.33e+03 (+0.7%) | 0.6921 ± 0.06093 (-18.7%) | 0.4005 ± 0.007541 (+0.2%) | 0.9259 ± 0.01599 (+0.0%) | 12.67 ± 1.155 (+5.6%) | 0.6389 ± 0.04815 (+76.9%) | 9.03e+04 ± 8.68e+03 (-37.4%) | 0 ± 0 | 0.25 ± 0 (-35.7%) | 12.67 ± 1.155 (+5.6%) | 0.004 ± 0 (+33.3%) |
| `agent-nosearch` | 3/3 | 12 ± 0 (+0.0%) | 0.9167 ± 0 (+10.0%) | 1 ± 0 (+63.6%) | 3e+04 ± 535.8 (+7.8%) | 0.6845 ± 0.008314 (-19.6%) | 368 ± 8.08 (+92010.8%) | 0.5926 ± 0.01605 (-36.0%) | 14 ± 0 (+16.7%) | 0 ± 0 (-100.0%) | 7.8e+04 ± 167.9 (-46.0%) | 0 ± 0 | 0.2778 ± 0.04809 (-28.6%) | 0 ± 0 (-100.0%) | 30.64 ± 0.671 (+1021077.8%) |
| `agent-noverify` | 3/3 | 12 ± 0 (+0.0%) | 0.9167 ± 0 (+10.0%) | 0.9722 ± 0.04809 (+59.1%) | 2.81e+04 ± 1.18e+03 (+0.7%) | 0.689 ± 0.03168 (-19.1%) | 0.381 ± 0.00778 (-4.6%) | 0.9259 ± 0.01599 (+0.0%) | 12.67 ± 0.5774 (+5.6%) | 0.6389 ± 0.04815 (+76.9%) | 8.93e+04 ± 4.76e+03 (-38.1%) | 0 ± 0 | 0.3055 ± 0.04809 (-21.4%) | 12.67 ± 0.5774 (+5.6%) | 0.003667 ± 0.000577 (+22.2%) |
| `agent-withtriage` | 3/3 | 12 ± 0 (+0.0%) | 0.8611 ± 0.04815 (+3.3%) | 1 ± 0 (+63.6%) | 3.53e+04 ± 2.21e+03 (+26.7%) | 1.008 ± 0.05718 (+18.5%) | 0.3931 ± 0.002909 (-1.6%) | 0.9629 ± 0.01605 (+4.0%) | 25 ± 1 (+108.3%) | 0.6111 ± 0.04815 (+69.2%) | 1.6e+05 ± 8.59e+03 (+10.5%) | 0 ± 0 | 0.3333 ± 0 (-14.3%) | 25 ± 1 (+108.3%) | 0.004 ± 0 (+33.3%) |

## Provenance

| variant | commit | container | command |
|---|---|---|---|
| `baseline` | `a9cb918b4d21` | `host` | `pnpm exec tsx src/baseline/run.ts` |
| `agent` | `a9cb918b4d21` | `host` | `pnpm exec tsx src/agent/run.ts` |
| `agent-memory` | `c7868fe5e81b` | `host` | `pnpm exec tsx src/agent/run.ts` |
| `agent-nosearch` | `4a7eb8edf7fc` | `host` | `pnpm exec tsx src/agent/run.ts` |
| `agent-noverify` | `c7868fe5e81b` | `host` | `pnpm exec tsx src/agent/run.ts` |
| `agent-withtriage` | `c7868fe5e81b` | `host` | `pnpm exec tsx src/agent/run.ts` |
