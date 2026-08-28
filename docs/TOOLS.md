# Agent tool disclosure

The hackathon requires coding-agent use and requires disclosing the tools used.
This file is that disclosure; `trajectories/redacted/` holds the session logs.

## Agents used to build this project

| Tool | Model | Role |
|---|---|---|
| Claude Code (CLI) | `claude-opus-5[1m]` | primary coding agent: exploration, implementation, review |
| Claude Code sub-agents | inherited | parallel search and review; logged under `subagents/` |

## Agents used *inside* the deliverable

<!-- The RCA workflow's own agents. Filled in as they are built - each one is a
     separate trajectory the judges expect to see (final deliverable 04). -->

| Agent | Role |
|---|---|
| | |

## MCP servers

_(none)_

## How the trajectories were produced

`task project:trajectories` mirrors Claude Code's session logs
(`~/.claude/projects/<slug>/<session>.jsonl`, plus `subagents/`) into
`trajectories/raw/`; a loop runs it every five minutes for the whole sprint,
because a crashed or rotated session cannot be reconstructed afterwards.

`task project:trajectories:redact` rewrites credential-shaped strings before
anything is committed, and `task project:trajectories:verify` fails if one
survives. Only `trajectories/redacted/` is committed — `trajectories/raw/` is
gitignored. This satisfies ground rule 08.

The redactor is tested: `tools/tests/test_redact.py`, 16 cases.

## Division of labour

<!-- Filled in during the sprint. Judges score engineering judgement, so be
     concrete about what the agent produced versus what was directed, rejected
     or rewritten by hand. -->
