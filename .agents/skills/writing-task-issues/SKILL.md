---
name: writing-task-issues
description: Use when writing, drafting, or filling a GitHub issue body for this repo's task template — breaking an epic into sub-issues, fleshing out an empty issue, or turning a planned task into a ready-to-implement ticket.
---

# Writing task issues

## Overview

A task issue is a **structured initial prompt** for whoever implements it (human or agent). The
template ([`references/task-template.md`](references/task-template.md)) gives you the *structure*;
this skill gives you the *process and judgment* it can't enforce: scout the real code before
writing, keep each section at its correct altitude, and invest in context.

Keep a well-written issue from this repo alongside the template as the exemplar to copy
from; a real one from your own codebase beats a generic sample.

## The three-section contract

| Section | Role | Voice |
|---|---|---|
| **Constraints & Out of Scope** | the **don'ts** (hard rules + deferrals) | imperative: "Don't X — reason" |
| **Acceptance Criteria** | the **musts** (verifiable outcomes) | observable: "X is true when done" |
| **Technical Approach** | the **few non-obvious mays** (advisory hints) — usually the *shortest* section | optional: opens with `> Hints, not a spec…` |

`Problem` (functional gap + a plain-language primer if it's a slice of a bigger strategy) and
`Goal` (how this slice helps, in its own words) come first. `Additional Context` comes last and
matters most (below).

## Process

1. **Scout first — verify, don't trust.** Read the actual files before writing. The strategy/spec
   often says "create X" where X already exists, or cites line numbers that have drifted. Confirm
   every path, symbol, and "current state" claim against the code. An Explore agent is good for this.
2. **Draft** to a temp file following the contract.
3. **Run the three altitude checks** (below) before pushing.
4. **Create + link** under the epic (mechanics below).

## The three altitude checks (the heart of this skill)

Run these on your draft every time — they are where issues silently degrade.

**Check 1 — Acceptance Criteria describe outcomes, not mechanism.**
If an AC item names a class, function, file, decorator, or code shape, it's a *how* masquerading as a
*what*. Rewrite it as the observable effect.

```diff
- Every read endpoint carries `dependencies=[Depends(RequirePermission(...))]`.   # HOW (leaked)
+ A caller whose role lacks the capability gets 403 on these endpoints;           # WHAT (outcome)
+ a caller who holds it gets the normal 200.
```

Mechanism belongs in Technical Approach. AC answers only: *what is observably true when this is done?*

**Check 2 — Technical Approach contains no binding language.**
Scan for "never / must / don't / always". Each one is a hard rule wearing a hint's clothing → move it
up to Constraints. Technical Approach must survive the reader ignoring all of it.

**Check 3 — Technical Approach is the *few non-obvious* hints, not a walkthrough.**
For each bullet ask: *would a competent implementer, holding the Additional Context, already do this
without being told?* If yes, **cut it**. What survives is only what they'd plausibly get wrong or
wouldn't think of — a specific abstraction to build, a gotcha, a sequencing subtlety. Restating
scouted `path:line` facts here is duplication; those live in Additional Context. TA is the *shortest*
section, not the longest — if it's your longest, you're re-deriving the implementation.

```diff
# Eight bullets re-deriving the whole build — model columns, migration mechanics,
# service methods, config wiring, routes, admin CRUD, frontend — all obvious-by-default
# or already in Additional Context:
- Create `app/models/invitation.py` mirroring `beta_invite_code.py:33-86`, status VARCHAR(20)…
- Add `user_allowed_organizations` per §6: user_id/organization_id FKs ON DELETE CASCADE…
- Hand-write the migration under alembic/versions; multiple heads, pick down_revision…
- Service with create/list/resend/revoke on AsyncSession like `credit_service.py:40-100`…
- Read the 7-day expiry from SAAS_PARAMETERS key on `config.py:380`…
- Keep routes thin like `users.py:65-108`, return `success_response()`…
- Add admin CRUD like `admin/accounts.py:75-118`…
- Frontend: TanStack Query hooks through the proxy route…
# ↓ Keep only the two real decisions a competent implementer wouldn't reach by default:
+ Put the invitation/grant logic in a service layer behind thin routes (existing service pattern).
+ Wrap the email send behind a DI'd interface so the logging stub and the later real Brevo
+ implementation are swappable — inject it rather than reaching for the Brevo service directly.
```

The cut bullets weren't *wrong* — they were the steps any implementer takes by default, or facts that
belong in Additional Context. "Useful and true" is not the bar; "non-obvious and load-bearing" is.

## Additional Context is the highest-leverage section

It's what lets the implementer act without re-discovering the codebase. Invest here:
- **Verified** current-state facts with exact `path:line` (from your scout, not from the doc).
- Links to the authoritative strategy/spec **and the specific sections** that apply.
- Related issues, example payloads, and the rationale behind the Constraints.

A thin Additional Context is the main failure mode — it pushes your scouting work onto the implementer.

## Mechanics

```bash
gh issue create --title "<title>" --body-file /tmp/body.md
# Link as sub-issue: needs the database id (.id), NOT the issue number,
# and -F (integer). -f sends a string and 422s.
SUB_ID=$(gh api repos/<owner>/<repo>/issues/<new#> --jq '.id')
gh api repos/<owner>/<repo>/issues/<epic#>/sub_issues -F sub_issue_id="$SUB_ID"

gh issue edit <#> --body-file /tmp/body.md   # fill an existing empty issue; keep its number
```

## Common mistakes

| Mistake | Fix |
|---|---|
| "The doc is comprehensive, I have enough" → no scouting | Read the files. The doc says "create X" where X exists. |
| AC names a decorator/class/file | Demote to Technical Approach; state the observable effect instead. |
| Hard rule ("reuse X, don't add Y") sits in Technical Approach | Move to Constraints as "Don't … — reason". |
| Technical Approach re-derives the whole build (model, migration, routes, frontend…) | Cut every bullet the implementer would do anyway; keep the few non-obvious decisions. Facts → Additional Context. |
| Problem assumes the reader knows the strategy | Add a few-sentence primer; define terms before use. |
| Standalone "create DB schema" task | DB changes ride with the CRUD/feature task that needs them. |
| `-f sub_issue_id` (string) → 422 | Use `-F` with the issue's `.id` (integer), not its number. |

## Red flags — stop and fix before pushing

- You wrote the body without reading a single source file.
- An AC item would only make sense to someone who's seen the code.
- Technical Approach says "must" or "never".
- Technical Approach is your longest section, restates `path:line` facts from Additional Context, or enumerates the obvious model/migration/route/CRUD steps.
- Additional Context has no `path:line` references.
