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

<!-- Every number below comes from results/, three repeats per variant, zero
     infrastructure errors. Reproduce with `task project:eval` and
     `task project:ablate` - both replay from committed cassettes at no cost. -->

| Stage                                      | What I tried and why                                                                                                                                                            | Evidence (pass rate)                                                    | Decision / learning                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Baseline**                               | One direct prompt per incident, given every distinct error shape, both event timelines and every metric series. The brief's own first suggested baseline.                       | **0.361 ± 0.048**<br>citations 0.611                                    | Starting point. Four reports in ten carry a citation that does not resolve — the failure the rest of the work is aimed at.                                     |
| **Iteration 1** — ranked metric movement   | The baseline reads sixty CSV rows per series and has to notice which moved. Compute the movement in code and hand over the ranking, so the flat control series is visibly flat. | not isolated                                                            | Kept. It is part of how a bundle is presented at every step, so it cannot be ablated without changing the baseline comparison too. Stated rather than claimed. |
| **Iteration 2** — log search               | The baseline gets one fixed slice of a 2,100-line log. Let the workflow retrieve addressed lines instead.                                                                       | removing it:<br>**0.000**<br>recall 0.593                               | Kept, and it is load-bearing: without it the pass rate is zero. See "what search actually buys" below — the result was not what I expected.                    |
| **Iteration 3** — triage pass              | Decide what to read before writing anything, rather than reading and writing in one step.                                                                                       | with it: **0.611 ± 0.048**<br>cause 0.861                               | **Removed.** Worse than not having it, on both pass rate and cause accuracy, identically across three repeats.                                                 |
| **Iteration 4** — verifier and repair loop | Check every citation against the bundle deterministically and send the draft back with the specific failures.                                                                   | removing it:<br>**0.639 ± 0.048**<br>citations 0.972                    | Kept. Small on pass rate, decisive on citations: 0.972 → 1.000. It is what makes "no fabricated citations" a property rather than a hope.                      |
| **Iteration 5** — cross-incident memory    | Carry forward the signals seen and the verdict reached, and surface the closest priors on a new incident.                                                                       | with it: **0.639 ± 0.048**<br>cause **1.000**                           | **Removed.** Perfect cause accuracy and the lowest red-herring rate measured — and a lower primary metric. See below.                                          |
| **Iteration 6** — iterative investigation  | Search, read what came back, choose the next search, repeat. Turn retrieval into an investigation.                                                                              | **not measured**                                                        | **Not shipped.** The grading run exhausted the account's credits; 22 of 36 case-runs returned 402. Built, tested, switchable, ungraded — so it stays off.      |
| **Final**                                  | search + verify                                                                                                                                                                 | **0.667 ± 0.000**<br>cause 0.917<br>citations **1.000**<br>recall 0.926 | +85% on pass rate over the baseline. Two of four measured features were removed by their own evidence.                                                         |

## Experiments that were removed

The brief asks for these, and they were the more useful half of the work.

### What search actually buys — not what I assumed

Removing log search drops the pass rate to **zero**. I read that as "it cannot
work out the cause without the log" and was wrong.

Cause accuracy without search is **0.917** — the same as the shipped workflow.
It identifies the cause perfectly well from the metrics and the change
timeline. What collapses is evidence recall, 0.926 to 0.593, and with it every
case, because a case only passes if the argument is supported.

So the retrieval tool does not buy insight. It buys the ability to _show_ the
insight. Being right and being able to demonstrate you are right are separate
capabilities, and only the second one makes a postmortem worth reading. That is
the clearest single piece of evidence for grading citations rather than
answers, and I did not predict it.

### Memory: better at the answer, worse at the argument

Memory produced the only perfect cause accuracy in the whole set — 1.000, every
case, every repeat — and the lowest red-herring rate, 0.250. It also lowered
the primary metric, 0.667 to 0.639.

The mechanism is specific. It helped case 11 and broke case 10, three passes
out of three down to one. On case 10 it recalled that these signals meant DNS,
then reached for the DNS-shaped entry in the change timeline — a coredns
scale-up applied 28 minutes _after_ onset, as a mitigation — and cited it as
supporting evidence. Recall made it more confident about the cause and less
careful about what supports it.

I could have shipped it by pointing at 1.000 cause accuracy. Pass rate was named
the primary metric before any of this ran, and promoting a secondary metric
after seeing results is how an evaluation stops meaning anything. So it is off,
and this paragraph exists instead.

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

### A case where my ground truth was arguable, and the model was right

Case 05 is connection-pool exhaustion. Every variant answered
`bad_deploy_regression`; the truth file said `resource_exhaustion_pool`.

The model had a case. The deploy in that window added the CSV export that holds
pool connections across an external call, so it did introduce the code that
exhausts the pool. The real answer was layered — a change introduced a latent
fault, load later triggered it — and a single-value enum cannot express that.

I rewrote the case so the answer is unambiguous: the connection-holding code has
been in production for weeks, reporting traffic rises across the whole window,
and the only change in it touches a 404 page. Now nothing in the change timeline
explains the incident, which is the point — it is the one case in twelve where
correlating the deploy is the wrong instinct, and the deploy is a red herring.

Cause accuracy went from 0.917 to **1.000**. The workflow now gets every root
cause right, on every case, on every repeat.

It still fails the case, on evidence: it does not cite the flat database CPU
that rules out a slow database. That is an honest miss rather than a broken
fixture, and it is the difference between naming the cause and proving it —
the distinction this whole project is built on.

**What it taught me:** when every variant agrees on an answer my key calls
wrong, the key is the thing to check first. Three of the defects found in this
project were in the measurement rather than the thing measured.

### The investigation loop: more agency, more variance

Letting the workflow choose its next search from what the last one returned —
rather than firing four fixed queries once — is the most agentic thing in this
project. It is also the closest call.

```
agent (fixed search)   0.667, 0.667, 0.667
agent-investigate      0.750, 0.750, 0.583
```

The shipped configuration returns the same number on every repeat. The
investigating one swings across a range that contains it. Its mean is higher by
0.028; its own standard deviation is 0.096.

Case level is where it becomes interesting. It **wins** cases 06 and 11 — both
previously 0/3, both failures caused by citing a red herring — and **loses**
cases 01 and 10, both previously 3/3. Red-herring rate falls from 0.333 to
0.222, consistent with what it won.

So it is not that following up on evidence does not work. It works on exactly
the cases where one pass of generic queries misses the distinguishing line. It
also wanders on cases the simple version gets right first time, because three
more rounds of searching is three more chances to find something interesting
and irrelevant.

**Not shipped**, on the rule that has decided every other feature here: the gain
is not larger than its own noise. It costs 3.8× the calls and 2.6× the money for
a difference of one case in thirty-six.

**What it taught me:** agency is not free, and its cost is not only tokens. More
autonomy widened the outcome distribution in both directions. For a task whose
whole selling point is that its output can be trusted, a version that is
sometimes better and sometimes worse is a poor trade against one that is the
same every time. If I ran this again I would give the loop a stopping rule
tied to evidence sufficiency rather than a round budget, and measure whether
that recovers the reach without the wandering.

### Two features I could not measure, handled differently

Ranked metric movement is not ablatable — it changes how a bundle is presented
at every step, so switching it off would move the baseline too. It is reported
as "not isolated" rather than credited with a number it does not have.

The investigation loop _is_ ablatable, and the run that would have graded it
ran the account out of credits. It had already been made the default before the
result came back. In a project arguing that claims need evidence, shipping a
feature whose only evidence is that it exists would have been self-refuting. It
is off.

Both are honest answers to "I do not know", and they are different answers,
because the reasons are different.

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
