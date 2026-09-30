// pay-policy/1 — every vector, every rule, and the properties the README claims.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTRACT, DECISIONS, PERIODS, SHAPE, attenuate, evaluate, parseJsonStrict, permitsSpending, validate } from '../vendor-pay-policy.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VECTORS = join(ROOT, 'vectors');
const CLI = join(ROOT, 'vendor-pay-policy.mjs');

const readJson = (rel) => JSON.parse(readFileSync(join(VECTORS, rel), 'utf8'));
const vector = (rel) => structuredClone(readJson(rel));
const index = readJson('index.json');
const codesOf = (list) => list.map((e) => e.code);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// ─── The manifest covers the directory ───────────────────────────────────────

test('every vector on disk is named in vectors/index.json', () => {
  const onDisk = walk(VECTORS).map((p) => relative(VECTORS, p)).filter((p) => p !== 'index.json').sort();
  const named = new Set([
    ...index.policies.map((p) => p.file),
    ...index.attenuations.flatMap((a) => [a.parent, a.child]),
    ...index.scenarios.flatMap((s) => [s.policy, s.payment, s.ledger].filter(Boolean)),
  ]);
  const orphans = onDisk.filter((f) => !named.has(f));
  assert.deepEqual(orphans, [], `vectors nothing exercises: ${orphans.join(', ')}`);
  for (const f of named) assert.ok(existsSync(join(VECTORS, f)), `index.json names a missing file: ${f}`);
});

test('the manifest carries at least the required counts', () => {
  assert.ok(index.policies.filter((p) => p.expect === 'valid').length >= 3);
  assert.ok(index.policies.filter((p) => p.expect === 'invalid').length >= 6);
  assert.ok(index.scenarios.length >= 4);
  for (const kind of ['FLOAT_MONEY', 'MISSING_CURRENCY', 'NO_HUMAN_GATE', 'UNKNOWN_KEY', 'BAD_PERIOD']) {
    assert.ok(index.policies.some((p) => p.codes?.includes(kind)), `no policy vector for ${kind}`);
  }
  for (const kind of ['WIDENED_PER_TRANSACTION', 'WIDENED_COUNTERPARTIES', 'WIDENED_RAILS', 'WIDENED_PERIOD_CAP', 'WIDENED_JURISDICTIONS', 'WIDENED_HUMAN_GATE']) {
    assert.ok(index.attenuations.some((a) => a.codes?.includes(kind)), `no attenuation vector for ${kind}`);
  }
  for (const [decision, code] of [['allow', null], ['deny', 'PER_TX_CAP'], ['deny', 'COUNTERPARTY_NOT_PERMITTED'], ['escalate', 'HUMAN_APPROVAL_REQUIRED'], ['deny', 'PERIOD_CAP']]) {
    assert.ok(index.scenarios.some((s) => s.expect.decision === decision && (code === null || s.expect.codes.includes(code))), `no scenario for ${decision} ${code ?? ''}`);
  }
});

// ─── Policy vectors ──────────────────────────────────────────────────────────

for (const entry of index.policies) {
  test(`policy vector ${entry.file} is ${entry.expect}`, () => {
    const result = validate(vector(entry.file));
    assert.equal(result.valid, entry.expect === 'valid', JSON.stringify(result.errors, null, 2));
    if (entry.expect === 'valid') assert.deepEqual(result.errors, []);
    else {
      const got = codesOf(result.errors);
      for (const code of entry.codes) assert.ok(got.includes(code), `expected ${code} in ${got.join(', ')}`);
      for (const e of result.errors) assert.ok(e.code && e.path && e.message, 'every error carries code, path and message');
    }
  });
}

// ─── Attenuation vectors ─────────────────────────────────────────────────────

