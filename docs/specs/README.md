# Specs

One file per design decision, named `YYYY-MM-DD-<slug>-design.md`.

A spec is written **before** the implementation and answers: what problem this
solves, what was decided, what was rejected and why, and what the acceptance
criteria are. It is not a status report — it is the document that lets someone
(or some agent) six months from now understand why the code looks like this
instead of the obvious alternative.

Reference the spec from the code it explains: a header comment in the file that
implements it, pointing back here, is what keeps the two from drifting apart.
