#!/usr/bin/env node
// pay-policy/1 — the vendor-neutral payment-policy checker and evaluator.
//
// This file answers one question and does nothing else: given a policy and a
// proposed payment, is the answer allow, deny, or escalate to a human? It
// holds no keys, moves no value, opens no connection, and reads no clock. The
// rails (wallet SDKs, x402, stablecoins, cards) and the signing live elsewhere; the
// period's spent-so-far is INJECTED as `ledgerState`, never fetched.
//
// Three exports and a CLI:
//
//   validate(policy)                      → { valid, errors }
//   attenuate(parent, child)              → { valid, errors }
//   evaluate(policy, payment, ledgerState) → { decision, reasons }
//
//   node vendor-pay-policy.mjs check <policy.json>
//   node vendor-pay-policy.mjs attenuate <parent.json> <child.json>
//   node vendor-pay-policy.mjs evaluate <policy.json> <payment.json> [ledger.json]
//
// `node:` builtins only. The name says `vendor-` because a copy of this file
// in another repository is meant to be byte-identical to this one.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CONTRACT = 'pay-policy/1';
export const PERIODS = Object.freeze(['day', 'week', 'month']);
export const DECISIONS = Object.freeze(['allow', 'deny', 'escalate']);

const CURRENCY_RE = /^[A-Z][A-Z0-9]{2,11}$/;
const RAIL_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const JURISDICTION_RE = /^[A-Z]{2}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

const POLICY_KEYS = Object.freeze(['contract', 'id', 'holder', 'parent', 'currency', 'limits', 'allow', 'humanApprovalAbove']);
const LIMITS_KEYS = Object.freeze(['perTransaction', 'perPeriod']);
const PER_PERIOD_KEYS = Object.freeze(['period', 'cap']);
const ALLOW_KEYS = Object.freeze(['counterparties', 'rails', 'jurisdictions']);
const MONEY_KEYS = Object.freeze(['minor', 'currency']);
const PAYMENT_KEYS = Object.freeze(['id', 'amount', 'counterparty', 'rail', 'jurisdiction', 'reference']);
const REFERENCE_KEYS = Object.freeze(['kind', 'id', 'hash']);
const LEDGER_KEYS = Object.freeze(['period', 'spent']);

/** The key lists the JSON Schema must agree with; a test compares them. */
export const SHAPE = Object.freeze({
  policy: POLICY_KEYS,
  limits: LIMITS_KEYS,
  perPeriod: PER_PERIOD_KEYS,
  allow: ALLOW_KEYS,
  money: MONEY_KEYS,
  payment: PAYMENT_KEYS,
  reference: REFERENCE_KEYS,
  ledgerState: LEDGER_KEYS,
});

// ─── Small helpers ───────────────────────────────────────────────────────────

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isExtension = (key) => key.startsWith('x-');

function err(code, path, message) {
  return { code, path, message };
}

/**
 * Every number in a pay-policy/1 document is a count of minor units, so a
 * non-integer number ANYWHERE — not only where money is expected — is a
 * refusal. Note JSON.parse has already turned `25.0` into 25; for the text
 * form see parseJsonStrict below.
 */
function collectNonIntegers(value, path, out) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) out.push(err('FLOAT', path, `${path} is ${value}; money is a whole number of minor units, never a float`));
    return;
  }
  if (Array.isArray(value)) value.forEach((v, i) => collectNonIntegers(v, `${path}[${i}]`, out));
  else if (isObject(value)) for (const [k, v] of Object.entries(value)) collectNonIntegers(v, `${path}.${k}`, out);
}

function checkUnknownKeys(value, allowed, path, out, { extensions = false } = {}) {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    if (extensions && isExtension(key)) continue;
    out.push(err('UNKNOWN_KEY', `${path}.${key}`, `${path}.${key} is not a ${CONTRACT} field${extensions ? ' (extensions must be x- prefixed)' : ''}`));
  }
}

/**
 * Money is `{ minor, currency }`: a non-negative safe integer of minor units
 * and an explicit currency code. `expectCurrency`, when given, is the
 * currency every figure in the document must share.
 */