for (const entry of index.attenuations) {
  test(`attenuation ${entry.parent} → ${entry.child} is ${entry.expect}`, () => {
    const result = attenuate(vector(entry.parent), vector(entry.child));
    assert.equal(result.valid, entry.expect === 'valid', JSON.stringify(result.errors, null, 2));
    if (entry.expect === 'invalid') {
      const got = codesOf(result.errors);
      for (const code of entry.codes) assert.ok(got.includes(code), `expected ${code} in ${got.join(', ')}`);
    }
  });
}

// ─── Evaluate scenarios ──────────────────────────────────────────────────────

for (const s of index.scenarios) {
  test(`scenario: ${s.name}`, () => {
    const policy = vector(s.policy);
    const payment = vector(s.payment);
    const ledger = s.ledger ? vector(s.ledger) : null;
    const result = evaluate(policy, payment, ledger);
    assert.equal(result.decision, s.expect.decision, JSON.stringify(result, null, 2));
    assert.deepEqual(codesOf(result.reasons), s.expect.codes);
    assert.ok(DECISIONS.includes(result.decision));
  });
}

test('deny and escalate always carry reasons; allow never does', () => {
  for (const s of index.scenarios) {
    const result = evaluate(vector(s.policy), vector(s.payment), s.ledger ? vector(s.ledger) : null);
    if (result.decision === 'allow') assert.deepEqual(result.reasons, []);
    else {
      assert.ok(result.reasons.length > 0, `${s.name}: ${result.decision} with no reasons`);
      for (const r of result.reasons) assert.ok(r.code && r.message, 'every reason carries code and message');
    }
  }
});

test('allow never widens beyond what the policy says', () => {
  const allowed = index.scenarios.filter((s) => s.expect.decision === 'allow');
  assert.ok(allowed.length > 0);
  for (const s of allowed) {
    const policy = vector(s.policy);
    const payment = vector(s.payment);
    const ledger = s.ledger ? vector(s.ledger) : null;
    assert.equal(evaluate(policy, payment, ledger).decision, 'allow');
    assert.equal(payment.amount.currency, policy.currency);
    assert.ok(payment.amount.minor > 0);
    assert.ok(payment.amount.minor <= policy.limits.perTransaction.minor);
    assert.ok(payment.amount.minor <= policy.humanApprovalAbove.minor);
    assert.ok(policy.allow.counterparties.includes(payment.counterparty));
    assert.ok(policy.allow.rails.includes(payment.rail));
    if (policy.limits.perPeriod) {
      assert.ok(ledger, 'an allow against a period cap had a ledgerState');
      assert.ok(ledger.spent.minor + payment.amount.minor <= policy.limits.perPeriod.cap.minor);
    }
  }
});

// ─── Unit tests, one per rule ────────────────────────────────────────────────

const base = () => vector('monthly-cap-valid.json');

test('rule: a float anywhere in the policy is refused, not only where money is expected', () => {
  const p = base();
  p['x-weight'] = 0.5;
  const r = validate(p);
  assert.equal(r.valid, false);
  assert.ok(codesOf(r.errors).includes('FLOAT'));
});

test('rule: a float in a money figure is FLOAT_MONEY', () => {
  const p = base();
  p.humanApprovalAbove.minor = 199.99;
  assert.ok(codesOf(validate(p).errors).includes('FLOAT_MONEY'));
});

test('rule: money is a JSON integer, never a string, bigint-looking or otherwise', () => {
  const p = base();
  p.limits.perPeriod.cap.minor = '500000';
  assert.ok(codesOf(validate(p).errors).includes('NOT_INTEGER'));
});

test('rule: money above 2^53-1 is refused rather than rounded', () => {
  const p = base();
  p.limits.perPeriod.cap.minor = 9007199254740992;
  assert.ok(codesOf(validate(p).errors).includes('UNSAFE_INTEGER'));
});

