# Improvement Changelog

How this went from a single prompt to the workflow in `src/agent/`, what each
change was worth, and what the changes that did not work taught me about the
problem.

Every row's evidence comes from the same twelve cases and the same grader.
Numbers are in [`RESULTS.md`](RESULTS.md); the ablations are reproducible with
`task project:ablate`.

## The measurement

**Pass rate** is the headline: a case counts only when the named cause is right,
every citation resolves, every required piece of evidence was cited, and no red
herring was leaned on. It is the only number corresponding to something a person
cares about — a review they can act on without going back to the telemetry
themselves.

It is also all-or-nothing, so four more measures sit alongside it, each added
because the grader was hiding something:

- **completion rate** — did a parseable report come back at all? Added after the
  outcome tiers showed the workflow failing schema validation where the baseline
  never does. Without it, "cannot write JSON" and "cannot read telemetry" land in
  the same number.
- **cause accuracy** — right diagnosis, _conditioned on a report existing_. A
  formatting failure is not evidence about diagnosis, and averaging it in as a
  zero moved a reasoning metric when only the JSON changed.
- **citation precision** — citations that resolve over citations made. The
  boolean it replaced failed a whole case for one bad citation in twenty-eight,
  which made the baseline look far worse than it is: 0.278 by the boolean, 0.882
  by precision.
- **evidence recall** — how much of the required evidence was actually cited.
  This is the one that separates knowing from showing.

Every one of those exists because an earlier version of this table was
misleading in a way I could not see from the table.

<!-- Every number is gpt-4.1-mini, three repeats per variant, one model across
     the whole grid. Reproduce with `task project:eval` and `task project:ablate`;
     both replay from committed cassettes at no cost. -->

| Stage                                      | What I tried and why                                                                                                                                      | Evidence                                                                              | Decision / learning                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Baseline**                               | One direct prompt per incident, given every distinct error shape, both event timelines and every metric series. The brief's own first suggested baseline. | **pass 0.083 ± 0.083**<br>citation precision 0.882<br>completion 1.000                | Starting point. It always returns a report and it is the least accurate report in the set: 30 of 36 runs name the right cause with an argument that does not hold. |
| **Iteration 1** — ranked metric movement   | The baseline reads sixty CSV rows per series and has to notice which moved. Compute the movement in code and hand over the ranking.                       | not isolated                                                                          | Kept, and reported as unmeasured. It changes how a bundle is presented at every step, so ablating it would move the baseline too.                                  |
| **Iteration 2** — log search               | The baseline gets one fixed slice of a 2,100-line log. Let the workflow retrieve addressed lines instead.                                                 | removing it:<br>**pass 0.000**<br>recall 0.476<br>**cause 0.914**                     | Kept, and it is load-bearing — but not for the reason I assumed. See below.                                                                                        |
| **Iteration 3** — triage pass              | Decide what to read before writing anything.                                                                                                              | with it: **0.250 ± 0.083**<br>cause 0.909                                             | **Removed.** Still worse than not having it, now on a second model.                                                                                                |
| **Iteration 4** — verifier and repair loop | Check every citation against the bundle and send the draft back with the specific failures.                                                               | removing it:<br>**0.194 ± 0.048**<br>citation precision 0.883                         | Kept. The largest single contribution: +0.112 pass rate, and citation precision 0.883 → 0.984.                                                                     |
| **Iteration 5** — cross-incident memory    | Carry forward the signals seen and the verdict reached.                                                                                                   | with it: **0.278 ± 0.127**<br>cause 0.823                                             | **Removed.** Lower on the primary metric and, on this model, lower on cause accuracy too.                                                                          |
| **Iteration 6** — iterative investigation  | Search, read, choose the next search, repeat.                                                                                                             | with it: **0.250 ± 0.083**<br>herrings 0.384                                          | **Removed.** More turns to reason in also means more turns to fail in.                                                                                             |
| **Final**                                  | search + verify                                                                                                                                           | **pass 0.306 ± 0.127**<br>cause 0.942<br>citation precision **0.984**<br>recall 0.823 | 3.7× the baseline pass rate. Three of five measured features removed by their own evidence.                                                                        |

### What the tiers show that a pass rate cannot

A case ends in one of four outcomes, and the shape of a variant's failure says
more than its score:

| variant             | sound  | unsupported | wrong cause | invalid |
| ------------------- | ------ | ----------- | ----------- | ------- |
| `baseline`          | 3      | **30**      | 3           | 0       |
| `agent`             | **11** | 19          | 2           | 4       |
| `agent-investigate` | 7      | 14          | 4           | **11**  |

The baseline almost never gets the cause wrong. It almost never supports it
either — 30 of 36 runs are a correct diagnosis with an argument that does not
hold up. That is the failure this project exists to remove, and it is invisible
in any metric that only asks whether the answer was right.

The workflow trades some of that for a new failure the baseline does not have:
it returns no parseable report at all in 4 runs, against the baseline's 0.
More turns to reason in is also more turns to fail in, and the investigating
variant shows where that ends — 11 invalid runs out of 36.

## Experiments that were removed

The brief asks for these, and they were the more useful half of the work.

### What search actually buys — and the review that nearly killed the finding

Removing log search drops the pass rate to **zero**. I read that as "it cannot
work out the cause without the log" and was wrong.

Cause accuracy without search is **0.914**, against 0.942 for the shipped
workflow. It identifies the cause about as well from the metrics and the change
timeline alone. What collapses is evidence recall — 0.823 down to **0.476** —
and with it every case, because a case only passes if the argument is supported.

Retrieval does not buy insight. It buys the ability to _show_ the insight.

**An outside reviewer nearly demolished this.** Every prompt used to open with
`Incident 05-connection-pool-exhaustion`, and the case directories are named
after the fault they contain — eleven of twelve ids share tokens with their own
root cause, and `batch_job_contention` is verbatim. So the obvious reading was
that `agent-nosearch` scored 0.917 cause accuracy because the prompt told it.

That was a fair hit and it was my most serious defect: `cause_accuracy` was
partly measuring string overlap with a directory name. Graded cases now get an
opaque handle, every recording was thrown away, and the grid was re-run from
scratch on a different model.

The finding survived. 0.914 cause accuracy with no log and no name — on prompts
that contain nothing about the answer. Knowing and showing really are separate
capabilities, and now the number says so.

### Memory: better at the answer, worse at the argument

_(Measured first on claude-sonnet-4.5, where memory produced perfect cause
accuracy; re-measured on gpt-4.1-mini, where it produced the worst cause
accuracy of any variant that kept search, 0.823 against 0.942. The verdict is
the same on both and the mechanism below is what I observed on the first.)_

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
