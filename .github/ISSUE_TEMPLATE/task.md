---
name: Task
about: Describe a product/engineering task following the standard template
title: ""
labels: []
assignees: []
---

<!--
This issue is a structured prompt. Keep the three sections honest:
- Constraints & Out of Scope = the DON'Ts (hard rules + deferrals to other tasks)
- Acceptance Criteria        = the MUSTs  (verifiable functional outcomes)
- Technical Approach         = the MAYs   (advisory hints the engineer can override)
If a Technical Approach bullet says "never / must / don't", it is misfiled — move it up to Constraints.
-->

## Problem

<!-- The functional gap, from the customer/business point of view: what is broken or missing.
     If this issue is one slice of a larger strategy, open with a few plain-language sentences
     summarizing that strategy so the reader needs no prior context. Define a term before using it. -->

## Goal

<!-- How THIS issue moves toward solving the problem — fully or partially. The "what", not the "how".
     State it in its own words; don't lean on concepts defined only in an external doc. -->

## Constraints & Out of Scope

<!-- The "don'ts". Phrase each as an imperative + reason. Two kinds belong here:
     - Hard rules the implementation must obey ("Don't add a new error type — reuse X").
     - Deferred scope owned by another task ("Don't build Y — it lands in #NN").
     Reduces ambiguity as much as the acceptance criteria. -->

-

## Acceptance Criteria

<!-- Verifiable functional outcomes — what is observably true when this is done. NOT a technical spec.
     Describe effects (behavior, response, state), not the mechanism that produces them.
     Include minimal quality gates (tests, i18n check, `task validate`). -->

-

## Technical Approach

> Hints, not a spec — the implementing engineer decides the final shape.

<!-- Advisory only: the "how" as hints the engineer may ignore after deep-diving. Cite file paths.
     Do not over-specify — overspecifying minimizes the value of this section.
     Anything binding ("never/must/don't") belongs in Constraints, not here.
     Keep the blockquote disclaimer above so readers know this section is non-binding.
     Remove this section if the issue has no relevant technical component. -->

## Additional Context

<!-- The most important section for a clean handoff — invest in it.
     It is what lets the implementer (human or agent) act without re-discovering the codebase.
     Background that supports (but does not dictate) the solution: current state of the code with
     exact paths/line numbers, links to the authoritative strategy/spec and the relevant sections,
     example payloads, related issues, and the rationale behind the decisions recorded above. -->