test('rule: a missing currency is refused on the policy and on every figure', () => {
  const p = base();
  delete p.currency;
  assert.ok(codesOf(validate(p).errors).includes('MISSING_CURRENCY'));
  const q = base();
  delete q.humanApprovalAbove.currency;
  const r = validate(q);
  assert.ok(codesOf(r.errors).includes('MISSING_CURRENCY'));
  assert.ok(r.errors.some((e) => e.path === '$.humanApprovalAbove.currency'));
});

test('rule: every figure shares the policy currency', () => {
  const p = base();
  p.limits.perTransaction.currency = 'EUR';
  assert.ok(codesOf(validate(p).errors).includes('CURRENCY_MISMATCH'));
});

test('rule: a spending policy with no human gate is refused; a closed one may omit it', () => {
  const p = base();
  delete p.humanApprovalAbove;
  assert.ok(codesOf(validate(p).errors).includes('NO_HUMAN_GATE'));
  assert.equal(permitsSpending(p), true);
  const closed = vector('closed-no-spend-valid.json');
  assert.equal(permitsSpending(closed), false);
  assert.equal(validate(closed).valid, true);
});

test('rule: a human gate at or above the per-transaction cap is unreachable and refused', () => {
  const p = base();
  p.humanApprovalAbove.minor = p.limits.perTransaction.minor;
  assert.ok(codesOf(validate(p).errors).includes('HUMAN_GATE_UNREACHABLE'));
  p.humanApprovalAbove.minor = p.limits.perTransaction.minor - 1;
  assert.equal(validate(p).valid, true);
  p.humanApprovalAbove.minor = 0;
  assert.equal(validate(p).valid, true, 'a gate of 0 escalates everything and is valid');
});

test('rule: unknown top-level keys are refused unless x- prefixed', () => {
  const p = base();
  p.merchants = [];
  const r = validate(p);
  assert.ok(codesOf(r.errors).includes('UNKNOWN_KEY'));
  assert.ok(r.errors.some((e) => e.path === '$.merchants'));
  const q = base();
  q['x-owner-note'] = 'anything';
  assert.equal(validate(q).valid, true);
});

test('rule: unknown keys inside nested objects are refused, x- or not', () => {
  const p = base();
  p.limits['x-extra'] = 1;
  assert.ok(codesOf(validate(p).errors).includes('UNKNOWN_KEY'));
  const q = base();
  q.allow.merchants = [];
  assert.ok(codesOf(validate(q).errors).includes('UNKNOWN_KEY'));
});

test('rule: the period is one of a closed list', () => {
  assert.deepEqual([...PERIODS], ['day', 'week', 'month']);
  for (const bad of ['fortnight', 'year', 'Month', 'quarter', '', 30]) {
    const p = base();
    p.limits.perPeriod.period = bad;
    assert.ok(codesOf(validate(p).errors).includes('BAD_PERIOD'), `${bad} accepted`);
  }
  for (const good of PERIODS) {
    const p = base();
    p.limits.perPeriod.period = good;
    assert.equal(validate(p).valid, true);
  }
});

test('rule: the contract string is exact', () => {
  const p = base();
  p.contract = 'pay-policy/1.0';
  assert.ok(codesOf(validate(p).errors).includes('CONTRACT'));
  assert.equal(CONTRACT, 'pay-policy/1');
});

test('rule: negative money is refused', () => {
  const p = base();
  p.humanApprovalAbove.minor = -5;
  assert.ok(codesOf(validate(p).errors).includes('NEGATIVE_MONEY'));
});

test('rule: allowlists are lists of unique non-empty strings; rails lowercase; jurisdictions two uppercase letters', () => {
  const p = base();
  p.allow.counterparties = ['merchant/a', 'merchant/a'];
  assert.ok(codesOf(validate(p).errors).includes('DUPLICATE_ENTRY'));
  const q = base();
  q.allow.rails = ['X402'];
  assert.ok(codesOf(validate(q).errors).includes('BAD_ENTRY'));
  const r = base();
  r.allow.jurisdictions = ['usa'];
  assert.ok(codesOf(validate(r).errors).includes('BAD_ENTRY'));
  const s = base();
  s.allow.counterparties = 'merchant/a';
  assert.ok(codesOf(validate(s).errors).includes('NOT_A_LIST'));
});

