# agentpay — `pay-policy/1`

<img src="brand/assets/bolt-gold.svg" width="48" alt="">

agentpay is `pay-policy/1`: a vendor-neutral payment-policy format and a pure
allow / deny / escalate evaluator for agents that spend, written for the people
who build the rails, the wallets and the sub-agents that hold a policy — it is
not another wallet. It sits over any rail (a wallet SDK, x402, a stablecoin
transfer, a card) and answers one question: given a policy and a proposed
payment, may it go, must it stop, or must a person decide. The rails and the
signing live elsewhere; this repository holds the spec, the JSON Schema, the
vectors, a dependency-free checker and the evaluator.

## Quick start

Node 22. Nothing to install.

```
node vendor-pay-policy.mjs check vectors/monthly-cap-valid.json
node vendor-pay-policy.mjs evaluate vectors/monthly-cap-valid.json vectors/payments/above-human-gate.json vectors/ledgers/month-100000.json
npm test
```

The first prints

```json
{
  "valid": true,
  "errors": []
}
```

The second prints

```json
{
  "decision": "escalate",
  "reasons": [
    {
      "code": "HUMAN_APPROVAL_REQUIRED",
      "message": "30000 is above the human-approval threshold of 20000 USD minor units; a person must approve"
    }
  ]
}
```

because 300.00 is within the 500.00 per-transaction cap and the 5,000.00
monthly cap, and above the 200.00 line the policy's owner drew for a human.
Swap in `vectors/payments/within-cap.json` for an `allow`, or
`vectors/ledgers/month-498000.json` for a `deny` on the exhausted month.

As a module:

```js
import { validate, attenuate, evaluate } from './vendor-pay-policy.mjs';
validate(policy);                        // → { valid, errors: [{ code, path, message }] }
attenuate(parent, child);                // → { valid, errors }   child may only narrow
evaluate(policy, payment, ledgerState);  // → { decision: 'allow'|'deny'|'escalate', reasons: [{ code, message }] }
```

## What makes it different

**Minor units only.** Every figure is `{ "minor": 2500, "currency": "USD" }`
— a whole number of minor units beside an explicit currency. A float anywhere
in a policy, a payment or a ledger state is refused; a figure with no currency
is not money; a string is not an integer. The CLI refuses `2500.0` in the file
text before `JSON.parse` can quietly round it to `2500`.

**Narrowing only.** A policy can be attenuated for a sub-agent, and the child
may only narrow: caps ≤, allowlists ⊆, rails ⊆, jurisdictions ⊆, human gate
≤, same currency, same period. `attenuate(parent, child)` refuses any widening
and names every widened dimension.

**A human gate on money is mandatory.** Any policy whose per-transaction cap is
above zero must carry `humanApprovalAbove`, and it must be strictly below that
cap — a gate no permitted payment can reach is a missing gate. Uniform gates
are theatre; a missing gate on money is a bug. `0` escalates everything; a
closed policy (cap `0`) may omit the gate because it can pay nobody anything.

**A pure evaluator.** `evaluate(policy, payment, ledgerState)` reads no clock,
opens no connection, mutates nothing. The period's spent-so-far is *injected*
as `ledgerState`, never fetched — and when the policy caps a period and no
ledger state is supplied, the answer is `deny`, because unknown is not zero.

**allow / deny / escalate, with reasons.** `deny` and `escalate` always carry
`{ code, message }` reasons, and every failing check is named rather than only
the first. `allow` carries none and never widens beyond what the policy says:
a payment above the human threshold is `escalate`, never `allow`.

Invoices, receipts and payment challenges are **out of scope for version 1**:
a payment may `reference` one by `{ kind, id, hash }`, and the evaluator does
not read it. See `SPEC.md` §7.

## Layout

| Path | What it is |
|---|---|
| `SPEC.md` | `pay-policy/1`: the policy, payment and ledger-state shapes, the decision algorithm, attenuation, refusals, and what v1 does not carry |
| `schema/pay-policy-1.json` | JSON Schema 2020-12 for the policy document; integers for money, `x-` extras only |
| `vendor-pay-policy.mjs` | `validate`, `attenuate`, `evaluate`, and the CLI — `node:` builtins only, meant to be vendored byte-identical |
| `vectors/` | valid and invalid policies, attenuation pairs, payments, ledger states; `vectors/index.json` records what each is expected to do |
| `test/pay-policy.test.mjs` | `node --test`: every vector, every rule, determinism, the CLI, the schema against the checker, and every README command |
| `scripts/lint.mjs` | `node --check` on every `.mjs` plus the house rules, with nothing installed |
| `.github/` | CI (lint + test, no install), issue and pull request templates |

## Links

- **Reference rail:** [flashyos-wdk](https://github.com/FlashyLabs/flashyos-wdk)
  — the wallet stack this format's vocabulary was read from: its
  `SpendEnvelope` (`perTxMax`, `dailyMax`, `autoApproveMax`, exact-match
  `destinations`), its ALLOW / ESCALATE / DENY verdicts and its integer
  base-unit amounts. `pay-policy/1` is the rail-neutral policy layer over it;
  the envelope, the signer and the settlement stay there.
- **Sibling standards, by name:** `delegation/1` (who holds a policy, and how
  a parent's delegation to a child is proven — this format only checks that a
  child narrows), `intent/1` (what an agent is trying to do, which a payment
  serves), `ritual/1` (the human-approval step an `escalate` hands off to),
  `aao/0.1` (the organisation charter a policy holder is accountable under).
  None is a dependency; the evaluator knows nothing of them.

## Where it sits in the stack

`pay-policy/1` is layer 8 of [Web 4](https://github.com/FlashyLabs/web4), the estate's stack of open protocols for the agentic internet — the **"How does value move?"** layer, the rail-neutral policy over any wallet or rail. This repository carries the same **institutional front door** every protocol in the stack serves: `site/` is generated by one dependency-free, config-driven script (`scripts/build-site.mjs`), vendored byte-identical from the [web4](https://github.com/FlashyLabs/web4) hub and driven by this repository's own `site.config.json` (contract `site-config/1`, `schema/site-config-1.json`). It renders the nine-layer table from the served `.well-known/stack.json` copy and serves the mesh surfaces — the `flashyos/1` handshake, the AAO charter, and this org's `directory/1` node — all derived from `flashyos.roles.json` so they cannot disagree.

```bash
node scripts/build-site.mjs   # regenerate site/ from site.config.json + the vendored inputs
```

"Committed is not served": the authoritative check runs against the live domain after deploy (`npx @flashyos/conformance <domain> --level 2`). `vercel.json` sets the output directory to `site` with no framework; the canonical base is `https://flashylabs.github.io/agentpay/` until the property has its own domain.

Status: draft; the institutional front door was generated 2026-09-29. No adopter yet; nothing here has settled a real payment, and the format is not published as a standard.

Licensed under Apache-2.0 (holder Flashy Labs); the estate register in flashyos `tools/estate-licences.mjs` is the authority.
