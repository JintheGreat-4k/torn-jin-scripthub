# Notes for AI assistants

- This repo is a single Torn City userscript ("hub") built from `src/hub/` and `src/modules/<id>/`.
  Never edit `dist/` or the README module table by hand – run `npm run build`.
- New scripts become modules: follow `docs/adding-a-module.md` (copy `src/modules/_template/`).
- After any change: `npm run build && npm test`, bump the module version (`module.json`) and the
  hub version (`src/hub/hub.json`), update the module's doc changelog and `CHANGELOG.md`,
  and commit `dist/` together with the sources.
- Documentation and code comments are in English. Modules only read the Torn API (no in-game actions).