test('rule: a non-object is refused outright', () => {
  for (const bad of [null, 'policy', 42, [], undefined]) {
    const r = validate(bad);
    assert.equal(r.valid, false);
    assert.equal(r.errors[0].code, 'NOT_AN_OBJECT');
  }
});

// ─── Attenuation, dimension by dimension ─────────────────────────────────────

const parent = () => vector('parent-valid.json');
const child = () => vector('child-narrowed-valid.json');

test('attenuation: equal on every dimension is a valid (if pointless) child', () => {
  const c = parent();
  c.id = 'policy/treasury/twin';
  c.parent = 'policy/treasury';
  assert.equal(attenuate(parent(), c).valid, true);
});

test('attenuation: each widened dimension is named, and several at once are all named', () => {
  const c = child();
  c.limits.perTransaction.minor = 100001;
  c.limits.perPeriod.cap.minor = 1000001;
  c.allow.counterparties.push('merchant/unknown-vendor');
  c.allow.rails.push('bank');
  c.allow.jurisdictions.push('FR');
  c.humanApprovalAbove.minor = 50001;
  const got = codesOf(attenuate(parent(), c).errors);
  for (const code of ['WIDENED_PER_TRANSACTION', 'WIDENED_PERIOD_CAP', 'WIDENED_COUNTERPARTIES', 'WIDENED_RAILS', 'WIDENED_JURISDICTIONS', 'WIDENED_HUMAN_GATE']) {
    assert.ok(got.includes(code), `${code} missing from ${got.join(', ')}`);
  }
});

test('attenuation: a child may add a period cap the parent lacks, and may add jurisdictions the parent does not restrict', () => {
  const p = parent();
  delete p.limits.perPeriod;
  delete p.allow.jurisdictions;
  assert.equal(validate(p).valid, true);
  assert.equal(attenuate(p, child()).valid, true);
});

test('attenuation: a child may not drop a restriction the parent carries', () => {
  const c = child();
  delete c.limits.perPeriod;
  delete c.allow.jurisdictions;
  const got = codesOf(attenuate(parent(), c).errors);
  assert.ok(got.includes('DROPPED_PERIOD_CAP'));
  assert.ok(got.includes('DROPPED_JURISDICTIONS'));
});

test('attenuation: a closed child is the narrowest child and carries no gate', () => {
  const c = child();
  c.limits.perTransaction.minor = 0;
  delete c.humanApprovalAbove;
  assert.equal(attenuate(parent(), c).valid, true);
});

test('attenuation: a child in another currency is refused', () => {
  const c = child();
  c.currency = 'EUR';
  for (const m of [c.limits.perTransaction, c.limits.perPeriod.cap, c.humanApprovalAbove]) m.currency = 'EUR';
  assert.equal(validate(c).valid, true);
  assert.ok(codesOf(attenuate(parent(), c).errors).includes('CURRENCY_MISMATCH'));
});

test('attenuation: an invalid parent or child is reported with a prefixed code and nothing else is compared', () => {
  const p = parent();
  delete p.humanApprovalAbove;
  const r = attenuate(p, child());
  assert.ok(codesOf(r.errors).includes('PARENT_NO_HUMAN_GATE'));
  assert.ok(r.errors.every((e) => e.code.startsWith('PARENT_')));
  const c = child();
  c.limits.perTransaction.minor = 1.5;
  assert.ok(codesOf(attenuate(parent(), c).errors).includes('CHILD_FLOAT_MONEY'));
});

// ─── Evaluator properties ────────────────────────────────────────────────────

