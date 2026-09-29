# agentpay — `pay-policy/1`, the payment-policy layer for agents

Not a wallet. A vendor-neutral policy format plus a pure evaluator that answers
one question: given a policy, a proposed payment and the period's spent-so-far,
is it `allow`, `deny` or `escalate` to a human. Rails and signing live
elsewhere (flashyos-wdk is the reference rail); this repository holds the spec,
the JSON Schema, the vectors, a dependency-free checker and the evaluator.

## Commands

```bash
npm run lint   # node --check on every .mjs + house rules (no install)
npm test       # node --test test/*.test.mjs
node vendor-pay-policy.mjs check <policy.json>
node vendor-pay-policy.mjs attenuate <parent.json> <child.json>
node vendor-pay-policy.mjs evaluate <policy.json> <payment.json> [ledger.json]
```

## What makes this repository different

**Money is a whole number of minor units with a currency, everywhere.** A
figure is `{ minor, currency }`; `2500` is 25.00 in a two-decimal currency.
The checker refuses a float anywhere in a document, not only where money is
expected, and `parseJsonStrict` refuses `2500.0` in the *text* before
`JSON.parse` can round it to 2500. A string is not money either.

**A child policy only narrows.** `attenuate(parent, child)` refuses a wider
per-transaction cap, a wider period cap, a dropped period cap, a different
period (not comparable, so refused rather than converted), an added
counterparty, rail or jurisdiction, dropped jurisdictions, a higher human
gate, a changed currency, or a child that does not name its parent. Every
widened dimension is named.

**A policy that can spend carries a human gate.** `humanApprovalAbove` is
required whenever `perTransaction.minor > 0`, and it must be strictly below
the per-transaction cap — a gate no permitted payment can reach is a missing
gate. `0` escalates everything. A closed policy (cap 0) may omit it.

**The evaluator is pure.** `evaluate(policy, payment, ledgerState)` reads no
clock, opens nothing, mutates nothing. Spent-so-far is injected; when the
policy has a period cap and no ledger state is supplied, the answer is `deny`
(`LEDGER_STATE_MISSING`) — unknown is never zero. The test stubs `fetch` to
throw and `Date.now` to two different centuries, and the answers agree.

**Reasons are not optional.** `deny` and `escalate` always carry
`{ code, message }` reasons; `allow` carries none because it has nothing to
explain. Every failing check is named, not only the first.

**The mesh vocabulary is borrowed, not invented.** Per-transaction cap, period
cap, counterparty allowlist, an escalation threshold, `PER_TX_CAP`, byte-exact
matching and ALLOW/ESCALATE/DENY come from flashyos-wdk's `SpendEnvelope` and
`Verdict`. Names diverge only where the reference rail is rail-specific.

## Rules enforced by tests

- Every vector on disk is named in `vectors/index.json`; an orphan fails.
- The schema's key lists equal the checker's `SHAPE`; nested objects are
  closed; only `^x-` top-level extras; period enum equals `PERIODS`.
- Every `node vendor-pay-policy.mjs …` line in the README runs and exits 0.
- No `LICENSE` file; the README's last line is the licence line; both README
  and SPEC say `Status: draft`.
- `package.json` has no dependency fields at all; CI installs nothing.
- No brand name inside the format, the checker, or a vector.

## House rules — true in every repository in this estate
**`main` is not necessarily the default branch.** Ask, every time: `git symbolic-ref --short refs/remotes/origin/HEAD`.
**Say which branch you measured.** Reading the working tree tells you about your checkout, not the repository.
**Re-vendor before you trust a vendored change.** Files named `vendor-*.mjs` are byte-identical copies; a stale copy disagrees silently.
**No secret in a file, a repo, or an artifact.** Secret Manager only.
**The licence is declared once**, in `tools/estate-licences.mjs` in flashyos. Do not decide this repository's licence inside it.
**A generated file is regenerated, never hand-edited.**
**Report what happened, including when it is worse than expected.**
