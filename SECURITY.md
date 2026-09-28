# Security

## Reporting

Report suspected vulnerabilities to **security@flashylabs** (address to be
confirmed before launch — until it is, a private report to the repository
owner is the route) rather than a public issue. Coordinated disclosure: we
acknowledge, we keep you updated, and we agree a window before anything is
published.

## Scope

This repository is a **specification and a pure checker**. It opens no
connections, holds no keys, moves no value, reads no clock, and authenticates
nobody. Its whole surface is three functions and a CLI over local JSON files.

## What counts here

Anything that makes the answer lie:

- a policy document that **validates and should not** — a float that gets
  through, a missing currency that reads as present, a spending policy that
  passes without a human gate, an unknown key that is accepted
- a child policy that **widens its parent** and `attenuate` calls valid
- an `evaluate` that answers **`allow`** for a payment the policy refuses,
  or `allow` where the spec says `escalate`
- a `deny` or `escalate` with **no reasons**
- a checker crash or hang on hostile input (a checker people run in CI is a
  supply chain)

Something the evaluator refuses that a rail then pays anyway is a finding
about the rail, not this repository — but tell us, because it may mean the
decision shape is easy to misread.

## Supported versions

There is no published version yet. Status: draft. Findings against the
default branch are in scope.
