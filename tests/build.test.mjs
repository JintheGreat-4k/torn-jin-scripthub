import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers/load-source.mjs';
import { loadModules } from '../tools/build.mjs';

const hub = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/hub/hub.json'), 'utf8'));

test('all module manifests are valid', () => {
  const mods = loadModules();
  assert.ok(mods.length >= 1);
  for (const m of mods) assert.ok(fs.existsSync(path.join(ROOT, m.docs)), `${m.id} docs exist`);
});

test('dist/ and README.md are up to date with src/', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--check'], { stdio: 'pipe' });
});

test('bundle header contains every module grant and connect', () => {
  const bundle = fs.readFileSync(path.join(ROOT, hub.output), 'utf8');
  const header = bundle.slice(0, bundle.indexOf('// ==/UserScript=='));
  assert.match(header, new RegExp(`@version\\s+${hub.version.replace(/\./g, '\\.')}\\n`));
  for (const m of loadModules()) {
    for (const g of m.grants || []) assert.match(header, new RegExp(`@grant\\s+${g}\\n`));
    for (const c of m.connect || []) assert.ok(header.includes(`@connect      ${c}\n`), `${m.id}: @connect ${c}`);
    assert.ok(bundle.includes(`Hub.define({"id":"${m.id}"`), `${m.id} is bundled`);
  }
});
