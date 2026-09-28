# pay-policy/1

Status: draft. Contract string: `pay-policy/1`.

A vendor-neutral payment policy for an agent, and a pure evaluator over it.
The format answers one question — may this payment go, must it stop, or must a
person decide — and carries nothing that would let it answer any other. It
sits over any rail (a wallet SDK, x402, a stablecoin transfer, a card) and the
rail is told the answer; the rail settles and signs, this format never does.

Every number in a `pay-policy/1` document is a whole number of **minor
units** — `2500` is 25.00 in a two-decimal currency — beside an explicit
**currency code**. A float anywhere is a refusal.

## 1. The policy document

```json
{
  "contract": "pay-policy/1",
  "id": "policy/research-ops",
  "holder": "agent/research-ops",
  "parent": "policy/treasury",
  "currency": "USD",
  "limits": {
    "perTransaction": { "minor": 50000, "currency": "USD" },
    "perPeriod": { "period": "month", "cap": { "minor": 500000, "currency": "USD" } }
  },
  "allow": {
    "counterparties": ["merchant/acme-cloud", "merchant/example-data"],
    "rails": ["x402", "card"],
    "jurisdictions": ["US", "GB"]
  },
  "humanApprovalAbove": { "minor": 20000, "currency": "USD" },
  "x-anything": "extension keys are x- prefixed and ignored by the evaluator"
}
```

| Field | Required | Meaning |
|---|---|---|
| `contract` | yes | exactly `pay-policy/1` |
| `id` | yes | this policy's identifier, a non-empty string |
| `holder` | yes | who the policy binds; an opaque reference. Who may hold a policy, and how that is proven, is `delegation/1`'s question |
| `parent` | on a child | the `id` of the policy this one attenuates; `attenuate` refuses a child whose `parent` is not the parent's `id` |
| `currency` | yes | `^[A-Z][A-Z0-9]{2,11}$`; every `Money` in the document must carry this same code |
| `limits.perTransaction` | yes | `Money`; inclusive ceiling per payment. `0` **closes** the policy: it can pay nobody anything |
| `limits.perPeriod` | no | `{ period, cap }`; `period` ∈ `day` \| `week` \| `month` (a closed list); `cap` is `Money`, an inclusive ceiling on spent-so-far plus this payment |
| `allow.counterparties` | yes | list of unique non-empty strings, matched byte-exact; empty permits nobody; there is no wildcard |
| `allow.rails` | yes | list of unique opaque identifiers `^[a-z0-9][a-z0-9-]{0,63}$`; the format names no rail |
| `allow.jurisdictions` | no | list of unique `^[A-Z]{2}$` codes; absent means unrestricted, present means a payment naming none is denied |
| `humanApprovalAbove` | when spending | `Money`; a payment strictly above it escalates. `0` escalates everything. Required whenever `perTransaction.minor > 0`, and must be strictly below `perTransaction` |
| `x-*` | no | extensions, top level only, any value except a non-integer number |

Any other top-level key is refused. Every nested object is closed: no extra
keys, `x-` or not.

`Money` is `{ "minor": <integer>, "currency": "<CODE>" }` — `minor` a JSON
integer, `0 ≤ minor ≤ 2^53 − 1`; `currency` required and equal to the
document's currency. A `minor` that is a string, a float, negative, or beyond
the safe range is refused with its own code.

## 2. The payment request

