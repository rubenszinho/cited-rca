---
name: squashing-commits
description: Compose a polished commit message and optionally squash commits when finishing work on a branch or worktree. Use this skill whenever the user says things like "finish this branch", "squash commits", "prepare for MR", "wrap up", "finalize", "commit final", "ready for review", or wants to consolidate branch history into a single, well-crafted commit. Also use when another skill delegates commit message composition here — even for a single file or a single commit where there is nothing to squash. The core value is the structured commit message, not the squash.
---

# Squashing Commits

This skill guides the process of composing a well-crafted commit message that follows the project's commit message rules. When there are multiple commits on a branch, it also handles squashing them into one. The goal is to produce a commit that tells a complete story — why the change was needed, what decisions were made, and what those decisions mean for the system — so that anyone reading `git log` months later understands the change without reading the diff.

## When to use

- The user is done implementing on a feature branch or worktree
- They want to squash before opening a MR/PR
- They want to rewrite a messy commit history into one coherent commit
- Another skill needs a properly structured commit message
- There are staged or unstaged changes that need to be committed with a good message — even if there is only one file and nothing to squash

## Step 1: Gather context

Determine the current state — are there multiple commits to squash, a single commit to amend,
or uncommitted changes to commit fresh?

```bash
# Check for uncommitted changes
git status --short

# Find the base branch (usually main)
git merge-base HEAD main

# Count commits on this branch since diverging
git rev-list --count main..HEAD

# All commits on this branch since diverging (skip if count is 0)
git log --reverse --format="%h %s%n%n%b%n---" main..HEAD

# Full diff — use staged/unstaged diff if no commits yet, otherwise diff against main
# If commits exist on branch:
git diff --stat main..HEAD
git diff main..HEAD
# If no commits yet (only staged/unstaged changes):
git diff --stat HEAD
git diff HEAD

# Check for scope conventions in project history
git log --oneline -30 main
```

Read the diff carefully. The commit message body explains *why*, not *what* — you need to understand the changes deeply to write about their motivation and consequences.

## Step 2: Identify the story

Before writing anything, answer these questions internally:

1. **What problem did this branch solve?** What was broken, missing, or inadequate before?
2. **What were the significant decisions?** Not every file change is a decision. Focus on choices that constrain future work, that would surprise a reader, or that have functional consequences.
3. **What are the tradeoffs?** Did any decision close a door or open one? Did you choose one approach over another for a specific reason?
4. **What's trivial?** Some changes are mechanical (renaming, formatting, config). Don't give these equal weight to architectural decisions.

## Step 3: Choose the type

| Type     | When                                      |
|----------|-------------------------------------------|
| `feat`   | New feature or significant improvement    |
| `fix`    | Bug or problem correction                 |
| `docs`   | Documentation updates                     |
| `revert` | Reverts a previous commit                 |
| `chore`  | Maintenance, CI/CD, dependencies          |

Most feature branches are `feat`. Use your judgment.

This table is the human half of the rule; `commit.toml` is the machine half, and the
`commit-msg` hook enforces it. If a project narrows the type or scope list, it does so
there — check it before composing.

## Step 4: Write the commit message

Follow this format exactly:

```
type[(scope)]: subject

Problem description.

Solution detail.
```

The `(scope)` is optional — see "Scope prefix" below for when to include it.

### Subject line rules

- All lowercase, no trailing period, max 72 characters
- Imperative verb (e.g., `implement`, `fix`, `add`)
- Must complete the sentence "This commit will… [subject]"

#### Scope prefix

The format `type(scope): subject` is allowed when the project has clear boundaries that justify it — typically monorepos or multi-package repositories where the scope disambiguates which package or module is affected.

To decide whether to use a scope:

1. Check `git log --oneline -30` for existing scope usage patterns in the project. If the project already uses scopes consistently, follow the convention.
2. If the project is a monorepo or has multiple distinct packages/modules, a scope helps readers filter history (e.g., `feat(api): ...`, `fix(web): ...`).
3. If the boundaries are not obvious, ask the user whether a scope is appropriate and what value to use.
4. In single-package repos with no prior scope usage, omit the scope — the diff shows which files changed.

### Body rules

The body is written as **prose paragraphs** (no bullet lists). Default to English unless the user has indicated another preference.

**Problem paragraph:** Explain *why* the change was needed. What was broken, missing, or inadequate. The reader should understand the motivation without reading the diff.

**Solution paragraphs:** Explain the technical decisions and their *functional consequences*. The diff shows *what* changed; the body explains *why this approach* and *what it means for users of the system*.

### Writing principles

These principles separate a good commit message from a mediocre one:

