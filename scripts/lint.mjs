// Zero-install lint: syntax-check every .mjs and hold the house rules that a
// test file cannot hold as naturally. `node:` builtins only.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP = new Set(['.git', 'node_modules']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const failures = [];
const files = walk(ROOT);

for (const file of files.filter((f) => f.endsWith('.mjs'))) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) failures.push(`${relative(ROOT, file)}: ${r.stderr.trim()}`);
}

for (const file of files.filter((f) => f.endsWith('.json'))) {
  try {
    JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    failures.push(`${relative(ROOT, file)}: ${e.message}`);
  }
}

if (existsSync(join(ROOT, 'LICENSE')) || existsSync(join(ROOT, 'LICENSE.md'))) {
  failures.push('LICENSE: the licence is declared once, in tools/estate-licences.mjs in flashyos, not here');
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  if (pkg[field] && Object.keys(pkg[field]).length) failures.push(`package.json: ${field} is not empty; this repository is dependency-free`);
}

const readme = readFileSync(join(ROOT, 'README.md'), 'utf8').trimEnd().split('\n');
const LICENCE_LINE = 'Licence: to be declared at launch. The estate licence register in flashyos governs; this repository is not yet open-sourced.';
if (readme[readme.length - 1] !== LICENCE_LINE) failures.push(`README.md: final line must be exactly: ${LICENCE_LINE}`);

if (failures.length) {
  for (const f of failures) process.stderr.write(`lint: ${f}\n`);
  process.exit(1);
}
process.stdout.write(`lint: ${files.filter((f) => f.endsWith('.mjs')).length} .mjs files syntax-checked, house rules hold\n`);