```json
{
  "id": "pay_0001",
  "amount": { "minor": 2500, "currency": "USD" },
  "counterparty": "merchant/acme-cloud",
  "rail": "x402",
  "jurisdiction": "US",
  "reference": { "kind": "invoice", "id": "inv_2026_0917_0042", "hash": "9f86…a08" }
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | the rail's or agent's identifier for this proposed payment |
| `amount` | yes | `Money`. Its currency is compared to the policy's as a decision (`CURRENCY_MISMATCH`), not as a shape error |
| `counterparty` | yes | matched byte-exact against `allow.counterparties`; no case folding, no prefix match |
| `rail` | yes | matched exactly against `allow.rails` |
| `jurisdiction` | no | `^[A-Z]{2}$`; required in effect when the policy restricts jurisdictions |
| `reference` | no | `{ kind, id, hash? }` — an opaque pointer to a document another format governs (an invoice, a 402 challenge, a quote). `hash`, when present, is 64 lowercase hex. The evaluator reads none of it |
| `x-*` | no | extensions |

Any other key is refused (`PAYMENT_INVALID`).

## 3. The ledger state

```json
{ "period": "month", "spent": { "minor": 100000, "currency": "USD" } }
```

The caller's statement of what this policy's holder has already spent in the
current period, in the policy's currency. The evaluator **never fetches it
and never computes period boundaries** — which UTC day, ISO week or calendar
month "now" falls in is the ledger's business. `period` must equal the
policy's `perPeriod.period`; `spent` is `Money`. Extensions `x-*` are
permitted. When the policy has no `perPeriod`, `ledgerState` may be omitted
or `null` and is not read.

## 4. The decision algorithm

`evaluate(policy, payment, ledgerState) → { decision, reasons }` where
`decision` ∈ `allow` | `deny` | `escalate` and each reason is
`{ code, message }`.

1. **Policy.** `validate(policy)` must pass. Otherwise:
   `deny`, one reason `POLICY_INVALID` naming every error.
2. **Payment shape.** §2 must hold. Otherwise `deny`, one reason
   `PAYMENT_INVALID`.
3. **Checks.** Each of the following that fails **appends** a reason; all are
   run so a deny names everything wrong, in this order:
   - `CURRENCY_MISMATCH` — `payment.amount.currency ≠ policy.currency`
   - `INVALID_AMOUNT` — `payment.amount.minor = 0`
   - `RAIL_NOT_PERMITTED` — `payment.rail ∉ allow.rails`
   - `COUNTERPARTY_NOT_PERMITTED` — `payment.counterparty ∉ allow.counterparties`
   - `JURISDICTION_UNKNOWN` — policy restricts jurisdictions and the payment names none
   - `JURISDICTION_NOT_PERMITTED` — policy restricts jurisdictions and the payment's is not listed
   - `PER_TX_CAP` — `amount.minor > limits.perTransaction.minor`
   - when `limits.perPeriod` is present:
     - `LEDGER_STATE_MISSING` — no `ledgerState` supplied (unknown is not zero)
     - `LEDGER_STATE_INVALID` — §3 shape fails
     - `LEDGER_STATE_MISMATCH` — its `period` or `spent.currency` differs from the policy's
     - `PERIOD_CAP` — `spent.minor + amount.minor > perPeriod.cap.minor`
4. **Deny.** If any reason was appended: `{ decision: "deny", reasons }`.
5. **Grade.** If `amount.minor > humanApprovalAbove.minor`:
   `{ decision: "escalate", reasons: [HUMAN_APPROVAL_REQUIRED] }`.
6. **Allow.** `{ decision: "allow", reasons: [] }`.

Properties the suite holds:

- **Pure and deterministic.** Same three inputs, same output object; inputs
  are never mutated; no clock, no network, no environment is read.
- **`deny` and `escalate` always carry at least one reason.** `allow` never
  carries one — it is exactly what the policy said and nothing more.
- **`allow` never widens.** An `allow` implies: same currency, amount above 0,
  amount ≤ per-transaction cap, amount ≤ human gate, counterparty listed, rail
  listed, jurisdiction listed if restricted, and spent + amount ≤ period cap
  when one exists.
- **Escalation is not approval.** A payment above the gate is never `allow`.
  What a human does with an `escalate` is outside this format.
- Boundaries are inclusive on caps and on the gate: exactly at the cap is
  allowed, exactly at the gate is allowed; one minor unit over either is not.

## 5. Attenuation

`attenuate(parent, child) → { valid, errors }`. A child may only **narrow**
its parent. Both documents must validate first (errors are reported with a
`PARENT_` or `CHILD_` prefix and nothing further is compared). Then every one
of the following is checked and every failure named:

| Dimension | Rule | Code on failure |
|---|---|---|
| lineage | `child.parent = parent.id` | `PARENT_MISMATCH` |
| currency | equal | `CURRENCY_MISMATCH` |
| `perTransaction` | child ≤ parent | `WIDENED_PER_TRANSACTION` |
| `perPeriod` | parent has one ⇒ child has one | `DROPPED_PERIOD_CAP` |
| `perPeriod.period` | equal when both present (a different period is not comparable and is refused, never converted) | `PERIOD_MISMATCH` |
| `perPeriod.cap` | child ≤ parent | `WIDENED_PERIOD_CAP` |
| `counterparties` | child ⊆ parent | `WIDENED_COUNTERPARTIES` |
| `rails` | child ⊆ parent | `WIDENED_RAILS` |
| `jurisdictions` | parent restricts ⇒ child restricts | `DROPPED_JURISDICTIONS` |
| `jurisdictions` | child ⊆ parent when both present | `WIDENED_JURISDICTIONS` |
| `humanApprovalAbove` | for a spending child, child ≤ parent (a closed parent's gate reads as 0) | `WIDENED_HUMAN_GATE` |

A child may add a restriction the parent lacks (a period cap, a jurisdiction
list). A closed child (`perTransaction` 0) is the narrowest possible child and
carries no gate to compare. Attenuation is a check, not a transform: it
produces no document.

## 6. Refusals

`validate(policy)` refuses, each with a code and a JSON path:

| Code | When |
|---|---|
| `NOT_AN_OBJECT` | the input is not a JSON object |
| `CONTRACT` | `contract` is not exactly `pay-policy/1` |
| `UNKNOWN_KEY` | a top-level key that is not a field and not `x-` prefixed; any extra key in a nested object |
| `FLOAT` | a non-integer number anywhere in the document |
| `FLOAT_MONEY` | a non-integer `minor` |
| `NOT_INTEGER` | a `minor` that is not a JSON number (a string, for instance) |
| `NEGATIVE_MONEY` | `minor < 0` |
| `UNSAFE_INTEGER` | `minor > 2^53 − 1` |
| `MISSING_MINOR`, `MONEY_SHAPE` | a `Money` without `minor`, or not an object |
| `MISSING_CURRENCY` | no `currency` on the policy, or on any `Money` |
| `BAD_CURRENCY` | a currency not matching `^[A-Z][A-Z0-9]{2,11}$` |
| `CURRENCY_MISMATCH` | a `Money` whose currency differs from the policy's |
| `MISSING_FIELD`, `BAD_FIELD` | a required field absent, or of the wrong shape |
| `BAD_PERIOD` | a period not in `day`, `week`, `month` |
| `NOT_A_LIST`, `BAD_ENTRY`, `DUPLICATE_ENTRY` | allowlist shape faults |
| `NO_HUMAN_GATE` | `perTransaction.minor > 0` and no `humanApprovalAbove` |
| `HUMAN_GATE_UNREACHABLE` | `humanApprovalAbove ≥ perTransaction` on a spending policy |

The CLI additionally refuses, before parsing, any numeric literal in the file
text with a fraction or exponent (`2500.0`, `25e2`) — `JSON.parse` would
round both to an integer and the refusal would be lost.

## 7. What version 1 does not carry

- **No settlement.** The evaluator answers; it reserves nothing, commits
  nothing, releases nothing. Two-phase budget accounting (reserve at
  authorisation, commit on confirmation, release on revert) is the ledger's,
  and `ledgerState.spent` is whatever that ledger says counts.
- **No signing, no keys, no authorisation object.** A rail that wants a
  signed statement that a decision was taken wraps the decision itself.
- **No invoices, no receipts, no challenges.** A payment may `reference` one
  by `{ kind, id, hash }` and the evaluator does not read it. The shapes of
  those documents belong to the rail or to a sibling format.
- **No period-boundary arithmetic.** Which day, week or month "now" is in, and
  what has been spent in it, arrives as `ledgerState`.
- **No identity, no proof of holding.** `holder` is a string. Whether the
  caller is that holder, and whether the parent really delegated, is
  `delegation/1`'s question.
- **No exchange rates.** A payment in another currency is a deny, not a
  conversion. A policy is in one currency; hold two policies for two.
- **No wildcards, no patterns, no prefixes** in any allowlist. Byte-exact
  or not listed.
- **No rail vocabulary.** Rails are opaque identifiers; nothing here knows
  what `x402` or `card` means.
