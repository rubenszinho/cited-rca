# forge

A framework-agnostic development shell: one command surface, a pinned
toolchain, tiered git hooks, per-worktree isolation, and a code-quality
ratchet that new code cannot quietly slip past.

It assumes nothing about your language. Python, Go, Rust, TypeScript, a shell
project, a mixed monorepo — the shell is the same, and the parts that must know
about your stack live in five clearly-marked files.

## Why this exists

Most quality gates fail one of two ways. Coverage thresholds get gamed. Lint
configs get loosened the first time they block someone. Both fail quietly.

The ratchet here fails loudly instead. Every existing violation is recorded in
a committed baseline and grandfathered at its current value. New code is held
to the strict limits — including new functions added to legacy files. The gate
can get tighter on its own, but it can only be loosened by editing a tracked
file, which shows up in review as exactly what it is.

That property matters most when an agent is writing the code. An agent will
cheerfully produce a 300-line function, and it will just as cheerfully raise a
threshold to make its own check pass. Here it can do neither without leaving a
diff someone has to approve.

## Quick start

```bash
git clone https://github.com/rubenszinho/forge my-project
cd my-project
rm -rf .git && git init -b main

./bin/mise install     # provision the pinned toolchain into ./.mise
./bin/mise exec -- task setup   # render .env, install hooks, install deps
./bin/mise exec -- task validate
```

Then fill in the five project-owned files (see below). Once `mise` is
activated in your shell, drop the `./bin/mise exec --` prefix.

## What you edit, and what you leave alone

| Project-owned — shape these        | What it holds                                  |
|------------------------------------|------------------------------------------------|
| `taskfiles/project.yml`            | your stack's commands (lint, test, dev, …)      |
| `quality.toml`                     | thresholds and which paths get measured         |
| `commit.toml`                      | allowed commit types and scopes                 |
| `env.template`                     | the env vars and ports your stack needs         |
| `process-compose.yml`              | your local process graph                        |

| Forge-owned — change deliberately  | What it holds                                   |
|------------------------------------|-------------------------------------------------|
| `Taskfile.yml`                     | the command surface everything else calls        |
| `lefthook.yml`                     | which tasks run at which git stage               |
| `tools/`                           | the ratchet, commit linter, env renderer          |
| `.github/workflows/ci.yml`         | CI, which only ever calls `task ci:<job>`         |
| `AGENTS.md`                        | the contract agents read                          |

## The five layers

**1. Toolchain — `mise.toml` + `bin/mise`.** Every tool is pinned and locked in
`mise.lock`, installed into a gitignored `.mise/`, never system-wide. `bin/mise`
is a committed bootstrap, so CI needs no `setup-python`/`setup-node` action and
a fresh clone needs nothing preinstalled.

The metrics tool is pinned to an **exact** version, unlike everything else. A
parser that changes between patch releases re-measures existing code and
silently rewrites the baseline; that class of change has to arrive explicitly.

**2. Command surface — `Taskfile.yml`.** Hooks, CI and agents call task names
and never spell out commands. `task -l` lists everything; arguments after `--`
are forwarded. `taskfiles/project.yml` holds the stack-specific half as no-op
hook points you fill in.

**3. Quality ratchet — `tools/quality/`.** Four metrics: function lines (25),
cyclomatic complexity (15), parameters (5), file lines (500). The default
engine is `lizard`, which covers around twenty languages; a scope can instead
name an adapter — any executable that takes file paths and emits one JSON
object per line:

```json
{"file": "src/a.go", "function": "Run", "nloc": 12, "ccn": 3, "params": 2}
```

File length is counted by the core itself, so a scope works even when nothing
can parse the language (`engine = "none"`).

Local runs pass `--write`: an improvement rewrites the baseline and passes. CI
runs without it, so the same improvement **fails** as a stale baseline. That
asymmetry is deliberate — it forces a refactor to commit the regenerated
baseline instead of leaving the recorded numbers drifting behind reality.

**4. Hooks — `lefthook.yml`.** `pre-commit` runs format (priority 1), lint
(priority 2), then the ratchet (priority 3), because formatters must settle the
files before anything measures them. Format and lint re-stage what they fix;
the ratchet deliberately does not, since a baseline change belongs in the
commit as a conscious act. `pre-push` runs the full `task validate`.
`commit-msg` validates against `commit.toml` — in Python, so a Go project does
not need npm to lint a commit subject.

**5. Isolation — `tools/env/render_env.py`.** `task env:render` derives
`SESSION` from repo and branch, then assigns each named port by hashing
`(session, key)` and re-rolling deterministically past anything already bound.
Two worktrees of the same repo get different ports and container names and run
side by side, with no registry file to keep in sync.

Renaming a branch changes the session, which would orphan the containers and
volumes named after the old one. The renderer detects that and refuses until
you clean up or pass `--force`.

## Agent layer

`AGENTS.md` is the single contract, with `CLAUDE.md` and `GEMINI.md` symlinked
to it. The thresholds appear there in prose and in `quality.toml` as numbers;
`task quality:thresholds` is what settles a disagreement.

`.claude/settings.json` registers a `Stop` hook that runs `task validate` when
an agent tries to finish with uncommitted source changes, and blocks with the
failure output if it does not pass. "Always validate before finishing" stops
being a rule the agent can forget.

Skills live in the tool-neutral `.agents/skills/`, with `.claude/skills`
symlinked to it.

## Using codeherd instead of the built-in renderer

If you use [codeherd](https://github.com/xico42/codeherd) for worktrees and
tmux sessions, it renders `*.herd` templates itself:

1. `mv env.template .env.herd`
2. Change `{{ session }}` to `{{ .SessionName }}`, keeping `{{ port "name" }}`.
3. Add `files = [".env.overrides"]` to the project in your codeherd profile so
   secrets follow you into new worktrees.
4. Delete `tools/env/` and the `env:render` task.

## Layout

```
mise.toml  mise.lock  bin/mise        toolchain
Taskfile.yml  taskfiles/project.yml   commands
lefthook.yml                          git hooks
quality.toml  .quality-baseline.json  the ratchet
commit.toml                           commit rules
env.template  process-compose.yml     local stack
tools/quality  tools/commit  tools/env  tools/agent  tools/tests
AGENTS.md  CLAUDE.md  GEMINI.md  .agents/skills  .claude
docs/specs  docs/plans              spec-then-plan record
.github/workflows/ci.yml
```
