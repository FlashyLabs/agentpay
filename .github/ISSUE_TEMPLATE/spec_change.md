---
name: Spec change
about: Propose a change to pay-policy/1 — a field, a rule, a refusal, a decision code
title: 'spec: '
labels: spec
assignees: ''
---

**What changes**

The field, rule or code, and its new meaning. Vendor-neutral: no rail, wallet or brand name goes inside the format.

**Why**

The real policy somebody needed to write and could not, or the real payment the evaluator answered wrongly.

**Which invariant it touches**

- [ ] Minor integer units with an explicit currency (floats refused)
- [ ] A child policy only narrows its parent
- [ ] A spending policy carries a human gate
- [ ] The evaluator is pure and deterministic
- [ ] `deny` and `escalate` carry reasons; `allow` never widens

A change that weakens one of these is refused. A change that adds a way to express something within them is what this template is for.

**Vectors**

The valid and invalid vectors the change needs. A rule with no vector that fails without it is not a rule.

**Version**

Does this fit in `pay-policy/1` (additive, every existing valid vector stays valid) or does it need `pay-policy/2`?
