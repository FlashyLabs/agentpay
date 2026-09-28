## What this changes

<!-- One or two sentences. Which surface: spec, schema, checker, evaluator, vectors, docs. -->

## Why

<!-- The real policy or payment this was written against. -->

## Checklist

- [ ] `npm run lint` and `npm test` pass with nothing installed
- [ ] Every new rule has a vector that fails without it, named in `vectors/index.json`
- [ ] SPEC.md, `schema/pay-policy-1.json` and `vendor-pay-policy.mjs` still agree (the schema test compares their key lists)
- [ ] No float, no missing currency, no brand name inside the format or a vector
- [ ] No invariant weakened: minor units, narrowing only, mandatory human gate, pure evaluator, reasons on deny/escalate
- [ ] README and SPEC still describe what the code does
