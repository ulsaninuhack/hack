import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'overnight-freeze.json'), 'utf8'));

for (const [file, expected] of Object.entries(manifest.files)) {
  const bytes = await readFile(resolve(root, file));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    throw new Error(`Frozen contract changed: ${file}\nexpected ${expected}\nactual   ${actual}`);
  }
}

console.log(`Overnight contract freeze PASS (${Object.keys(manifest.files).length} files)`);
