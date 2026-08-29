# Results

Reference variant: `baseline`. Each cell is mean ± stdev across seeds; delta is versus the reference.

`replayed_calls` equal to `llm_calls` means the run came from the committed cassettes. For those rows `duration_s` and `seconds_per_case` measure replay, not the recorded run; token counts and cost are the recorded values and are comparable.

| variant | runs | cases | cause_accuracy | citation_validity | completion_tokens | cost_usd | duration_s | evidence_recall | llm_calls | pass_rate | prompt_tokens | provider_errors | red_herring_rate | replayed_calls | seconds_per_case |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `baseline` | 3/3 | 12 ± 0 | 0.8333 ± 0 | 0.6111 ± 0.04815 | 2.79e+04 ± 598.8 | 0.8512 ± 0.008954 | 0.4167 ± 0.06995 | 0.9259 ± 0.01599 | 12 ± 0 | 0.3611 ± 0.04815 | 1.44e+05 ± 0 | 0 ± 0 | 0.3889 ± 0.04815 | 12 ± 0 | 0.004 ± 0.001 |
| `agent` | 3/3 | 12 ± 0 (+0.0%) | 0.8611 ± 0.04815 (+3.3%) | 1 ± 0 (+63.6%) | 3.53e+04 ± 2.21e+03 (+26.7%) | 1.008 ± 0.05718 (+18.5%) | 0.3826 ± 0.004779 (-8.2%) | 0.9629 ± 0.01605 (+4.0%) | 25 ± 1 (+108.3%) | 0.6111 ± 0.04815 (+69.2%) | 1.6e+05 ± 8.59e+03 (+10.5%) | 0 ± 0 | 0.3333 ± 0 (-14.3%) | 25 ± 1 (+108.3%) | 0.004 ± 0 (+0.0%) |
| `agent-noverify` | 1/1 | 12 ± 0 (+0.0%) | 0.8333 ± 0 (+0.0%) | 0.8333 ± 0 (+36.4%) | 3.33e+04 ± 0 (+19.4%) | 0.9474 ± 0 (+11.3%) | 0.3748 ± 0 (-10.1%) | 0.9444 ± 0 (+2.0%) | 24 ± 0 (+100.0%) | 0.5 ± 0 (+38.5%) | 1.49e+05 ± 0 (+3.5%) | 0 ± 0 | 0.3333 ± 0 (-14.3%) | 24 ± 0 (+100.0%) | 0.004 ± 0 (+0.0%) |

## Provenance

| variant | commit | container | command |
|---|---|---|---|
| `baseline` | `ab827e266b80` | `host` | `pnpm exec tsx src/baseline/run.ts` |
| `agent` | `ab827e266b80` | `host` | `pnpm exec tsx src/agent/run.ts` |
| `agent-noverify` | `ab827e266b80` | `host` | `pnpm exec tsx src/agent/run.ts` |
