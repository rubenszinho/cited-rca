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
  which made the baseline look far worse than it is: 0.245 by the boolean, 0.874
  by precision.
- **evidence recall** — how much of the required evidence was actually cited.
  This is the one that separates knowing from showing.
- **grounding rate** — does every arguing statement share a term with a line it
  cites? Added after a reviewer scored twelve of twelve with statements of pure
  nonsense attached to the correct lines. The grader had never read the
  statement text, so `pass_rate` meant "pointed at the right lines", never
  "argued it".

Every one of those exists because an earlier version of this table was
misleading in a way I could not see from the table.

<!-- Every number is gpt-4.1-mini, three repeats per variant, one model across
     the whole grid. Reproduce with `task project:eval` and `task project:ablate`;
     both replay from committed cassettes at no cost. -->

| Stage                                      | What I tried and why                                                                                                                                      | Evidence                                                                              | Decision / learning                                                                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Baseline**                               | One direct prompt per incident, given every distinct error shape, both event timelines and every metric series. The brief's own first suggested baseline. | **pass 0.056 ± 0.043**<br>citation precision 0.874<br>completion 0.944                | Starting point. It nearly always returns a report and it is the least supported report in the set: 60 of its 72 cases name the right cause, and 4 make an argument that holds. |
| **Iteration 1** — ranked metric movement   | The baseline reads sixty CSV rows per series and has to notice which moved. Compute the movement in code and hand over the ranking.                       | not isolated                                                                          | Kept, and reported as unmeasured. It changes how a bundle is presented at every step, so ablating it would move the baseline too.                                              |
| **Iteration 2** — log search               | The baseline gets one fixed slice of a 2,100-line log. Let the workflow retrieve addressed lines instead.                                                 | removing it:<br>**pass 0.000**<br>recall 0.470<br>**cause 0.915**                     | Kept, and it is load-bearing — but not for the reason I assumed. See below.                                                                                                    |
| **Iteration 3** — triage pass              | Decide what to read before writing anything.                                                                                                              | with it: **0.181 ± 0.097**<br>cause 0.926<br>grounding 0.627                          | **Removed** — and the closest call in the set. See below.                                                                                                                      |
| **Iteration 4** — verifier and repair loop | Check every citation against the bundle and send the draft back with the specific failures.                                                               | removing it:<br>**0.083 ± 0.053**<br>grounding 0.255                                  | Kept. The largest single contribution: pass rate 0.083 → 0.153, and grounding 0.255 → 0.413.                                                                                   |
| **Iteration 5** — cross-incident memory    | Carry forward the signals seen and the verdict reached.                                                                                                   | with it: **0.194 ± 0.101**<br>cause 0.867<br>herrings 0.414                           | **Removed.** Lower on the primary metric and, on this model, lower on cause accuracy too.                                                                                      |
| **Iteration 6** — iterative investigation  | Search, read, choose the next search, repeat.                                                                                                             | with it: **0.083 ± 0.075**<br>cause 0.801                                             | **Removed.** Lowest cause accuracy in the set: more turns to reason in also means more turns to fail in.                                                                       |
| **Final**                                  | search + verify                                                                                                                                           | **pass 0.153 ± 0.082**<br>cause 0.923<br>citation precision **0.973**<br>recall 0.834 | 2.75× the baseline pass rate (11 of 72 cases against 4), and grounding 0.332 → 0.413. Three of five measured features removed by their own evidence.                           |

### What the tiers show that a pass rate cannot

A case ends in one of four outcomes, and the shape of a variant's failure says
more than its score:

| variant             | sound  | unsupported | wrong cause | invalid |
| ------------------- | ------ | ----------- | ----------- | ------- |
| `baseline`          | 3      | **30**      | 3           | 0       |
| `agent`             | **11** | 19          | 2           | 4       |
| `agent-investigate` | 9      | 19          | 6           | 2       |

The baseline almost never gets the cause wrong. It almost never supports it
either — 30 of 36 runs are a correct diagnosis with an argument that does not
hold up. That is the failure this project exists to remove, and it is invisible
in any metric that only asks whether the answer was right.

The workflow trades some of that for a failure the baseline does not have: it
returns no parseable report at all in 4 runs out of 36, against the baseline's 0.
More turns to reason in is also more turns to fail in.

## Experiments that were removed

The brief asks for these, and they were the more useful half of the work.

### What search actually buys — and the review that nearly killed the finding

Removing log search drops the pass rate to **zero**. I read that as "it cannot
work out the cause without the log" and was wrong.

Cause accuracy without search is **0.915**, against 0.923 for the shipped
workflow. It identifies the cause about as well from the metrics and the change
timeline alone. What collapses is evidence recall — 0.834 down to **0.470** —
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

The finding survived. 0.915 cause accuracy with no log and no name — on prompts
that contain nothing about the answer. Knowing and showing really are separate
capabilities, and now the number says so.

### Triage: a rejection the stricter grader nearly overturned

Triage was removed early and stayed removed. Adding the grounding condition
flipped the ordering, so I re-ran both at six seeds rather than argue about
three.

```
paired on 6 seeds, withtriage minus shipped
  +0.083, +0.083, -0.083, +0.083, +0.167, -0.167
  mean +0.028, stdev 0.126   wins 4, ties 0, loses 2
```

The mean difference is well under its own spread and it loses two seeds outright. By
the rule that has decided every feature here — the primary metric, named before
the runs — that is not an improvement, and triage stays out.

But it is not nothing, and the thing it moves is worth stating: **grounding
0.627 against 0.413**. Reports written after a triage pass are markedly more
likely to have every statement tethered to a line it cites. The mechanism is
plausible — having said out loud what the metrics show, the draft keeps
referring to it — and it was completely invisible until the grader started
reading statement text.

So the honest summary is narrower than either "triage helps" or "triage hurts":
it produces better-argued reports that are not more often correct. That
distinction only exists because the measurement got stricter, and it is the
closest this project came to overturning one of its own rejections.

### Memory: worse at the argument, and on this model worse at the answer too

Cross-incident memory carries forward the signals seen and the verdict reached,
and surfaces the closest priors on a new incident.

```
agent            pass 0.153 +/- 0.082   cause 0.923   grounding 0.413
agent-memory     pass 0.194 +/- 0.101   cause 0.867   grounding 0.501
```

Higher on the primary metric than the shipped configuration, by less than its
own spread, and clearly worse on both things it was supposed to help:
cause accuracy 0.867 against 0.923, and red herrings 0.414 against 0.242. Recall made it reach for the
shape it had learned to expect rather than the line in front of it — on case 10
it recalled that these signals meant DNS, then cited a coredns scale-up applied
28 minutes _after_ onset, as supporting evidence for the cause.

**Removed.** It became more confident about the cause and less careful about
what supports it.

### The investigation loop: more turns to reason in, more turns to wander

Letting the workflow choose its next search from what the last one returned is
the most agentic thing built here. It is also the clearest loss.

```
agent                pass 0.153 +/- 0.082   cause 0.923   herrings 0.242
agent-investigate    pass 0.083 +/- 0.075   cause 0.801   herrings 0.331
```

Half the pass rate of the shipped configuration, with a red-herring rate half again
higher and the same cause accuracy as memory. Three extra rounds of searching is three more
chances to find something interesting and irrelevant, and it cites what it finds.

**Removed.** Agency is not free, and its cost is not only tokens.

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
