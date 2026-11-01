# ⛓ Chain Alarm

Rings (and sends a desktop notification) when your faction's chain timer drops below a
threshold – so you never lose a chain because nobody noticed the timer. It reads the timer from
the Torn API only (no page scraping), keeps working in background tabs, and makes sure that only
one of your Torn tabs polls and rings.

| | |
|---|---|
| Module id | `chain-alarm` |
| Default | **off** (it polls the API continuously, so you opt in) |
| API access | **Minimal** with the default source (`user/bars`); Public for the faction sources |
| API comment | `ChainAlarm` |

## Setup

1. Save your API key in the 🧩 Hub and switch **Chain Alarm** on.
2. A small floating panel appears (top right by default). **Click anywhere on the page once** –
   browsers only allow sound after a user interaction. The yellow hint disappears once sound is unlocked.
3. Optionally press **Test sound** and adjust the settings.

## The panel

| Element | Meaning |
|---|---|
| `Chain 1,234 / 2.5k` | Current chain length / next bonus maximum |
| Big timer | Locally counted-down chain timer: green → yellow (threshold + 1 min) → red (below threshold) |
| Status line | Result of the last API poll. Hover for the raw API response and diagnostics |
| `● monitoring` | This tab polls the API and rings |
| `○ other tab` | Another Torn tab is monitoring; this one only mirrors the display |
| `⚠ disabled` | Duplicate copy in this tab (see below) |
| **Stop alarm** | Mutes the current alarm until the next hit (works from any tab) |
| **Test sound** | Plays the alarm sound once |

Drag the header to move the panel; click the header to collapse/expand it. Position and
collapsed state are remembered.

While the alarm is active the panel blinks red and the sound repeats until the timer goes back
above *threshold + 15 s* (hysteresis), the chain ends, or you press **Stop alarm**.

## Settings

| Setting | Default | Description |
|---|---|---|
| Source | v1 user/bars | Which API endpoint provides the chain data (see below) |
| Alarm below (min) | 2 | Alarm when the timer falls below this many minutes |
| From chain length | 10 | No alarm for chains shorter than this |
| Interval (sec) | 10 | Poll interval (minimum 5 s). The Torn API caches responses for ~30 s anyway |
| Sound URL | – | Optional mp3/ogg/wav URL instead of the built-in beep |

**Test sources** queries all sources once and shows their results side by side – handy if one
endpoint misbehaves. **API key…** opens the hub. To switch the alarm off completely, use the
module switch in the hub.

### Sources

| Source | Endpoint | Key level |
|---|---|---|
| v1 user/bars *(recommended)* | `user/?selections=bars` | Minimal |
| v2 /user/bars | `v2/user/bars` | Minimal |
| v2 /faction/chain | `v2/faction/chain` | Public |
| v1 faction/chain | `faction/?selections=chain` | Public (was buggy in the past) |

## How it works

- **Local countdown.** Each API response gives the remaining `timeout`; the module turns it into
  a deadline and counts down locally every 500 ms.
- **Cache awareness.** Torn API responses can be up to ~30 s old. The module never moves the timer
  *up* for the same chain length, ignores responses with a shorter chain than already seen
  (stale cache), and only accepts "chain ended" if it is plausible (timer nearly out or maximum reached).
- **One tab monitors.** Tabs elect a leader through shared userscript storage (heartbeat every 2 s,
  takeover after 6 s). Tabs with unlocked audio are preferred. Other tabs mirror the leader's state,
  so you see the same timer everywhere and a mute in any tab silences the leader.
- **Background tabs.** The clock runs in a Web Worker because browsers throttle timers in hidden
  tabs; if the worker is blocked it falls back to `setInterval` (shown in the status tooltip).
- **Duplicate guard.** If the old standalone *Torn Chain-Alarm* userscript is still installed, both
  notice each other in the same tab; the later one disables itself and shows a warning. Remove the
  standalone script in that case.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No sound | Click the page once (yellow hint). Check that the tab/browser is not muted |
| `No API key – set it in the 🧩 Hub` | Save your key in the hub |
| `API error 2` / `16` / `10` … | Key problem – polling backs off to once a minute; check the key and its level |
| `API error 5` | Too many requests – polling backs off for a minute; raise the interval or reduce other tools |
| `○ other tab` everywhere but no alarm | The monitoring tab may have been closed – another tab takes over within ~6 s |
| `⚠ Chain Alarm is running more than once` | Remove the old standalone script from Tampermonkey |
| Custom sound shows an error in *Test sound* | The URL must serve an audio file directly; your manager may ask to allow the domain (`@connect`) |

## Changelog

- **1.1.0** – Now a Scripthub module: shared API key from the hub, switchable at runtime
  (switching off cleans up the panel, worker, audio and tab leadership), English UI.
  The "monitoring active" checkbox was replaced by the hub's module switch.
- **1.0.0** – First version (standalone userscript "Torn Chain-Alarm").