function deepFreeze(v) {
  if (v && typeof v === 'object') {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

test('evaluate is deterministic and side-effect free', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the evaluator reached for the network'); };
  try {
    for (const s of index.scenarios) {
      const policy = deepFreeze(vector(s.policy));
      const payment = deepFreeze(vector(s.payment));
      const ledger = s.ledger ? deepFreeze(vector(s.ledger)) : null;
      const before = JSON.stringify([policy, payment, ledger]);
      const first = evaluate(policy, payment, ledger);
      const second = evaluate(policy, payment, ledger);
      assert.deepEqual(first, second, `${s.name}: two evaluations disagreed`);
      assert.equal(JSON.stringify([policy, payment, ledger]), before, `${s.name}: an input was mutated`);
      assert.notEqual(first, second, 'each call returns a fresh object');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('evaluate takes no clock: the same inputs answer the same at any time', () => {
  const originalNow = Date.now;
  const s = index.scenarios[0];
  const args = [vector(s.policy), vector(s.payment), s.ledger ? vector(s.ledger) : null];
  Date.now = () => 0;
  const early = evaluate(...args);
  Date.now = () => 4102444800000;
  const late = evaluate(...args);
  Date.now = originalNow;
  assert.deepEqual(early, late);
});

test('evaluate: an invalid policy is a deny with POLICY_INVALID, never an allow', () => {
  const p = base();
  delete p.humanApprovalAbove;
  const r = evaluate(p, vector('payments/within-cap.json'), vector('ledgers/month-100000.json'));
  assert.equal(r.decision, 'deny');
  assert.deepEqual(codesOf(r.reasons), ['POLICY_INVALID']);
});

test('evaluate: a payment carrying an unknown key is refused; an x- key is not', () => {
  const pay = vector('payments/within-cap.json');
  pay.memo = 'hello';
  assert.deepEqual(codesOf(evaluate(base(), pay, vector('ledgers/month-100000.json')).reasons), ['PAYMENT_INVALID']);
  const ok = vector('payments/within-cap.json');
  ok['x-trace'] = 'abc';
  assert.equal(evaluate(base(), ok, vector('ledgers/month-100000.json')).decision, 'allow');
});

test('evaluate: at the human gate exactly is allow; one minor unit above is escalate', () => {
  const p = base();
  const pay = vector('payments/within-cap.json');
  const ledger = vector('ledgers/month-100000.json');
  pay.amount.minor = p.humanApprovalAbove.minor;
  assert.equal(evaluate(p, pay, ledger).decision, 'allow');
  pay.amount.minor = p.humanApprovalAbove.minor + 1;
  assert.equal(evaluate(p, pay, ledger).decision, 'escalate');
});

test('evaluate: at the period cap exactly is allow; one minor unit over is deny', () => {
  const p = base();
  const pay = vector('payments/within-cap.json');
  const ledger = vector('ledgers/month-100000.json');
  ledger.spent.minor = p.limits.perPeriod.cap.minor - pay.amount.minor;
  assert.equal(evaluate(p, pay, ledger).decision, 'allow');
  ledger.spent.minor += 1;
  assert.deepEqual(codesOf(evaluate(p, pay, ledger).reasons), ['PERIOD_CAP']);
});

test('evaluate: a ledgerState in another currency, or malformed, is a deny', () => {
  const p = base();
  const pay = vector('payments/within-cap.json');
  const eur = vector('ledgers/month-100000.json');
  eur.spent.currency = 'EUR';
  assert.deepEqual(codesOf(evaluate(p, pay, eur).reasons), ['LEDGER_STATE_MISMATCH']);
  const broken = vector('ledgers/month-100000.json');
  broken.spent.minor = 12.5;
  assert.deepEqual(codesOf(evaluate(p, pay, broken).reasons), ['LEDGER_STATE_INVALID']);
});

test('evaluate: a policy with no period cap needs no ledgerState', () => {
  const p = base();
  delete p.limits.perPeriod;
  assert.equal(evaluate(p, vector('payments/within-cap.json')).decision, 'allow');
});

test('evaluate: counterparties match byte-exact; no case folding, no prefix match', () => {
  const p = base();
  const pay = vector('payments/within-cap.json');
  const ledger = vector('ledgers/month-100000.json');
  pay.counterparty = 'merchant/Acme-Cloud';
  assert.deepEqual(codesOf(evaluate(p, pay, ledger).reasons), ['COUNTERPARTY_NOT_PERMITTED']);
  pay.counterparty = 'merchant/acme-cloud/sub';
  assert.deepEqual(codesOf(evaluate(p, pay, ledger).reasons), ['COUNTERPARTY_NOT_PERMITTED']);
});

// ─── Strict JSON text ────────────────────────────────────────────────────────

test('parseJsonStrict refuses fractional and exponent literals JSON.parse would round', () => {
  assert.throws(() => parseJsonStrict('{"minor": 2500.0}'), /non-integer numeric literal 2500\.0/);
  assert.throws(() => parseJsonStrict('{"minor": 25e2}'), /25e2/);
  assert.throws(() => parseJsonStrict('{"minor": -1.5}'), /-1\.5/);
  assert.deepEqual(parseJsonStrict('{"minor": 2500, "note": "2.5 in a string is text, not money"}'), { minor: 2500, note: '2.5 in a string is text, not money' });
  assert.deepEqual(parseJsonStrict('{"s": "esc\\"aped 1.0", "n": 1}'), { s: 'esc"aped 1.0', n: 1 });
});

// ─── The CLI ─────────────────────────────────────────────────────────────────

test('cli: check exits 0 on a valid policy and 1 on an invalid one, printing the result', () => {
  const ok = run(['check', 'vectors/monthly-cap-valid.json']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).valid, true);
  const bad = run(['check', 'vectors/no-human-gate-invalid.json']);
  assert.equal(bad.status, 1);
  assert.ok(codesOf(JSON.parse(bad.stdout).errors).includes('NO_HUMAN_GATE'));
});

test('cli: evaluate prints the decision and exits 0 for allow, deny and escalate alike', () => {
  const allow = run(['evaluate', 'vectors/monthly-cap-valid.json', 'vectors/payments/within-cap.json', 'vectors/ledgers/month-100000.json']);
  assert.equal(allow.status, 0, allow.stderr);
  assert.equal(JSON.parse(allow.stdout).decision, 'allow');
  const deny = run(['evaluate', 'vectors/monthly-cap-valid.json', 'vectors/payments/over-per-tx.json', 'vectors/ledgers/month-100000.json']);
  assert.equal(deny.status, 0);
  assert.equal(JSON.parse(deny.stdout).decision, 'deny');
  const esc = run(['evaluate', 'vectors/monthly-cap-valid.json', 'vectors/payments/above-human-gate.json', 'vectors/ledgers/month-100000.json']);
  assert.equal(esc.status, 0);
  assert.equal(JSON.parse(esc.stdout).decision, 'escalate');
});

test('cli: evaluate exits 1 on an invalid policy, an invalid payment, or a missing file', () => {
  const badPolicy = run(['evaluate', 'vectors/no-human-gate-invalid.json', 'vectors/payments/within-cap.json', 'vectors/ledgers/month-100000.json']);
  assert.equal(badPolicy.status, 1);
  assert.equal(JSON.parse(badPolicy.stdout).decision, 'deny');
  assert.deepEqual(codesOf(JSON.parse(badPolicy.stdout).reasons), ['POLICY_INVALID']);
  const floatPolicy = run(['evaluate', 'vectors/float-money-invalid.json', 'vectors/payments/within-cap.json', 'vectors/ledgers/month-100000.json']);
  assert.equal(floatPolicy.status, 1);
  assert.match(floatPolicy.stderr, /non-integer numeric literal 500\.5/);
  // The float payment vector is refused at the text stage, before it can parse: exit 1, nothing decided.
  const floatPay = run(['evaluate', 'vectors/monthly-cap-valid.json', 'vectors/payments/float-invalid.json', 'vectors/ledgers/month-100000.json']);
  assert.equal(floatPay.status, 1);
  assert.match(floatPay.stderr, /non-integer numeric literal 25\.5/);
  // A payment that parses but fails shape (an unknown key) is a deny with PAYMENT_INVALID, and still exit 1.
  const dir = mkdtempSync(join(tmpdir(), 'pay-policy-'));
  const unknownKey = join(dir, 'payment.json');
  writeFileSync(unknownKey, JSON.stringify({ ...readJson('payments/within-cap.json'), memo: 'x' }));
  const badPay = run(['evaluate', 'vectors/monthly-cap-valid.json', unknownKey, 'vectors/ledgers/month-100000.json']);
  assert.equal(badPay.status, 1);
  assert.deepEqual(codesOf(JSON.parse(badPay.stdout).reasons), ['PAYMENT_INVALID']);
  const missing = run(['evaluate', 'vectors/monthly-cap-valid.json', 'vectors/payments/does-not-exist.json']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /cannot read/);
});

test('cli: a file whose text carries 2500.0 is refused before it can parse as 2500', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pay-policy-'));
  const file = join(dir, 'policy.json');
  writeFileSync(file, readFileSync(join(VECTORS, 'monthly-cap-valid.json'), 'utf8').replace('"minor": 50000', '"minor": 50000.0'));
  assert.deepEqual(validate(JSON.parse(readFileSync(file, 'utf8'))), { valid: true, errors: [] }, 'JSON.parse alone would have let it through');
  const r = run(['check', file]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /non-integer numeric literal 50000\.0/);
});

test('cli: attenuate exits 0 for a narrowing child and 1 for a widening one', () => {
  assert.equal(run(['attenuate', 'vectors/parent-valid.json', 'vectors/child-narrowed-valid.json']).status, 0);
  assert.equal(run(['attenuate', 'vectors/parent-valid.json', 'vectors/widened-cap-invalid.json']).status, 1);
});

test('cli: usage exits 2', () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

// ─── The schema agrees with the checker ──────────────────────────────────────

test('schema: JSON Schema 2020-12, integers for money, x- only extras, the same closed period list', () => {
  const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'pay-policy-1.json'), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.properties.contract.const, CONTRACT);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.patternProperties), ['^x-']);
  assert.equal(schema.$defs.money.properties.minor.type, 'integer');
  assert.equal(schema.$defs.money.properties.minor.minimum, 0);
  assert.equal(schema.$defs.money.additionalProperties, false);
  assert.deepEqual(schema.$defs.money.required, ['minor', 'currency']);
  assert.deepEqual(schema.properties.limits.properties.perPeriod.properties.period.enum, [...PERIODS]);
  assert.deepEqual(schema.then.required, ['humanApprovalAbove']);
  // The key lists the checker enforces are the key lists the schema declares.
  assert.deepEqual(Object.keys(schema.properties).sort(), [...SHAPE.policy].sort());
  assert.deepEqual(Object.keys(schema.properties.limits.properties).sort(), [...SHAPE.limits].sort());
  assert.deepEqual(Object.keys(schema.properties.limits.properties.perPeriod.properties).sort(), [...SHAPE.perPeriod].sort());
  assert.deepEqual(Object.keys(schema.properties.allow.properties).sort(), [...SHAPE.allow].sort());
  assert.deepEqual(Object.keys(schema.$defs.money.properties).sort(), [...SHAPE.money].sort());
  for (const nested of [schema.properties.limits, schema.properties.limits.properties.perPeriod, schema.properties.allow]) {
    assert.equal(nested.additionalProperties, false);
  }
});

