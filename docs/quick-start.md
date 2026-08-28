# Quick start

## Requirements

Git and a POSIX shell. Everything else — including the language runtimes — is
provisioned by the committed `bin/mise` bootstrap into a gitignored `.mise/`.

Docker is needed only if `process-compose.yml` declares container processes.

## First run

```bash
./bin/mise install                # provision the pinned toolchain
./bin/mise exec -- task setup     # .env, git hooks, project deps
./bin/mise exec -- task validate  # the gate
```

Activating mise in your shell (`mise activate fish | source`, or the bash/zsh
equivalent) lets you drop the `./bin/mise exec --` prefix. The prefix always
works, which is why hooks and CI use it.

## Daily loop

```text
task dev              start the local stack
task dev:tui          attach to it
task dev:stop         stop it
task dev:stop-clean   stop it and erase this session's containers and volumes

task format -- PATH   autofix formatting
task lint   -- PATH   autofix lint
task validate         everything (also runs on pre-push)
```

## Wiring up your stack

1. **`taskfiles/project.yml`** — replace the no-op hook points with your real
   commands. Commented examples for Python, Node, and Go sit next to each.
   The `:check` variants must not modify files.
2. **`quality.toml`** — point a `[[scope]]` at your source directory with the
   right extensions. Add one scope per language.
3. **`commit.toml`** — narrow the types, and list scopes if you want an enum.
4. **`env.template`** — declare the ports and variables your stack needs, then
   `task env:render`.
5. **`process-compose.yml`** — declare your processes. Delete the sample ones.

## Adopting the ratchet in an existing codebase

A fresh project needs no baseline: with no `.quality-baseline.json`, everything
is held to the strict thresholds from the first commit.

For a codebase that already has violations:

```bash
task quality:baseline     # record what exists today
git add .quality-baseline.json
```

From then on, existing violations are grandfathered at their recorded values
and everything new is held to the limits. Improve a baselined function and
`task quality:check` rewrites the baseline — commit that with the refactor,
because CI fails on a baseline that lags the code.

## Troubleshooting

**`task: command not found`** — you are not inside mise. Use
`./bin/mise exec -- task ...` or activate mise in your shell.

**The ratchet reports different numbers than a teammate's run** — someone is
running an unpinned metrics tool. Always go through `./bin/mise exec`; the
`pre-commit` hook already does.

**CI fails with "baseline is stale"** — a refactor improved the code without
committing the regenerated baseline. Run `task quality:check` locally and
commit the changed `.quality-baseline.json`.

**`task env:render` refuses to write** — the branch was renamed, so the session
name changed and the old session's containers and volumes are now orphaned.
Run `task dev:stop-clean` first, or pass `-- --force` if there is nothing
running.

**A port conflicts anyway** — ports are re-rolled past anything currently
bound, so a process started *after* rendering can still collide. Re-run
`task env:render -- --force`.
