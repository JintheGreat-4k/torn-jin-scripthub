# Adding a module

This guide turns an idea (or an existing standalone userscript) into a Scripthub module.
Read [architecture.md](architecture.md) for the background.

## 1. Create the folder

```bash
cp -r src/modules/_template src/modules/my-module
```

The folder name is the module id: lowercase kebab-case, never changed afterwards (it is part
of the storage keys, so renaming it resets the module's settings and on/off state).

## 2. Fill in `module.json`

```json
{
  "id": "my-module",
  "name": "My Module",
  "icon": "✨",
  "version": "1.0.0",
  "description": "One sentence shown in the hub's module list and the README table.",
  "defaultEnabled": false,
  "apiComment": "MyModule",
  "apiAccess": "Public",
  "order": 100,
  "files": ["logic.js", "module.js"],
  "include": [],
  "grants": [],
  "connect": [],
  "docs": "docs/modules/my-module.md"
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | ✓ | Must equal the folder name |
| `name` | ✓ | Display name |
| `version` | ✓ | `x.y.z`, bump on every change |
| `description` | ✓ | One sentence |
| `files` | ✓ | Source files, concatenated in this order into one scope |
| `docs` | ✓ | Path of the module's doc page (must exist) |
| `icon` | | Emoji shown in the hub and README |
| `defaultEnabled` | | State for users who never toggled the module. Use `false` for anything that polls the API continuously, makes noise or changes Torn's pages noticeably |
| `apiComment` | | `comment=` sent with every API request (defaults to the id) |
| `apiAccess` | | Minimum key level: `Public`, `Minimal`, `Limited` or `Full` |
| `order` | | Position in the hub list (lower first, default 1000) |
| `include` | | Regexes matched against `location.href`; the module only starts on matching pages. Empty = every page. Checked at page load – Torn's hash navigation (`#/…`) does not re-trigger it |
| `grants` | | Extra `@grant`s the module needs (merged into the header) |
| `connect` | | Extra `@connect` domains (merged into the header) |

The hub already grants `GM_getValue`, `GM_setValue`, `GM_deleteValue`,
`GM_addValueChangeListener`, `GM_removeValueChangeListener`, `GM_xmlhttpRequest`,
`GM_notification`, `GM_registerMenuCommand` and `@connect api.torn.com`. Prefer the `ctx`
helpers over calling `GM_*` directly – they also work in the fallback mode.

## 3. Write the code

`module.js` must assign `MODULE.start`:

```js
MODULE.start = (ctx) => {
  ctx.addStyle('#my-box{position:fixed;right:20px;bottom:20px;z-index:999999;background:#222;color:#eee;padding:8px}');
  const box = ctx.mount(ctx.el('<div id="my-box">Loading…</div>'));

  async function update() {
    try {
      const data = await ctx.api('user/?selections=basic');
      if (!ctx.alive) return;            // switched off while waiting
      box.textContent = `Hello ${data.name}`;
    } catch (e) {
      box.textContent = '⚠ ' + e.message;
    }
  }
  update();
  ctx.setInterval(update, 60000);
  ctx.onApiKeyChange(update);
};
```

Rules of thumb:

- **Everything through `ctx`.** Styles, elements, window/document listeners, timers, launchers –
  so switching the module off leaves no trace. Use `ctx.onCleanup` for the rest (workers,
  `AudioContext`, attributes on `<html>`, leadership records, …).
- **Check `ctx.alive` after every `await`** or callback that may arrive after the module was stopped.
- **Prefix your DOM ids/classes and CSS** with something module-specific (e.g. `tsr-` for Stock ROI).
- **Use `ctx.store`, not `GM_setValue`**, so keys are namespaced to the module.
- **Never ask for the API key yourself.** Use `ctx.getApiKey()` / `ctx.api()`; offer an
  "API key…" button that calls `ctx.openHub()` if useful.
- **Window?** Add a launcher tab with `ctx.addLauncher({ label: '📊 Foo', onClick })` rather than
  placing your own floating button – the hub stacks all launchers neatly.
- **Respect the Torn API rules:** read-only, reasonable polling intervals, cache where possible,
  back off on error code 5 (too many requests).
- **Stick to plain browser JavaScript** – no imports, no build-time transpilation. The code runs
  as-is in Tampermonkey, Violentmonkey and Torn PDA.

### Testable logic

Put pure functions (parsing, calculations, state machines) into a separate file such as
`logic.js` – no DOM, no `ctx`, no `GM_*` – and list it before `module.js` in `files`. Tests load
it with `loadSource()`:

```js
// tests/my-module.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './helpers/load-source.mjs';

const { parseThing } = loadSource('src/modules/my-module/logic.js', ['parseThing']);

test('parseThing', () => {
  assert.equal(parseThing('42'), 42);
});
```

## 4. Document it

Create `docs/modules/my-module.md` (English). Suggested sections – see the existing pages:

1. One-paragraph summary + facts table (id, default, API access, API comment)
2. Setup
3. Usage / UI elements
4. Settings
5. How it works (API calls, caching, anything non-obvious)
6. Troubleshooting
7. Changelog

## 5. Build, test, release

```bash
npm run build   # regenerates dist/ and the README module table
npm test
```

Then:

1. Bump the hub version in `src/hub/hub.json` (minor for a new module, patch for fixes) and run
   `npm run build` again.
2. Add an entry to `CHANGELOG.md`.
3. Try the built `dist/torn-jin-scripthub.user.js` on torn.com: switch the module on and off a few
   times and check that nothing is left behind and the console shows no errors.
4. Commit sources **and** `dist/` together.

## Porting a standalone userscript

| Standalone | Module |
|---|---|
| `// ==UserScript==` header | `module.json` (`grants`, `connect`, `include`) |
| `(function () { … })()` wrapper | not needed – the build wraps each module |
| own API key field / `###PDA-APIKEY###` | `ctx.getApiKey()` / `ctx.api()` |
| `GM_getValue('x')` | `ctx.store.get('x')` |
| `GM_xmlhttpRequest({...})` | `ctx.request({...})` (promise) |
| `GM_notification` | `ctx.notify` |
| `document.head.appendChild(style)` | `ctx.addStyle(css)` |
| `document.body.appendChild(el)` | `ctx.mount(el)` |
| `window.addEventListener(...)` | `ctx.on(window, ...)` |
| `setInterval` / `setTimeout` | `ctx.setInterval` / `ctx.setTimeout` |
| "enabled" checkbox in the script | the hub's module switch |

Note that the hub's storage is separate from the old script's storage, so users have to
re-enter module settings once – mention it in the module's changelog.
