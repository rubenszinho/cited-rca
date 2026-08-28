<!--
One commit per PR (see .agents/skills/squashing-commits/SKILL.md). The commit
body carries the why and how; this page must still stand on its own for a
reviewer and for whoever has to roll it back.
Fill every section. Delete a section's guidance comment, not its heading.
-->

## Summary

<!-- Self-contained: what changed and why, in a few sentences. A reviewer
should grasp the change without opening the commit or the linked issue. -->

## Related issues

<!-- REQUIRED. Use a closing keyword (Closes/Fixes #N) for issues this PR fully
resolves; "Refs #N" for partial work. -->

- Closes #

## How to test

<!-- Steps a reviewer can run locally: setup (which `task` commands, any seed
data or env), the actions, and the expected result for each. -->

1.

## Rollback

<!-- Default is `git revert <sha>` — one commit per PR keeps that clean. If the
change touches state, spell out what a revert also needs: schema migrations
(is there a down path?), queues or topics, scheduled jobs, feature flags,
stored objects, seeded data. -->

Plain `git revert`.

## Checklist

- [ ] `task validate` passes
- [ ] Tests added or updated — new functions covered, bug fixes have a regression test
- [ ] Docs updated — including AGENTS.md if the contract moved
- [ ] `.quality-baseline.json` changes (if any) are the result of a refactor, not a loosened threshold
