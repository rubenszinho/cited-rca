# Results

Reference variant: `baseline`. Each cell is mean ± stdev across seeds; delta is versus the reference.

| variant | runs | cases | cause_accuracy | citation_validity | completion_tokens | cost_usd | duration_s | evidence_recall | llm_calls | pass_rate | prompt_tokens | red_herring_rate | replayed_calls | seconds_per_case |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `baseline` | 3/3 | 12 ± 0 | 0.8333 ± 0 | 0.5833 ± 0.08335 | 2.75e+04 ± 314.9 | 0.8465 ± 0.004709 | 0.4228 ± 0.04316 | 0.9444 ± 0 | 12 ± 0 | 0.3611 ± 0.04815 | 1.44e+05 ± 0 | 0.3889 ± 0.04815 | 12 ± 0 | 0.004 ± 0 |
| `agent` | 3/3 | 12 ± 0 (+0.0%) | 0.8333 ± 0 (+0.0%) | 1 ± 0 (+71.4%) | 3.41e+04 ± 3.63e+03 (+23.8%) | 0.9755 ± 0.08409 (+15.2%) | 0.3893 ± 0.014 (-7.9%) | 0.9537 ± 0.01605 (+1.0%) | 24.67 ± 1.155 (+105.6%) | 0.6389 ± 0.09624 (+76.9%) | 1.55e+05 ± 1.04e+04 (+7.1%) | 0.25 ± 0.0833 (-35.7%) | 24.67 ± 1.155 (+105.6%) | 0.004 ± 0 (+0.0%) |

## Provenance

| variant | commit | container | command |
|---|---|---|---|
| `baseline` | `47747e3ad203` | `host` | `pnpm exec tsx src/baseline/run.ts` |
| `agent` | `47747e3ad203` | `host` | `pnpm exec tsx src/agent/run.ts` |
