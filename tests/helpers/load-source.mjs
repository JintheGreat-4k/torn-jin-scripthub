// Loads a plain module source file (which declares top-level functions/consts, no exports)
// and returns the requested names. Runs in this realm so assert.deepStrictEqual works.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function loadSource(relPath, names) {
  const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  // eslint-disable-next-line no-new-func
  return new Function(`${code}\nreturn { ${names.join(', ')} };`)();
}