**Lead with functional impact, not implementation detail.** A decision matters because of what it enables or prevents, not because of which file was edited.

- Good: "Figma Code Connect wires the Figma component properties to the React props. In practice, when a designer selects a Button in Dev Mode, the panel shows the real snippet instead of auto-generated CSS."
- Bad: "Creates component.figma.tsx with figma.connect() mapping Variant, Size, Roundness and State."

**Separate significant decisions from trivial ones.** Not every change deserves the same weight. Configuring a registry URL is a mechanical step; choosing to disable dark mode globally has architectural consequences. Give space to decisions that would surprise a reader or that constrain future work.

**Explain constraints and tradeoffs.** If a decision closes a door or opens one, say so. "The node ID must point to the component set, not to an individual variant — the CLI rejects variants" saves someone from repeating a mistake.

**One topic per paragraph.** Each paragraph covers one decision or closely related group of decisions.

**No bullet lists in the body.** Write prose. Bullet lists fragment reasoning and hide causality. A paragraph forces you to connect cause to effect.

### Anti-patterns to avoid

| Pattern                              | Problem                                                        |
|--------------------------------------|----------------------------------------------------------------|
| Listing every file changed           | The diff shows this. Redundant.                                |
| "Update X, Y, Z" as the subject      | Describes what, not why. Too vague.                            |
| Elevating trivial changes            | Implies equal weight to all changes.                           |
| Describing the diff in the body      | The reader can see the diff. Explain *why*.                    |
| Bullet-point body                    | Fragments reasoning. Write paragraphs.                         |
| Scope prefix without convention      | Don't invent scopes in repos that don't use them.              |
| Mixing languages                     | Pick one language and stay consistent.                         |

## Step 5: Present and confirm

Show the complete commit message to the user for review before executing anything. Ask:

- Does the problem description capture the real motivation?
- Are there decisions or tradeoffs I missed?

**If there are multiple commits to squash**, also list every commit that will be squashed so
the user sees exactly what disappears:

```
The following commits will be squashed into one:

  <short-sha> <title>
  <short-sha> <title>
  ...
```

Generate this list from `git log --reverse --format="%h %s" main..HEAD`. The squash is destructive — **do not proceed without explicit user confirmation**.

**If there is only one commit or uncommitted changes**, skip the squash listing — just present
the commit message for approval.

## Step 6: Execute the commit

Only after the user approves the message, execute the commit. The approach depends on the
branch state:

### Multiple commits → squash into one

```bash
# Soft reset to keep all changes staged
git reset --soft main

# Commit with the approved message
git commit -m "$(cat <<'EOF'
<the approved message>
EOF
)"
```

**Important:** If the branch has already been pushed, warn the user that squashing will require
a force push (`git push --force-with-lease`). Do NOT force push without explicit confirmation.

### Single commit or uncommitted changes → direct commit

```bash
# Stage any unstaged changes if needed
git add <files>

# Commit with the approved message
git commit -m "$(cat <<'EOF'
<the approved message>
EOF
)"
```

No squash or force push needed in this case.

---

After the commit, run `git log -1 --format=full` to show the result.

## Step 7: Offer to open the Merge Request

A commit ready for review is the natural trigger for a Merge Request. Ask the user:

> Commit created. Open the Merge Request now? (y/N)

If the answer is affirmative, open the Merge Request (e.g. `gh pr create`), reusing the
fresh commit message as the primary source for the MR description. If the user declines or
stays silent, stop here; the branch is ready for MR whenever they return.

Do not block on this step. Do not open the MR without explicit user confirmation.

## Example output

```
feat: hold new functions to strict limits inside legacy files

A baseline that grandfathers whole files lets a legacy module keep
absorbing new complexity forever: every function added to an already
baselined file inherited the exemption, so the worst files in the
codebase were the easiest place to add more bad code.

The baseline now grandfathers functions, not files. A function present
in the baseline is gated on its recorded value; anything absent is held
to the strict thresholds regardless of which file it sits in.

File length keeps its own rule: it ratchets only for files already past
the limit. Gating a compliant file at its recorded length would freeze
a 16-line file at 16 lines the moment one of its functions was
baselined, and read every later addition as a regression.
```

```
fix: stop the env renderer orphaning a renamed branch's stack

Ports and container names are seeded from the branch, so renaming a
branch silently re-seeds everything. The old session's containers and
volumes kept running under names nothing referenced any more, and
`task dev:stop` could no longer see them.

The renderer now compares the SESSION recorded in an existing .env
against the one it is about to write, and refuses when they differ,
naming both sessions and pointing at `task dev:stop-clean`. Passing
--force renders anyway, for the case where nothing is running.
```
