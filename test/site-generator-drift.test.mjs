// The institutional front-door generator is vendored, not forked. build-site.mjs,
// mesh.mjs and the site-config/1 schema are byte-identical copies of the canonical
// set in FlashyLabs/web4 (CONTRIBUTING.md, "Vendoring this generator"). This test
// pins each against that source when the web4 checkout is beside this one, and
// reports UNKNOWN — never passed — when it is not. Change one of these here and you
// have forked the door; change it in web4 and re-vendor. node: builtins only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CANON = join(ROOT, '..', 'web4');
const readBin = (p) => readFileSync(p).toString('binary');

const VENDORED = [
  'scripts/build-site.mjs',
  'scripts/mesh.mjs',
  'schema/site-config-1.json',
];

for (const rel of VENDORED) {
  test(`${rel} is byte-identical to the web4 canon (or UNKNOWN)`, () => {
    const src = join(CANON, rel);
    if (!existsSync(src)) {
      console.log(`UNKNOWN: web4 checkout is absent; cannot verify ${rel} is current`);
      return;
    }
    assert.equal(
      readBin(join(ROOT, rel)),
      readBin(src),
      `${rel} has drifted from the web4 generator — re-vendor, never edit`,
    );
  });
}