// ─── The repository holds what the README says ───────────────────────────────

test('repo: every README command in a code block runs and exits 0', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const commands = readme.split('\n').filter((l) => l.startsWith('node vendor-pay-policy.mjs ') || l.startsWith('npm test') || l.startsWith('npm run lint'));
  assert.ok(commands.some((c) => c.includes(' check ')), 'README shows a check command');
  assert.ok(commands.some((c) => c.includes(' evaluate ')), 'README shows an evaluate command');
  for (const c of commands.filter((c) => c.startsWith('node '))) {
    const r = spawnSync(process.execPath, c.split(' ').slice(1), { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, `${c}\n${r.stderr}`);
    assert.ok(r.stdout.trim().length > 0, `${c} produced no output`);
  }
});

test('repo: the LICENSE is the estate-declared Apache-2.0 (holder Flashy Labs); the README ends on the licence line; the status is draft', () => {
  // The estate register (flashyos tools/estate-licences.mjs) is the authority and
  // names this repository Apache-2.0, holder Flashy Labs. The LICENSE must be
  // present and carry exactly that grant and that holder.
  assert.equal(existsSync(join(ROOT, 'LICENSE')), true, 'the estate register names this repo Apache-2.0; the LICENSE must be present');
  const licence = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
  assert.match(licence, /Apache License/, 'the LICENSE must be the Apache License text');
  assert.match(licence, /Version 2\.0/, 'the LICENSE must be Apache-2.0');
  assert.equal((licence.match(/Copyright 2026 Flashy Labs/g) || []).length, 1, 'the LICENSE must name the holder — Copyright 2026 Flashy Labs — exactly once');
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8').trimEnd().split('\n');
  assert.equal(readme.at(-1), 'Licensed under Apache-2.0 (holder Flashy Labs); the estate register in flashyos `tools/estate-licences.mjs` is the authority.');
  assert.match(readFileSync(join(ROOT, 'README.md'), 'utf8'), /Status: draft/);
  assert.match(readFileSync(join(ROOT, 'SPEC.md'), 'utf8'), /Status: draft/);
});

