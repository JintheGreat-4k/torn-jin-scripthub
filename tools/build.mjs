#!/usr/bin/env node
// Builds the single installable userscript from src/ and refreshes the module table in README.md.
//
//   node tools/build.mjs          build dist/ and README.md
//   node tools/build.mjs --check  fail if dist/ or README.md are out of date (used by CI)
//
// No dependencies – plain Node >= 18.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULES_DIR = path.join(ROOT, 'src/modules');
const README = path.join(ROOT, 'README.md');
const MARK_START = '<!-- modules:start -->';
const MARK_END = '<!-- modules:end -->';

const MANIFEST_KEYS = {
  id: 'string', name: 'string', version: 'string', description: 'string', files: 'array',
  icon: 'string', defaultEnabled: 'boolean', apiComment: 'string', apiAccess: 'string', order: 'number',
  include: 'array', grants: 'array', connect: 'array', docs: 'string',
};
const REQUIRED = ['id', 'name', 'version', 'description', 'files', 'docs'];
const API_ACCESS = ['Public', 'Minimal', 'Limited', 'Full'];
const SEMVER = /^\d+\.\d+\.\d+$/;

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const read = (p) => fs.readFileSync(p, 'utf8');
const readJson = (p) => {
  try { return JSON.parse(read(p)); } catch (e) { throw new Error(`${rel(p)}: invalid JSON – ${e.message}`); }
};
const typeOf = (v) => (Array.isArray(v) ? 'array' : typeof v);

export function loadModules() {
  const errors = [];
  const mods = [];
  for (const dir of fs.readdirSync(MODULES_DIR).sort()) {
    const abs = path.join(MODULES_DIR, dir);
    if (dir.startsWith('_') || dir.startsWith('.') || !fs.statSync(abs).isDirectory()) continue;
    const mfPath = path.join(abs, 'module.json');
    if (!fs.existsSync(mfPath)) { errors.push(`${rel(abs)}: missing module.json`); continue; }
    const m = readJson(mfPath);
    const where = rel(mfPath);
    for (const k of Object.keys(m)) {
      if (!MANIFEST_KEYS[k]) errors.push(`${where}: unknown key "${k}"`);
      else if (typeOf(m[k]) !== MANIFEST_KEYS[k]) errors.push(`${where}: "${k}" must be ${MANIFEST_KEYS[k]}`);
    }
    for (const k of REQUIRED) if (m[k] == null || m[k] === '') errors.push(`${where}: "${k}" is required`);
    if (m.id !== dir) errors.push(`${where}: id "${m.id}" must equal the folder name "${dir}"`);
    if (m.id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m.id)) errors.push(`${where}: id must be kebab-case`);
    if (m.version && !SEMVER.test(m.version)) errors.push(`${where}: version must be x.y.z`);
    if (m.apiAccess && !API_ACCESS.includes(m.apiAccess)) errors.push(`${where}: apiAccess must be one of ${API_ACCESS.join(', ')}`);
    for (const re of m.include || []) {
      try { new RegExp(re); } catch (e) { errors.push(`${where}: invalid include regex ${JSON.stringify(re)}`); }
    }
    for (const f of m.files || []) {
      if (!fs.existsSync(path.join(abs, f))) errors.push(`${where}: file "${f}" not found`);
    }
    if (m.docs && !fs.existsSync(path.join(ROOT, m.docs))) errors.push(`${where}: docs "${m.docs}" not found`);
    mods.push({ ...m, dir: abs });
  }
  const seen = new Set();
  for (const m of mods) {
    if (seen.has(m.id)) errors.push(`duplicate module id "${m.id}"`);
    seen.add(m.id);
  }
  if (errors.length) throw new Error('Invalid modules:\n  - ' + errors.join('\n  - '));
  return mods.sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000) || a.name.localeCompare(b.name));
}

const uniq = (arr) => [...new Set(arr)];

