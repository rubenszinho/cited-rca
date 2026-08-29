# Project guidelines

<!-- Rename this heading and fill in "What this project is" for your project.
     Everything else describes the forge shell and applies as written. -->

**What this project is:** a workflow that reads incident telemetry and drafts a
root-cause review in which every claim carries the file, line number and
verbatim text it rests on — so a fabricated citation is provably wrong by string
comparison, and the workflow can reject its own before anyone reads it.

The twelve cases under `fixtures/cases/` are synthetic on purpose: the injected
fault is known exactly, so grading is deterministic and needs no model. Model
calls are recorded to `fixtures/cassettes/` and replayed by default, so the
whole evaluation reproduces with no API key and no spend.

**Two rules that are easy to break without noticing.** Prompt text is part of a
cassette key: rewording one line of a prompt silently invalidates every
recording, and the run then looks like a broken workflow rather than a stale
cache. And nothing on the solution path may read `truth.json` — `loadBundle()`
does not expose it, and there are tests asserting the verifier and the memory
module cannot reach it.

## Commands

Every command goes through `task`. Never invoke the underlying tool directly —
the task definition is the contract, and hooks and CI call the same names.

```text
task -l                          # list every task
task setup                       # fresh clone: .env, git hooks, deps

task validate                    # MANDATORY before finishing work
task test:tools                  # tests for the tooling in tools/

task format          [-- PATHS]  # autofix
task lint            [-- PATHS]  # autofix
task quality:check               # the ratchet (absorbs improvements)
task quality:thresholds          # print the enforced numbers

task env:render      [-- --force]  # regenerate .env for this worktree
task dev / dev:tui / dev:stop / dev:stop-clean
```

Arguments after `--` are forwarded to the underlying tool.

## The quality ratchet

Four metrics are enforced on every commit. These numbers are not style
preferences — they are the point at which code stops fitting in one person's
(or one agent's) working memory:

| Metric       | Limit | Meaning                         |
| ------------ | ----- | ------------------------------- |
| `nloc`       | 25    | non-comment lines in a function |
| `ccn`        | 15    | cyclomatic complexity           |
| `params`     | 5     | parameter count                 |
| `file_lines` | 500   | lines in a file                 |

They live in `quality.toml`; `task quality:thresholds` prints what is actually
enforced. If this table and that output ever disagree, the table is wrong.

**How the ratchet works.** Violations that already exist are recorded in
`.quality-baseline.json` and grandfathered at their recorded value. Anything
not in the baseline is held to the strict limits — including a new function
added to a legacy file that is itself baselined. The baseline grandfathers
functions, never files.

**Rules for agents, without exception:**

- Never edit `.quality-baseline.json` by hand. It is generated.
- Never raise a threshold in `quality.toml` to make a check pass. Raising a
  threshold is a project decision, made deliberately, explained in its own
  commit — not a way around a failing gate.
- Never carve a function into arbitrary fragments purely to get under a limit.
  If it will not split along a real seam, say so and leave it.
- When a refactor improves a baselined metric, `task quality:check` rewrites
  the baseline. Commit that change with the refactor.

## Definition of done

`task validate` passes. Not "the tests I ran pass" — the whole gate. It runs
lint, format, typecheck, the project's tests, the tooling's tests, and the
ratchet. Report work as finished only after it has passed.

If part of the work is blocked, finish everything else and say explicitly what
was left out and why.

## Code style

- Functions do one thing. Files hold one responsibility.
- Names are specific enough to grep. A name returning dozens of hits across the
  repo is too generic — avoid `data`, `handler`, `manager`, `util`.
- Types are explicit at every boundary. No untyped public functions.
- Early returns over nested branches; at most two levels of indentation.
- No duplicated logic. Extract the shared part instead of copying it.
- Exception and error messages name the offending value and the expected
  shape. `invalid config` helps nobody; `scope 'app': engine='radon' is not
built in, expected one of ('lizard', 'none')` does.

## Comments

- Write **why**, not what. Skip comments that restate the line below them.
- Keep existing comments through a refactor. They carry intent and history
  that the code does not.
- Reference an issue or commit when a line exists because of a specific bug or
  an upstream constraint. That is the context nobody can reconstruct later.
- Public functions get a docstring: intent, plus one usage example.

## Tests

- Every new function gets a test. Every bug fix gets a regression test that
  fails before the fix.
- Tests are fast, independent, repeatable, self-validating.
- Mock external I/O behind named fakes, not inline stubs scattered per test.
- The tooling in `tools/` has its own suite under `tools/tests/`, run by
  `task test:tools` and included in `task validate`.

## Commits

Conventional commits, enforced by the `commit-msg` hook against `commit.toml`:
`type(scope): subject`, lowercase subject, no trailing period, 72 characters.
The `squashing-commits` skill covers composing the message body.

## Environment

- `.env` is **generated** by `task env:render`. Never edit it by hand; it is
  regenerated per branch and gitignored.
- `.env.overrides` holds real secrets. Gitignored, never generated, loaded
  after `.env` so it always wins.
- `$SESSION` is the isolation key. Every container, volume and port derives
  from it, so two worktrees of this repo can run side by side. Anything
  destructive that interpolates `$SESSION` must first assert it is non-empty.
- Renaming a branch changes the session and orphans the containers and volumes
  from the old one. `task env:render` refuses to overwrite in that case until
  you run `task dev:stop-clean` or pass `--force`.

## Changing the shell itself

`Taskfile.yml`, `lefthook.yml`, `.github/workflows/`, and everything under
`tools/` are infrastructure. Editing them changes what "done" means for every
future change, so treat it as a deliberate act: explain the why in the commit,
and update this file in the same commit when the contract moves.

Project-owned files, safe to shape to the project: `taskfiles/project.yml`,
`quality.toml`, `commit.toml`, `env.template`, `process-compose.yml`.
