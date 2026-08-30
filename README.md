# Cited RCA

An agentic workflow that drafts an incident root-cause analysis in which every
claim is tied to a real telemetry line — and that can prove its citations are
real without ever being shown the answer.

- **Improvement Changelog** → [`docs/CHANGELOG.md`](docs/CHANGELOG.md)
- **Results** → [`docs/RESULTS.md`](docs/RESULTS.md)
- **Agent tool disclosure** → [`docs/TOOLS.md`](docs/TOOLS.md)
- **What existed before this hackathon** → [below](#what-existed-before-this-hackathon)

## Who has this problem

The engineer who was on call when it broke, writing the review afterwards.

## What the bottleneck is

The evidence for what happened is spread across systems that do not share a
timeline: application logs, metric series, the deploy and change record, and
whatever the alerting fired. Reconstructing the sequence means holding all four
in your head at once, and the answer is usually one line in one of them.

Two things make it expensive:

**It takes hours, and they are the wrong hours.** The review is written by the
person who just spent the night on the incident, from the worst context they
will ever have on it.

**The quality depends on who writes it.** Under time pressure the most
available explanation wins, and the change that landed closest to onset is
always the most available explanation. Sometimes it is right. When it is not,
the review sends everyone after the wrong thing.

Handing this to a language model does not obviously help, because the specific
way it fails is bad here. A model will produce a fluent, confident review
citing log lines that do not exist. An RCA nobody can check is worse than no
RCA: it is wrong with a citation next to it.

## Why solving it is valuable

A first draft that arrives with the timeline assembled and every statement
pointing at a line an engineer can open turns hours of correlation into
minutes of review. The value is not the prose — it is that the prose is
checkable. The reviewer's job becomes verifying an argument instead of
rebuilding one, and a wrong draft is _visibly_ wrong rather than plausibly
wrong.

## The architecture, and the measurement that chose it

**The hard part of this task is not working out what broke. It is proving it.**

That is not an opinion; it is the clearest result in the evaluation. Take the
log away from the workflow and it still names the root cause about as often as
the full system — **0.914 against 0.942** — from the metrics and the change
timeline alone. Its pass rate is **zero**. It knows the answer and cannot show
its work: evidence recall collapses from 0.823 to **0.476**.

Being right and being able to demonstrate you are right are separate
capabilities, and only the second makes a postmortem worth reading.

So the workflow is built around proof rather than reasoning. Every citation
carries a file, a line number, and **the verbatim text it claims is on that
line**. A line number alone can be confidently wrong and look fine. A quote that
is not on the line it names is provably wrong — by string comparison, with no
model and no ground truth involved.

That property does three things: the workflow **checks its own draft** before
emitting it and repairs what fails; the evaluation is **deterministic**, because
grading is string comparison; and a reader can **audit the review** without
redoing the investigation.

[`src/citation.ts`](src/citation.ts) is shared by the grader and the verifier so
the two cannot drift apart. The verifier has a test asserting it cannot reach the
ground truth: it answers _"are these citations real"_, never _"is this the right
answer"_.

### Why the shipped agent is small

Five capabilities were built and measured. **Three were removed because the
evidence did not support them.**

|                              | pass rate         | verdict                                            |
| ---------------------------- | ----------------- | -------------------------------------------------- |
| planning pass                | 0.250 ± 0.083     | worse than nothing, on both models tried           |
| cross-incident memory        | 0.278 ± 0.127     | worst cause accuracy of any variant keeping search |
| iterative investigation      | 0.250 ± 0.083     | 11 of 36 runs returned no parseable report at all  |
| **shipped: search + verify** | **0.306 ± 0.127** | best on the primary metric                         |

A deliberate outcome, not an unfinished one: each rejection is reproducible with
a flag, and [`docs/CHANGELOG.md`](docs/CHANGELOG.md) records what each taught.

The pattern underneath them is the same. Planning, memory and open-ended
investigation all made the workflow _more confident_ and _less careful about
what supports a claim_ — and each added turns in which to fail. For a tool whose
entire value is that its output can be trusted, that is a poor trade.

## Reproduce

Docker is not needed. The only prerequisite is `git` and a shell — the
toolchain is pinned and provisioned into the repo.

```bash
git clone <repo-url> cited-rca && cd cited-rca

./bin/mise install                  # pinned toolchain into ./.mise (~3 min)
./bin/mise exec -- task setup       # render .env, install hooks, install deps

./bin/mise exec -- task validate    # lint, types, 167 tests, quality ratchet
./bin/mise exec -- task project:eval        # both variants over all 12 cases
./bin/mise exec -- task project:report      # regenerate docs/RESULTS.md
```

Once `mise` is activated in your shell you can drop the `./bin/mise exec --`
prefix. `task -l` lists everything.

The toolchain installs into `./.mise` and is not relocatable — pipx bakes an
absolute path into its virtualenv, so moving an existing checkout breaks
`lizard` and with it the quality gate. Re-run `./bin/mise install` after a move.
A fresh clone is unaffected.

### This costs nothing to reproduce

`task project:eval` defaults to **replay mode**: every model call made during
the recorded evaluation is committed under `fixtures/cassettes/`, keyed by the
exact request that produced it. A clean clone replays them and arrives at the
numbers in `docs/RESULTS.md` with **no API key and no spend**.

A cassette miss is a hard error, never a silent live call — a fallback would
let a "reproduction" quietly diverge from what was measured.

### Running it live

```bash
echo 'LLM_API_KEY=sk-...' >> .env.overrides   # gitignored, takes precedence
LLM_MODE=record task project:eval                    # re-record the cassettes
```

Any OpenAI-compatible endpoint works. `LLM_BASE_URL`, `LLM_MODEL`,
`LLM_MAX_TOKENS` and `LLM_TEMPERATURE` are set in `env.template`; point them at
your own account and nothing in the code changes.

### Run it on your own incident

```bash
task project:dev -- --dir ./my-incident-folder
```

Any directory of logs, metric exports, or change records. Nothing assumes the
fixture layout — a bundle is only a set of text files addressable by line, which
is also the entire requirement for a citation. Your filenames become the source
names in the review.

`examples/checkout-latency-2026-03-19/` is a worked example in formats the
workflow has never seen: an nginx access log, a logfmt application log,
Prometheus CSV exports, and a plain-text deploy record. `REVIEW.md` beside it is
the unedited output. See [`examples/README.md`](examples/README.md).

There is no ground truth for a real incident, so correctness cannot be scored.
What is still checked, and printed after the review, is whether every citation
resolves against the files.

### Look at one incident

```bash
task project:dev -- --list
task project:dev -- --case 12-batch-job-contention --variant agent
task project:dev -- --case 12-batch-job-contention --variant baseline
```

Case 12 is the one to look at: a checkout deploy lands two minutes before onset
on the very service that is failing, and it is innocent.

### What the data is

Twelve synthetic incidents under `fixtures/cases/`, one per root cause,
around 2,100 log lines each. No real telemetry, no customer data, nothing that
needs approval to publish.

They are generated, not hand-written: `task project:fixtures` rebuilds them
from their seeds and `task project:fixtures:verify` fails if a byte moved.
Each case ships a `truth.json` recording the fault that was injected, which is
what makes grading exact rather than a later opinion. Nothing on the solution
path can read it — `loadBundle()` does not expose it, and there is a test
pinning that.

### Versions, runtime and cost

|                |                                                                           |
| -------------- | ------------------------------------------------------------------------- |
| Toolchain      | pinned in `mise.toml` + `mise.lock` (node 24, python 3.12, lizard 1.22.2) |
| Model recorded | `gpt-4.1-mini` via the OpenAI API, temperature 0                          |
| Replay run     | a few seconds, $0                                                         |
| Live re-record | see `docs/RESULTS.md` for measured tokens and cost                        |

## How it is measured

The baseline is the brief's own first example — _one direct prompt with basic
instructions_ — and it is built to be a fair representative rather than a
strawman. It receives the full change and alert timelines, every metric series,
every distinct error shape with its first occurrences and a count, and an even
sample of the rest. It shares the JSON repair turn with the workflow, so the
comparison measures reasoning rather than plumbing.

**Primary metric: pass rate.** A case counts only when all four hold:

1. the named root cause matches the fault that was injected
2. every citation resolves — file exists, line exists, quote is on it
3. every required piece of evidence appears on a line the report cited
4. no red herring was used to support the argument

Condition 3 is the one that earns its keep: it fails a report that names the
right cause for the wrong reasons. Condition 4 permits citing a red herring
under `ruled_out` — considering and rejecting an alternative is correct
practice, not a mistake.

## Safety, data and access

The ground rules ask for specific things. Stating our position on each rather
than leaving a judge to infer it:

**Consequential actions.** There are none. The workflow reads files and writes
a document. It does not touch production, execute remediation, or call any
system other than a language model. There is nothing here that needs a sandbox
because nothing here acts.

**A human in the loop.** The output is explicitly a draft. It is titled as a
review, it lists what it ruled out, and every claim carries the line it rests
on, so the engineer publishing it can check the argument rather than accept it.
The design assumes a qualified reviewer signs it — that is the point of making
every claim checkable rather than merely readable.

**Data.** Everything in this repository is synthetic. The twelve cases are
generated from declared fault models; the worked example under `examples/` was
written for the purpose. No customer data, no production telemetry, nothing
that needed permission to publish. Running it on your own incident keeps your
data on your machine apart from what you send to your own model provider.

**Credentials.** `.env.overrides` holds the API key, is gitignored, and is
never generated. No key material of any length appears in the repository, its
history, the cassettes, or the trajectories — `task project:trajectories:verify`
is the gate, and it fails the build rather than warning.

**Access for judges.** The evaluation replays from committed recordings with no
API key, no network, and no spend. See [Reproduce](#reproduce). The cloud model
is a dependency of _producing_ the result, not of _checking_ it.

## Layout

| Path              | What it is                                                                  |
| ----------------- | --------------------------------------------------------------------------- |
| `src/agent/`      | the workflow: search, draft, verify, repair (triage/memory/investigate off) |
| `src/baseline/`   | the single-prompt baseline                                                  |
| `src/grade.ts`    | deterministic grading                                                       |
| `src/citation.ts` | citation resolution, shared by grader and verifier                          |
| `src/llm/`        | provider-agnostic client and the cassette layer                             |
| `fixtures/`       | the incident generator and the twelve committed cases                       |
| `harness/`        | runs a variant across repeats, aggregates into a results table              |
| `tools/`          | the forge shell's tooling, plus trajectory capture and redaction            |
| `docs/`           | changelog, results, tool disclosure, chassis documentation                  |

## What existed before this hackathon

Ground rule 02 asks for this line to be clear, so it is a commit boundary
rather than a claim.

**Pre-existing:** [`forge`](https://github.com/rubenszinho/forge), a
framework-agnostic development shell of mine — pinned toolchain, task command
surface, tiered git hooks, per-worktree isolation, and a code-quality ratchet.
It is imported verbatim in the first commit of this repository
(`chore: import the forge development shell as the project chassis`) and
documented in [`docs/forge.md`](docs/forge.md). It is infrastructure here, not
the subject of the project. Every commit after that one is this project.

**Built for this hackathon:** everything else — the incident generator and all
twelve cases, the citation contract, the grader, the model boundary and
cassette layer, the baseline, the agent workflow, the evaluation harness, and
the trajectory capture and redaction tooling.

`forge` itself was pushed public during the hackathon window, on 2026-08-28 at
17:46 UTC, after the 15:00 UTC kickoff.

## License

MIT — see [`LICENSE`](LICENSE).