test('repo: package.json is private, ESM, Node 22, dependency-free, and its scripts are the ones CI runs', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@flashylabs/agentpay');
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=22');
  for (const f of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) assert.equal(pkg[f], undefined);
  assert.match(pkg.scripts.test, /node --test/);
  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /npm run lint/);
  assert.match(ci, /npm test/);
  assert.doesNotMatch(ci, /npm (ci|install)/);
  assert.match(ci, /actions\/checkout@v4/);
  assert.match(ci, /actions\/setup-node@v4/);
  assert.match(ci, /node-version: ['"]?22/);
});

test('repo: every .mjs passes node --check', () => {
  const files = walk(ROOT).filter((f) => f.endsWith('.mjs') && !f.includes('node_modules') && !f.includes('/.git/'));
  assert.ok(files.length >= 3);
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test('repo: CLAUDE.md carries the estate house rules', () => {
  const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /## House rules — true in every repository in this estate/);
  assert.match(claude, /git symbolic-ref --short refs\/remotes\/origin\/HEAD/);
  assert.match(claude, /tools\/estate-licences\.mjs/);
});

test('repo: no vector or schema string names a brand; the format names no rail vendor', () => {
  const strings = [];
  const collect = (v) => {
    if (typeof v === 'string') strings.push(v.toLowerCase());
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { strings.push(k.toLowerCase()); collect(x); });
  };
  for (const f of [...walk(VECTORS), join(ROOT, 'schema', 'pay-policy-1.json')]) collect(JSON.parse(readFileSync(f, 'utf8')));
  // The checker's own string literals (error codes and messages), not its comments.
  const literals = readFileSync(CLI, 'utf8').match(/'[^'\n]*'|`[^`]*`/g) ?? [];
  strings.push(...literals.map((s) => s.toLowerCase()));
  for (const brand of ['tether', 'wdk', 'flashy', 'stripe', 'visa', 'mastercard', 'coinbase', 'circle']) {
    const hit = strings.find((s) => s.includes(brand));
    assert.equal(hit, undefined, `"${brand}" appears in the format: ${hit}`);
  }
});
