# Improvement Changelog

How this went from a single prompt to the workflow in `src/agent/`, what each
change was worth, and what the changes that did not work taught me about the
problem.

Every row's evidence comes from the same twelve cases and the same grader.
Numbers are in [`RESULTS.md`](RESULTS.md); the ablations are reproducible with
`task project:ablate`.

## The measurement

**Pass rate.** A case counts only when the named cause is right, every citation
resolves, every required piece of evidence was cited, and no red herring was
used to support the argument. Partial credit is reported alongside it —
`cause_accuracy`, `citation_validity`, `evidence_recall` — because those are
what tell you _which_ of the four conditions a variant is failing.

Pass rate is the headline because it is the only one that corresponds to
something a person cares about: a review they can act on without going back to
the telemetry themselves.

<!-- STAGES: evidence cells filled from RESULTS.md once the run lands. -->

| Stage                                      | What I tried and why                                                                                                                                                                       | Evidence  | Decision / learning |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ------------------- |
| **Baseline**                               | One direct prompt per incident, given every distinct error shape, both event timelines and every metric series.                                                                            | _pending_ | _pending_           |
| **Iteration 1** — ranked metric movement   | The baseline has to read sixty CSV rows per series and notice which one moved. Compute the movement in code and hand over the ranking instead, so the flat control series is visibly flat. | _pending_ | _pending_           |
| **Iteration 2** — directed log search      | The baseline gets one fixed slice of a 2,100-line log. Let the workflow ask for what it wants and return addressed lines spread across the window.                                         | _pending_ | _pending_           |
| **Iteration 3** — triage pass              | Deciding what to read before writing anything, rather than reading and writing in one step.                                                                                                | _pending_ | _pending_           |
| **Iteration 4** — verifier and repair loop | Check every citation against the bundle deterministically and send the draft back with the specific failures.                                                                              | _pending_ | _pending_           |
| **Final**                                  | All four together.                                                                                                                                                                         | _pending_ | _pending_           |

## Experiments that were removed

The brief asks for these, and they were the more useful half of the work.

### The baseline was a strawman, and fixing it mattered more than any iteration

The first baseline prompt was 34,000 tokens per case. It included every error
line in the log — for case 01 that is 333 identical copies of the same
`TypeError`.

No engineer pastes that. A real one pastes the distinct shapes and a count. So
the baseline now collapses repeats, keeping the first occurrences of each
distinct message plus a total, which took the prompt to 7,000 tokens.

**What it taught me:** the easiest way to manufacture an improvement is to
handicap the baseline, and it is easy to do by accident rather than by
dishonesty. I did not set out to weaken it; I just rendered the log the obvious
way. Any comparison against a baseline you built yourself is worth re-reading
with the question "would a competent person actually do this?"

### Requiring the metric column name as evidence — wrong, and it looked like a model failure

Ground truth originally required citing the metric _series_ by name, e.g.
`metrics/http.csv ~ "error_rate"`. The first live run scored a correct,
well-argued report at 0.67 recall.

The model was right and the fixture was wrong. A column name appears only in
the CSV header, so full recall required citing a header row — which shows
nothing. The model had cited the data row at onset, which is the line that
actually demonstrates the change.

All twelve cases had it. Metric evidence now resolves to the row at onset.
Re-grading the same recorded response scored 1.0.

**What it taught me:** when a graded run disagrees with an answer that looks
correct, the grader is a suspect too. Running one case end to end before
committing to a full evaluation is what surfaced it — a full run would have
produced a plausible-looking table with every variant equally depressed, and
nothing in it would have flagged that the ceiling was artificial.

### Three red herrings that could never fire

Same root cause: they pointed at CSV headers. A red herring nobody can trip
over measures nothing, so all three were replaced with discrete artefacts that
are genuinely tempting — an error naming the database while database metrics
stay flat, a fleet-scoped alert when only one node is affected, and a
conversion-drop alert that reads as a checkout regression.

**What it taught me:** a distractor has to be checkable to count. I had written
prose explaining why each one was tempting and never verified that a report
could actually cite it. `fixtures/cases.test.ts` now asserts that every
evidence and red-herring reference resolves to a real line.

## Notes on building it with an agent

### The quality gate rejected nine of my own functions

The ratchet in the chassis holds new code to 25 lines per function, 15
cyclomatic complexity, 5 parameters. It rejected nine functions written during
this build, including the grader's own `grade()` at 47 lines. All were split.
No threshold was raised.

That is the gate working as designed on the person who wrote it, which is the
only test of such a thing that means anything.

### The gate itself was confidently wrong once

`lizard` reported `groupByShape` as 43 lines. It is 5. A regex literal confuses
its TypeScript tokenizer, and the reported span swallowed the two functions
that followed it.

The failure mode is worth naming: the tool did not error, it produced a
plausible number. Had I trusted it, I would have refactored working code to
satisfy a measurement that was not measuring that code. Replacing the regex
with a JSON parse fixed the reading and produced better code anyway.

**What it taught me:** a deterministic gate is more trustworthy than a model,
not perfectly trustworthy. When a gate reports something surprising, checking
the gate is a legitimate first move — and the version pin on the metrics tool
in `mise.toml` exists precisely because that class of change must never arrive
implicitly.

## Hot take

**A citation is not evidence until something can check it.**

The interesting failure of a language model on this task is not that it gets
the cause wrong. It usually does not. It is that it produces a fluent review
citing lines that do not exist, and a wrong review with citations attached is
worse than no review, because the citations are what buy it trust.

Line numbers alone do not fix this — a model will emit a real line number
attached to a claim that line does not support, and it looks identical to a
correct citation. Requiring the **verbatim quote** is what changes the
economics: the claim becomes checkable by string comparison, with no model and
no ground truth in the loop, which means the workflow can check _itself_ before
anyone sees the output.

The general form: when you want an agent to be reliable about something, find
the smallest artefact it can emit that makes the claim mechanically falsifiable,
and require that instead of trusting the claim. Then the verification is free,
deterministic, and runs on every output rather than on the ones you sampled.