function checkMoney(value, path, out, expectCurrency) {
  if (!isObject(value)) {
    out.push(err('MONEY_SHAPE', path, `${path} must be { minor, currency }`));
    return null;
  }
  checkUnknownKeys(value, MONEY_KEYS, path, out);
  const { minor, currency } = value;
  let ok = true;
  if (minor === undefined) {
    out.push(err('MISSING_MINOR', `${path}.minor`, `${path}.minor is required`));
    ok = false;
  } else if (typeof minor !== 'number') {
    out.push(err('NOT_INTEGER', `${path}.minor`, `${path}.minor must be a JSON integer, not a ${typeof minor}`));
    ok = false;
  } else if (!Number.isInteger(minor)) {
    out.push(err('FLOAT_MONEY', `${path}.minor`, `${path}.minor is ${minor}; minor units are whole numbers`));
    ok = false;
  } else if (!Number.isSafeInteger(minor)) {
    out.push(err('UNSAFE_INTEGER', `${path}.minor`, `${path}.minor exceeds 2^53-1 and cannot be represented exactly`));
    ok = false;
  } else if (minor < 0) {
    out.push(err('NEGATIVE_MONEY', `${path}.minor`, `${path}.minor is negative`));
    ok = false;
  }
  if (currency === undefined) {
    out.push(err('MISSING_CURRENCY', `${path}.currency`, `${path}.currency is required; a figure with no currency is not money`));
    ok = false;
  } else if (typeof currency !== 'string' || !CURRENCY_RE.test(currency)) {
    out.push(err('BAD_CURRENCY', `${path}.currency`, `${path}.currency must match ${CURRENCY_RE}`));
    ok = false;
  } else if (expectCurrency && currency !== expectCurrency) {
    out.push(err('CURRENCY_MISMATCH', `${path}.currency`, `${path}.currency is ${currency}; the document's currency is ${expectCurrency}`));
    ok = false;
  }
  return ok ? value : null;
}

function checkStringList(value, path, out, { pattern, patternName, required }) {
  if (value === undefined) {
    if (required) out.push(err('MISSING_FIELD', path, `${path} is required`));
    return;
  }
  if (!Array.isArray(value)) {
    out.push(err('NOT_A_LIST', path, `${path} must be a list of strings`));
    return;
  }
  const seen = new Set();
  value.forEach((item, i) => {
    if (typeof item !== 'string' || item.length === 0) out.push(err('BAD_ENTRY', `${path}[${i}]`, `${path}[${i}] must be a non-empty string`));
    else if (pattern && !pattern.test(item)) out.push(err('BAD_ENTRY', `${path}[${i}]`, `${path}[${i}] "${item}" is not ${patternName}`));
    else if (seen.has(item)) out.push(err('DUPLICATE_ENTRY', `${path}[${i}]`, `${path}[${i}] "${item}" is listed twice`));
    seen.add(item);
  });
}

function checkNonEmptyString(value, path, out, required = true) {
  if (value === undefined) {
    if (required) out.push(err('MISSING_FIELD', path, `${path} is required`));
    return;
  }
  if (typeof value !== 'string' || value.length === 0) out.push(err('BAD_FIELD', path, `${path} must be a non-empty string`));
}

// ─── validate ────────────────────────────────────────────────────────────────

/**
 * A policy permits spending iff its per-transaction cap is above zero. A
 * policy with a cap of 0 minor units is CLOSED: it can pay nobody anything,
 * and is the one shape that may omit the human gate.
 */
export function permitsSpending(policy) {
  return isObject(policy) && isObject(policy.limits) && isObject(policy.limits.perTransaction)
    && typeof policy.limits.perTransaction.minor === 'number' && policy.limits.perTransaction.minor > 0;
}

/**
 * validate(policy) → { valid, errors }. Refuses rather than guesses: every
 * error names a code and a path, and nothing is normalised or defaulted.
 */
