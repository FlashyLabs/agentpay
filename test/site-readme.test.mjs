// The README's institutional-front-door shape, held by a test — adapted from
// web4's readme.test.mjs for this property. A reader arriving cold gets the mark
// beside the title, the "Where it sits in the stack" section the front door adds,
// a dated status, and the estate licence line last. node: builtins only, no install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

const LICENCE_LINE =
  'Licence: to be declared at launch. The estate licence register in flashyos governs; this repository is not yet open-sourced.';

test('the H1 is the first line and names the contract', () => {
  assert.ok(readme.startsWith('# agentpay — `pay-policy/1`'), 'the H1 must be the first line and name the contract');
});

test('the bolt mark sits beside the H1 and is a file the brand manifest covers', () => {
  assert.match(readme, /<img src="brand\/assets\/bolt-gold\.svg" width="48" alt="">/);
  const manifest = readFileSync(join(ROOT, 'brand', 'MANIFEST.sha256'), 'utf8');
  assert.match(manifest, /assets\/bolt-gold\.svg$/m, 'the bolt the README shows is not in the brand manifest');
});

test('the README documents where the property sits in the stack', () => {
  assert.match(readme, /\n## Where it sits in the stack\n/);
  assert.ok(readme.includes('site.config.json'), 'the front-door section must name the config it is generated from');
  assert.ok(readme.includes('scripts/build-site.mjs'), 'the front-door section must name the generator');
});

test('the status line carries a date', () => {
  assert.match(readme, /^Status:.*\b\d{4}-\d{2}-\d{2}\b/m, 'the status line must carry a measured date');
});

test('the estate licence line is the last line, exactly once', () => {
  assert.equal(readme.split(LICENCE_LINE).length - 1, 1, 'the licence line must appear exactly once');
  assert.equal(readme.trimEnd().split('\n').at(-1), LICENCE_LINE, 'the licence line must be the last line');
});
