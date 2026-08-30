# Agent tool disclosure

Two different sets of agents are involved in this submission, and conflating
them would be misleading, so they are listed separately: the agents that
_wrote_ the project, and the agents that _are_ the project.

Trajectories for both are in [`../trajectories/redacted/`](../trajectories/redacted/).

## Agents that built this project

| Tool              | Model               | Role                                             |
| ----------------- | ------------------- | ------------------------------------------------ |
| Claude Code (CLI) | `claude-opus-5[1m]` | exploration, implementation, review, refactoring |

One agent, one session thread. **No sub-agents were spawned** - an earlier
version of this table claimed they were and pointed at a `subagents/` directory
that does not exist. No other assistant, autocomplete, or MCP server was used.

## Agents inside the deliverable

**What ships is search, draft, verify, repair.** Triage, cross-incident memory
and an iterative investigation loop are all implemented and all switched off:
each was measured and each lost. Nothing in the shipped path chooses an action —
the four search queries are fixed constants. That is a result, recorded in
[`CHANGELOG.md`](CHANGELOG.md), not an unfinished design.

The workflow is therefore a fixed sequence of model calls with deterministic
tooling between them, rather than an agent with a tool loop. An iterative variant
exists and was measured; it lost, and the reasoning is in the changelog. Each step is its own
prompt with its own contract, which is what lets the changelog attribute the
improvement to a specific step instead of to the whole.

| Step       | Where                 | What it is given                                                               | What it returns                                                  |
| ---------- | --------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| _(search)_ | `src/agent/tools.ts`  | four fixed queries; no model picks them                                        | up to 12 addressed log lines per query, spread across the window |
| `draft`    | `src/agent/prompt.ts` | both timelines in full, metric movement ranked in code, and the search results | the full RCA                                                     |
| `verify`   | `src/agent/verify.ts` | the draft and the bundle                                                       | the citations that do not resolve — **no model involved**        |
| `repair`   | `src/agent/solve.ts`  | the draft plus the specific failures                                           | a corrected RCA, up to twice                                     |

The baseline is one call: `src/baseline/solve.ts`.

Both share `completeJson` (`src/llm/structured.ts`), which spends one repair
turn when a response fails schema validation. That is deliberate — giving only
the workflow JSON repair would move the measurement onto plumbing.

### Model

|             |                                               |
| ----------- | --------------------------------------------- |
| Provider    | OpenAI (any OpenAI-compatible endpoint works) |
| Model       | `gpt-4.1-mini`                                |
| Temperature | 0                                             |
| Max tokens  | 8000                                          |

Set in `env.template`. Nothing in the code names a provider.

## MCP servers

None, in either set.

## How the trajectories were produced

`task project:trajectories` mirrors Claude Code's session logs
(`~/.claude/projects/<slug>/<session>.jsonl`) into `trajectories/raw/`. A loop
ran it on a five-minute cadence, because a crashed or rotated session cannot be
reconstructed afterwards. `trajectories/capture.log` is the record: 366 captures
between 2026-08-28 22:13 and 2026-08-30 18:25 UTC, median gap 5.0 minutes, with
two gaps - 1.5 hours and 13.5 hours overnight - when the machine was asleep.

`task project:trajectories:redact` rewrites credential-shaped strings before
anything is committed. `task project:trajectories:verify` fails if one
survives. Only `trajectories/redacted/` is committed; `trajectories/raw/` is
gitignored. This is what ground rule 08 asks for.

The redactor is not taken on trust — `tools/tests/test_redact.py` pins all
eleven credential shapes it claims to catch, that a harmless `LOG_LEVEL=debug`
survives, and that nested structures are walked.

The deliverable's own model calls are recorded separately and in full under
`fixtures/cassettes/`: prompt, response and token usage for every call the
evaluation made. Those are the workflow's trajectories, and they are what
`replay` mode reads.

## Division of labour

Written up honestly in [`CHANGELOG.md`](CHANGELOG.md) alongside each iteration:
what the agent produced, what was directed, and what was rejected or rewritten
by hand.

Two things worth stating plainly here, because they cut against the tool:

- The quality ratchet rejected nine functions written during this build for
  exceeding the 25-line limit, including the grader's own `grade()` at 47
  lines. Every one was split. No threshold was raised.
- `lizard`, the metrics engine behind that ratchet, reported a five-line
  function as forty-three: a regex literal confuses its TypeScript tokenizer
  and it swallowed the two functions that followed. The gate was confidently
  wrong, and following it would have meant refactoring working code.