export function validate(policy) {
  const errors = [];
  if (!isObject(policy)) return { valid: false, errors: [err('NOT_AN_OBJECT', '$', 'a policy is a JSON object')] };

  collectNonIntegers(policy, '$', errors);
  checkUnknownKeys(policy, POLICY_KEYS, '$', errors, { extensions: true });

  if (policy.contract !== CONTRACT) errors.push(err('CONTRACT', '$.contract', `$.contract must be "${CONTRACT}"`));
  checkNonEmptyString(policy.id, '$.id', errors);
  checkNonEmptyString(policy.holder, '$.holder', errors);
  checkNonEmptyString(policy.parent, '$.parent', errors, false);

  let currency = null;
  if (policy.currency === undefined) errors.push(err('MISSING_CURRENCY', '$.currency', '$.currency is required; every figure in the policy is in its minor units'));
  else if (typeof policy.currency !== 'string' || !CURRENCY_RE.test(policy.currency)) errors.push(err('BAD_CURRENCY', '$.currency', `$.currency must match ${CURRENCY_RE}`));
  else currency = policy.currency;

  // limits
  let perTransaction = null;
  if (!isObject(policy.limits)) {
    errors.push(err('MISSING_FIELD', '$.limits', '$.limits is required'));
  } else {
    checkUnknownKeys(policy.limits, LIMITS_KEYS, '$.limits', errors);
    if (policy.limits.perTransaction === undefined) errors.push(err('MISSING_FIELD', '$.limits.perTransaction', '$.limits.perTransaction is required (0 minor units closes the policy)'));
    else perTransaction = checkMoney(policy.limits.perTransaction, '$.limits.perTransaction', errors, currency);
    if (policy.limits.perPeriod !== undefined) {
      const pp = policy.limits.perPeriod;
      if (!isObject(pp)) errors.push(err('BAD_FIELD', '$.limits.perPeriod', '$.limits.perPeriod must be { period, cap }'));
      else {
        checkUnknownKeys(pp, PER_PERIOD_KEYS, '$.limits.perPeriod', errors);
        if (!PERIODS.includes(pp.period)) errors.push(err('BAD_PERIOD', '$.limits.perPeriod.period', `$.limits.perPeriod.period must be one of ${PERIODS.join(', ')}`));
        if (pp.cap === undefined) errors.push(err('MISSING_FIELD', '$.limits.perPeriod.cap', '$.limits.perPeriod.cap is required'));
        else checkMoney(pp.cap, '$.limits.perPeriod.cap', errors, currency);
      }
    }
  }

  // allow
  if (!isObject(policy.allow)) {
    errors.push(err('MISSING_FIELD', '$.allow', '$.allow is required'));
  } else {
    checkUnknownKeys(policy.allow, ALLOW_KEYS, '$.allow', errors);
    checkStringList(policy.allow.counterparties, '$.allow.counterparties', errors, { required: true });
    checkStringList(policy.allow.rails, '$.allow.rails', errors, { required: true, pattern: RAIL_RE, patternName: 'a lowercase rail identifier' });
    checkStringList(policy.allow.jurisdictions, '$.allow.jurisdictions', errors, { required: false, pattern: JURISDICTION_RE, patternName: 'a two-letter uppercase jurisdiction code' });
  }

  // the human gate
  const spending = permitsSpending(policy);
  if (policy.humanApprovalAbove === undefined) {
    if (spending) errors.push(err('NO_HUMAN_GATE', '$.humanApprovalAbove', 'a policy that permits spending must carry humanApprovalAbove; a money-touching policy with no human gate is refused'));
  } else {
    const gate = checkMoney(policy.humanApprovalAbove, '$.humanApprovalAbove', errors, currency);
    if (gate && perTransaction && spending && gate.minor >= perTransaction.minor) {
      errors.push(err('HUMAN_GATE_UNREACHABLE', '$.humanApprovalAbove', `humanApprovalAbove (${gate.minor}) is not below perTransaction (${perTransaction.minor}); a gate no permitted payment can reach is a missing gate`));
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── attenuate ───────────────────────────────────────────────────────────────

const subset = (child, parent) => child.every((c) => parent.includes(c));
const missing = (child, parent) => child.filter((c) => !parent.includes(c));

/**
 * attenuate(parent, child) → { valid, errors }. A child may only NARROW its
 * parent: caps ≤, allowlists ⊆, human gate ≤, rails ⊆, jurisdictions ⊆. Any
 * widening on any dimension is refused; every widened dimension is named.
 */
export function attenuate(parent, child) {
  const errors = [];
  const p = validate(parent);
  const c = validate(child);
  if (!p.valid) errors.push(...p.errors.map((e) => ({ ...e, path: `parent${e.path.slice(1)}`, code: `PARENT_${e.code}` })));
  if (!c.valid) errors.push(...c.errors.map((e) => ({ ...e, path: `child${e.path.slice(1)}`, code: `CHILD_${e.code}` })));
  if (errors.length) return { valid: false, errors };

  if (child.parent !== parent.id) errors.push(err('PARENT_MISMATCH', 'child.parent', `child.parent is ${JSON.stringify(child.parent)}; it must name the parent's id "${parent.id}"`));
  if (child.currency !== parent.currency) errors.push(err('CURRENCY_MISMATCH', 'child.currency', `child is in ${child.currency}, parent in ${parent.currency}; attenuation never changes currency`));

  const pTx = parent.limits.perTransaction.minor;
  const cTx = child.limits.perTransaction.minor;
  if (cTx > pTx) errors.push(err('WIDENED_PER_TRANSACTION', 'child.limits.perTransaction', `child perTransaction ${cTx} exceeds parent ${pTx}`));

  const pPeriod = parent.limits.perPeriod;
  const cPeriod = child.limits.perPeriod;
  if (pPeriod) {
    if (!cPeriod) errors.push(err('DROPPED_PERIOD_CAP', 'child.limits.perPeriod', `parent caps ${pPeriod.cap.minor} per ${pPeriod.period}; child carries no period cap`));
    else {
      if (cPeriod.period !== pPeriod.period) errors.push(err('PERIOD_MISMATCH', 'child.limits.perPeriod.period', `child period ${cPeriod.period} differs from parent ${pPeriod.period}; a different period is not comparable and is refused`));
      else if (cPeriod.cap.minor > pPeriod.cap.minor) errors.push(err('WIDENED_PERIOD_CAP', 'child.limits.perPeriod.cap', `child ${cPeriod.period} cap ${cPeriod.cap.minor} exceeds parent ${pPeriod.cap.minor}`));
    }
  }

  if (!subset(child.allow.counterparties, parent.allow.counterparties)) {
    errors.push(err('WIDENED_COUNTERPARTIES', 'child.allow.counterparties', `child adds counterparties the parent does not permit: ${missing(child.allow.counterparties, parent.allow.counterparties).join(', ')}`));
  }
  if (!subset(child.allow.rails, parent.allow.rails)) {
    errors.push(err('WIDENED_RAILS', 'child.allow.rails', `child adds rails the parent does not permit: ${missing(child.allow.rails, parent.allow.rails).join(', ')}`));
  }
  if (parent.allow.jurisdictions) {
    if (!child.allow.jurisdictions) errors.push(err('DROPPED_JURISDICTIONS', 'child.allow.jurisdictions', 'parent restricts jurisdictions; child restricts none'));
    else if (!subset(child.allow.jurisdictions, parent.allow.jurisdictions)) {
      errors.push(err('WIDENED_JURISDICTIONS', 'child.allow.jurisdictions', `child adds jurisdictions the parent does not permit: ${missing(child.allow.jurisdictions, parent.allow.jurisdictions).join(', ')}`));
    }
  }

  // A closed child (perTransaction 0) has no gate to compare; a spending
  // child must escalate at or below where its parent would.
  if (permitsSpending(child)) {
    const pGate = parent.humanApprovalAbove ? parent.humanApprovalAbove.minor : 0;
    const cGate = child.humanApprovalAbove.minor;
    if (cGate > pGate) errors.push(err('WIDENED_HUMAN_GATE', 'child.humanApprovalAbove', `child escalates above ${cGate}; parent escalates above ${pGate}`));
  }

  return { valid: errors.length === 0, errors };
}

// ─── evaluate ────────────────────────────────────────────────────────────────

function validatePayment(payment, currency) {
  const errors = [];
  if (!isObject(payment)) return [err('NOT_AN_OBJECT', 'payment', 'a payment is a JSON object')];
  collectNonIntegers(payment, 'payment', errors);
  checkUnknownKeys(payment, PAYMENT_KEYS, 'payment', errors, { extensions: true });
  checkNonEmptyString(payment.id, 'payment.id', errors);
  checkNonEmptyString(payment.counterparty, 'payment.counterparty', errors);
  if (payment.rail === undefined) errors.push(err('MISSING_FIELD', 'payment.rail', 'payment.rail is required'));
  else if (typeof payment.rail !== 'string' || !RAIL_RE.test(payment.rail)) errors.push(err('BAD_FIELD', 'payment.rail', 'payment.rail must be a lowercase rail identifier'));
  if (payment.jurisdiction !== undefined && (typeof payment.jurisdiction !== 'string' || !JURISDICTION_RE.test(payment.jurisdiction))) {
    errors.push(err('BAD_FIELD', 'payment.jurisdiction', 'payment.jurisdiction must be a two-letter uppercase code'));
  }
  if (payment.amount === undefined) errors.push(err('MISSING_FIELD', 'payment.amount', 'payment.amount is required'));
  else checkMoney(payment.amount, 'payment.amount', errors); // currency compared in evaluate, as a decision rather than a shape error
  if (payment.reference !== undefined) {
    if (!isObject(payment.reference)) errors.push(err('BAD_FIELD', 'payment.reference', 'payment.reference must be { kind, id, hash? }'));
    else {
      checkUnknownKeys(payment.reference, REFERENCE_KEYS, 'payment.reference', errors);
      checkNonEmptyString(payment.reference.kind, 'payment.reference.kind', errors);
      checkNonEmptyString(payment.reference.id, 'payment.reference.id', errors);
      if (payment.reference.hash !== undefined && (typeof payment.reference.hash !== 'string' || !HASH_RE.test(payment.reference.hash))) {
        errors.push(err('BAD_FIELD', 'payment.reference.hash', 'payment.reference.hash must be 64 lowercase hex characters (sha256)'));
      }
    }
  }
  void currency;
  return errors;
}

function validateLedgerState(ledgerState) {
  const errors = [];
  if (!isObject(ledgerState)) return [err('NOT_AN_OBJECT', 'ledgerState', 'ledgerState is a JSON object { period, spent }')];
  collectNonIntegers(ledgerState, 'ledgerState', errors);
  checkUnknownKeys(ledgerState, LEDGER_KEYS, 'ledgerState', errors, { extensions: true });
  if (!PERIODS.includes(ledgerState.period)) errors.push(err('BAD_PERIOD', 'ledgerState.period', `ledgerState.period must be one of ${PERIODS.join(', ')}`));
  if (ledgerState.spent === undefined) errors.push(err('MISSING_FIELD', 'ledgerState.spent', 'ledgerState.spent is required'));
  else checkMoney(ledgerState.spent, 'ledgerState.spent', errors);
  return errors;
}

const reason = (code, message) => ({ code, message });
const describe = (errors) => errors.map((e) => `${e.code} at ${e.path}: ${e.message}`).join('; ');

/**
 * evaluate(policy, payment, ledgerState) → { decision, reasons }.
 *
 * Pure and deterministic: the same three inputs give the same answer, nothing
 * is read from the environment, nothing is written anywhere, and the inputs
 * are not mutated. `ledgerState` is the caller's statement of what this
 * policy's holder has already spent in the current period; the evaluator
 * never fetches it and never computes period boundaries.
 *
 * Every check that fails appends a reason; any failing check is a deny. Only
 * a payment that passes every check is graded against the human gate, and a
 * payment above it is `escalate`, never `allow`. `allow` carries no reasons
 * because it has nothing to explain: it is exactly what the policy said.
 */
export function evaluate(policy, payment, ledgerState = null) {
  const reasons = [];

  const pv = validate(policy);
  if (!pv.valid) return { decision: 'deny', reasons: [reason('POLICY_INVALID', `the policy does not validate: ${describe(pv.errors)}`)] };

  const pe = validatePayment(payment, policy.currency);
  if (pe.length) return { decision: 'deny', reasons: [reason('PAYMENT_INVALID', `the payment does not validate: ${describe(pe)}`)] };

  const amount = payment.amount;
  if (amount.currency !== policy.currency) reasons.push(reason('CURRENCY_MISMATCH', `payment is in ${amount.currency}; the policy is in ${policy.currency}`));
  if (amount.minor === 0) reasons.push(reason('INVALID_AMOUNT', 'a payment of 0 minor units is not a payment'));

  if (!policy.allow.rails.includes(payment.rail)) reasons.push(reason('RAIL_NOT_PERMITTED', `rail "${payment.rail}" is not in the policy's rails`));
  if (!policy.allow.counterparties.includes(payment.counterparty)) reasons.push(reason('COUNTERPARTY_NOT_PERMITTED', `counterparty "${payment.counterparty}" is not on the allowlist`));

  if (policy.allow.jurisdictions) {
    if (payment.jurisdiction === undefined) reasons.push(reason('JURISDICTION_UNKNOWN', 'the policy restricts jurisdictions and the payment names none; unknown is not permitted'));
    else if (!policy.allow.jurisdictions.includes(payment.jurisdiction)) reasons.push(reason('JURISDICTION_NOT_PERMITTED', `jurisdiction ${payment.jurisdiction} is not in the policy's jurisdictions`));
  }

  const perTx = policy.limits.perTransaction.minor;
  if (amount.minor > perTx) reasons.push(reason('PER_TX_CAP', `${amount.minor} exceeds the per-transaction cap of ${perTx} ${policy.currency} minor units`));

  const perPeriod = policy.limits.perPeriod;
  if (perPeriod) {
    if (ledgerState === null || ledgerState === undefined) {
      reasons.push(reason('LEDGER_STATE_MISSING', `the policy caps spend per ${perPeriod.period} and no ledgerState was supplied; spent-so-far unknown is not spent-so-far zero`));
    } else {
      const le = validateLedgerState(ledgerState);
      if (le.length) reasons.push(reason('LEDGER_STATE_INVALID', `ledgerState does not validate: ${describe(le)}`));
      else if (ledgerState.period !== perPeriod.period) reasons.push(reason('LEDGER_STATE_MISMATCH', `ledgerState is for a ${ledgerState.period}; the policy caps per ${perPeriod.period}`));
      else if (ledgerState.spent.currency !== policy.currency) reasons.push(reason('LEDGER_STATE_MISMATCH', `ledgerState.spent is in ${ledgerState.spent.currency}; the policy is in ${policy.currency}`));
      else if (ledgerState.spent.minor + amount.minor > perPeriod.cap.minor) {
        reasons.push(reason('PERIOD_CAP', `${ledgerState.spent.minor} already spent this ${perPeriod.period} plus ${amount.minor} exceeds the cap of ${perPeriod.cap.minor}`));
      }
    }
  }

  if (reasons.length) return { decision: 'deny', reasons };

  const gate = policy.humanApprovalAbove.minor;
  if (amount.minor > gate) {
    return { decision: 'escalate', reasons: [reason('HUMAN_APPROVAL_REQUIRED', `${amount.minor} is above the human-approval threshold of ${gate} ${policy.currency} minor units; a person must approve`)] };
  }
  return { decision: 'allow', reasons: [] };
}

// ─── JSON text that JSON.parse would silently round ──────────────────────────

/**
 * JSON.parse turns `2500.0` into 2500 and `25e2` into 2500, so a float in a
 * FILE survives parsing as an integer. This parser walks the text first and
 * refuses any numeric literal carrying a fraction or an exponent. Strings are
 * skipped, escapes honoured. Throws on refusal.
 */
export function parseJsonStrict(text) {
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 2;
      else {
        if (ch === '"') inString = false;
        i += 1;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      i += 1;
      continue;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i + 1;
      while (j < text.length && /[0-9eE+.\-]/.test(text[j])) j += 1;
      const literal = text.slice(i, j);
      if (/[.eE]/.test(literal)) throw new SyntaxError(`non-integer numeric literal ${literal} at offset ${i}; ${CONTRACT} carries whole minor units only`);
      i = j;
      continue;
    }
    i += 1;
  }
  return JSON.parse(text);
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function readJson(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`cannot read ${path}: ${e.message}`);
  }
  try {
    return parseJsonStrict(text);
  } catch (e) {
    throw new Error(`${path}: ${e.message}`);
  }
}

const USAGE = `usage:
  node vendor-pay-policy.mjs check <policy.json>
  node vendor-pay-policy.mjs attenuate <parent.json> <child.json>
  node vendor-pay-policy.mjs evaluate <policy.json> <payment.json> [ledger.json]

exit 0: the input was valid and an answer was printed (a deny is an answer)
exit 1: the input was invalid, unreadable, or not whole-minor-unit JSON
exit 2: usage`;

export function main(argv, stdout = process.stdout, stderr = process.stderr) {
  const [command, ...args] = argv;
  const print = (v) => stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  try {
    if (command === 'check' && args.length === 1) {
      const result = validate(readJson(args[0]));
      print(result);
      return result.valid ? 0 : 1;
    }
    if (command === 'attenuate' && args.length === 2) {
      const result = attenuate(readJson(args[0]), readJson(args[1]));
      print(result);
      return result.valid ? 0 : 1;
    }
    if (command === 'evaluate' && (args.length === 2 || args.length === 3)) {
      const policy = readJson(args[0]);
      const pv = validate(policy);
      if (!pv.valid) {
        print({ decision: 'deny', reasons: [reason('POLICY_INVALID', describe(pv.errors))], errors: pv.errors });
        return 1;
      }
      const payment = readJson(args[1]);
      const ledger = args.length === 3 ? readJson(args[2]) : null;
      const result = evaluate(policy, payment, ledger);
      print(result);
      const invalidInput = result.reasons.some((r) => ['PAYMENT_INVALID', 'LEDGER_STATE_INVALID'].includes(r.code));
      return invalidInput ? 1 : 0;
    }
    stderr.write(`${USAGE}\n`);
    return 2;
  } catch (e) {
    stderr.write(`${e.message}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