export function buildBundle(hub, mods) {
  const repoUrl = `https://github.com/${hub.repo}`;
  const rawUrl = `https://raw.githubusercontent.com/${hub.repo}/${hub.branch}/${hub.output}`;
  const grants = uniq([...hub.grants, ...mods.flatMap((m) => m.grants || [])]);
  const connect = uniq([...hub.connect, ...mods.flatMap((m) => m.connect || [])]);
  const pad = (k) => `// @${k.padEnd(12)} `;
  const header = [
    '// ==UserScript==',
    pad('name') + hub.name,
    pad('namespace') + hub.namespace,
    pad('version') + hub.version,
    pad('description') + hub.description,
    pad('author') + hub.author,
    ...hub.match.map((m) => pad('match') + m),
    pad('run-at') + hub.runAt,
    pad('noframes').trimEnd(),
    ...grants.map((g) => pad('grant') + g),
    ...connect.map((c) => pad('connect') + c),
    pad('homepageURL') + repoUrl,
    pad('supportURL') + repoUrl + '/issues',
    pad('updateURL') + rawUrl,
    pad('downloadURL') + rawUrl,
    '// ==/UserScript==',
  ].join('\n');

  const hubMeta = { name: hub.name, version: hub.version, repo: hub.repo };
  const parts = [
    header,
    '',
    '// GENERATED FILE – do not edit. Edit the sources in src/ and run `npm run build`.',
    `// Modules: ${mods.map((m) => `${m.id}@${m.version}`).join(', ') || '(none)'}`,
    '',
    '(function () {',
    "  'use strict';",
    `  const HUB_META = ${JSON.stringify(hubMeta)};`,
    '',
  ];
  for (const f of hub.core) {
    parts.push(`// ===== ${f} =====`, read(path.join(ROOT, f)).trimEnd(), '');
  }
  for (const m of mods) {
    const meta = {
      id: m.id, name: m.name, icon: m.icon || '', version: m.version, description: m.description,
      defaultEnabled: !!m.defaultEnabled, apiComment: m.apiComment || m.id, apiAccess: m.apiAccess || '',
      include: m.include || [], docsUrl: `${repoUrl}/blob/${hub.branch}/${m.docs}`,
    };
    parts.push(`// ===== module: ${m.id} (${rel(m.dir)}) =====`);
    parts.push('(function (MODULE) {');
    for (const f of m.files) parts.push(`// --- ${f} ---`, read(path.join(m.dir, f)).trimEnd());
    parts.push(`})(Hub.define(${JSON.stringify(meta)}));`, '');
  }
  parts.push('Hub.boot();', '})();', '');
  const out = parts.join('\n');
  try {
    new vm.Script(out, { filename: hub.output });
  } catch (e) {
    throw new Error(`Generated bundle does not compile: ${e.message}`);
  }
  return out;
}

export function buildReadme(mods, current) {
  const rows = mods.map((m) =>
    `| ${m.icon ? m.icon + ' ' : ''}**${m.name}** | ${m.version} | ${m.description} | ${m.apiAccess || '–'} | ${m.defaultEnabled ? 'on' : 'off'} | [${m.docs}](${m.docs}) |`);
  const table = [
    MARK_START,
    '<!-- Generated by tools/build.mjs from src/modules/*/module.json – do not edit by hand. -->',
    '| Module | Version | What it does | API access | Default | Docs |',
    '|---|---|---|---|---|---|',
    ...rows,
    MARK_END,
  ].join('\n');
  const a = current.indexOf(MARK_START), b = current.indexOf(MARK_END);
  if (a < 0 || b < a) throw new Error(`README.md must contain ${MARK_START} … ${MARK_END}`);
  return current.slice(0, a) + table + current.slice(b + MARK_END.length);
}

function main() {
  const check = process.argv.includes('--check');
  const hub = readJson(path.join(ROOT, 'src/hub/hub.json'));
  if (!SEMVER.test(hub.version)) throw new Error('src/hub/hub.json: version must be x.y.z');
  const mods = loadModules();
  const outputs = [
    [path.join(ROOT, hub.output), buildBundle(hub, mods)],
    [README, buildReadme(mods, read(README))],
  ];
  const stale = [];
  for (const [file, content] of outputs) {
    const old = fs.existsSync(file) ? read(file) : null;
    if (old === content) continue;
    if (check) stale.push(rel(file));
    else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
  }
  if (check && stale.length) {
    console.error(`Out of date: ${stale.join(', ')}\nRun \`npm run build\` and commit the result.`);
    process.exit(1);
  }
  console.log(`${check ? 'Up to date' : 'Built'}: ${hub.output} v${hub.version} – ${mods.map((m) => `${m.id}@${m.version}`).join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
