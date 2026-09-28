---
name: Bug report
about: The checker or the evaluator does not do what SPEC.md says
title: ''
labels: bug
assignees: ''
---

**Which surface**

`validate`, `attenuate`, `evaluate`, the CLI, the schema, or a vector.

**What happened**

What SPEC.md says should happen, and what did. Quote the decision or the error list verbatim.

**Minimal reproduction**

The smallest policy / payment / ledgerState triple that shows it. Whole minor units only — a vector carrying a float is a different bug (and the checker should have refused it; say so if it did not).

**Environment**

`node -v`. Nothing else is installed, so nothing else is relevant.

**Is this a spec question rather than a code bug?**

If the code does what SPEC.md says and SPEC.md is wrong, use the spec change template instead.
