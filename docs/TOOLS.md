# Agent tool disclosure

Two different sets of agents are involved in this submission, and conflating
them would be misleading, so they are listed separately: the agents that
_wrote_ the project, and the agents that _are_ the project.

Trajectories for both are in [`../trajectories/redacted/`](../trajectories/redacted/).

## Agents that built this project

| Tool                   | Model                 | Role                                                  |
| ---------------------- | --------------------- | ----------------------------------------------------- |
| Claude Code (CLI)      | `claude-opus-5[1m]`   | exploration, implementation, review, refactoring      |
| Claude Code sub-agents | inherited from parent | parallel search and review; logged under `subagents/` |

No other assistant, autocomplete, or MCP server was used.

## Agents inside the deliverable

The workflow is a fixed sequence of model calls with deterministic tooling
between them, rather than a single agent with a tool loop. Each step is its own
prompt with its own contract, which is what lets the changelog attribute the
improvement to a specific step instead of to the whole.

| Step       | Where                 | What it is given                                                                         | What it returns                                                  |
| ---------- | --------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `triage`   | `src/agent/prompt.ts` | change and alert timelines in full, plus metric movement **computed and ranked in code** | onset estimate, reasoning, and the log searches to run           |
| _(search)_ | `src/agent/tools.ts`  | the queries triage asked for                                                             | up to 12 addressed log lines per query, spread across the window |
| `draft`    | `src/agent/prompt.ts` | the same timelines, the ranked movement, its own triage, and the search results          | the full RCA                                                     |
| `verify`   | `src/agent/verify.ts` | the draft and the bundle                                                                 | the citations that do not resolve — **no model involved**        |
| `repair`   | `src/agent/solve.ts`  | the draft plus the specific failures                                                     | a corrected RCA, up to twice                                     |

The baseline is one call: `src/baseline/solve.ts`.

Both share `completeJson` (`src/llm/structured.ts`), which spends one repair
turn when a response fails schema validation. That is deliberate — giving only
the workflow JSON repair would move the measurement onto plumbing.

### Model

|             |                                                   |
| ----------- | ------------------------------------------------- |
| Provider    | OpenRouter (any OpenAI-compatible endpoint works) |
| Model       | `anthropic/claude-sonnet-4.5`                     |
| Temperature | 0                                                 |
| Max tokens  | 8000                                              |

Set in `env.template`. Nothing in the code names a provider.

## MCP servers

None, in either set.

## How the trajectories were produced

`task project:trajectories` mirrors Claude Code's session logs
(`~/.claude/projects/<slug>/<session>.jsonl`, and `subagents/`) into
`trajectories/raw/`. A loop ran it every five minutes for the whole sprint,
because a crashed or rotated session cannot be reconstructed afterwards.

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
