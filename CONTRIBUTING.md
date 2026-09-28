# Contributing

This repository is a specification and its reference checker. Contributions
are welcome where they make a rule more precise, a refusal more honest, or a
vector cover a case that was not covered. Contributions that make the format
more permissive are read with the presumption that they are wrong.

## Before you start

```bash
node -v            # 22 or later
npm run lint       # syntax-checks every .mjs and holds the house rules
npm test           # every vector, every rule, every README claim
```

Nothing is installed. If a change needs a dependency, it does not belong
here — the whole argument of this repository is that a policy checker a rail
embeds must carry nothing a rail did not ask for.

## What a change needs

- **A vector.** A rule with no vector that fails without it is prose. Add the
  file under `vectors/` and name it in `vectors/index.json`; the suite fails
  on a vector nothing exercises.
- **Agreement in three places.** `SPEC.md` says the rule, `schema/pay-policy-1.json`
  holds what a schema can hold, and `vendor-pay-policy.mjs` holds the rest.
  The schema test compares key lists across the two files; keep them equal.
- **Whole minor units.** Nothing here ever carries a decimal. A vector with a
  float in it is the bug, not the fixture.
- **No brand inside the format.** Rails are opaque lowercase identifiers;
  counterparties are opaque strings. The README may name a reference rail;
  the format and the vectors may not.
- **Vendor-neutral, stage-neutral.** The evaluator takes a policy, a payment
  and a ledger state, and answers. It never learns where the money is.

## Versioning

`pay-policy/1` is additive: a change that leaves every existing valid vector
valid and every invalid one invalid can land in `/1`. A change that flips
either needs `pay-policy/2` and a decision, not a pull request.

## Conduct and security

`CODE_OF_CONDUCT.md` applies. A finding that lets a policy validate when it
should not, or the evaluator allow what a policy refuses, is a security
finding: `SECURITY.md`, not a public issue.
