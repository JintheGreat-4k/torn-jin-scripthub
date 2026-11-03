# Plan: Rehab Reminder module

Status: **draft – open questions below must be answered before implementation.**

## Goal

A hub module that tells the player **on which day and by what time they have to take off for
Switzerland to rehab**, so that their company addiction penalty never exceeds a limit at the
company's end of day (EOD).

The player enters:

| Input | Example | Notes |
|---|---|---|
| Company EOD time | `18:00` TCT | When the company's day is evaluated. Torn City Time = UTC |
| Max. addiction | `-5` | Worst addiction penalty (company effectiveness) that is still acceptable at EOD |
| Travel class | Standard / Airstrip / WLT / Business | Determines the flight time to Switzerland |
| Safety buffer | `15` min | Slack for landing, clicking rehab, delays |
| Reminder lead time | `30` min | Notification this long before the latest take-off |

Output (panel + desktop notifications):

> **Next rehab:** Wed 05.11. — take off by **15:52 TCT** (16:52 local)
> Addiction now −3, projected −6 at Wed EOD (limit −5). Trend −1.1/day.

## Module facts

| | |
|---|---|
| id | `rehab-reminder` |
| icon | 🏥 |
| default | off (polls the API, sends notifications) |
| API access | Limited (to be confirmed in phase 0) |
| API comment | `RehabReminder` |
| files | `logic.js`, `module.js` |
| order | 30 |

Read-only API use only, as for every module – the module never travels or rehabs for the player.

## Phase 0 – verify the data source (before any code)

The addiction value is the crux. Candidates, to be checked with a real key:

1. **v1 `company/?selections=employees`** – each employee has
   `effectiveness.addiction` (negative number). Check whether a *non-director* employee key
   gets this field, or only the director.
2. **v2 company / user job endpoints** – check whether v2 exposes the own effectiveness
   breakdown for employees.
3. **Fallback: manual entry.** The player types the current addiction value from the company
   page; the module stores it with a timestamp. Always available, also used when the API field
   is missing.

Also check: `user/?selections=travel` (for "already flying / in Switzerland") and
`user/?selections=personalstats` (`rehabs`, drug counters) – optional signals, not required.

## How the calculation works (`logic.js`, pure + tested)

1. **History.** Every poll (and every manual entry) stores a snapshot `{ ts, addiction }`
   (deduplicated, max. ~30 days, ~1 per hour). A drop larger than the natural trend is treated
   as a rehab and resets the trend window.
2. **Trend.** Linear regression over the snapshots since the last rehab (min. 2 points / 12 h,
   otherwise "not enough data – enter values or wait"). Result: addiction change per day.
   Optional manual override "expected change per day" for players with a fixed drug routine.
3. **Next EOD instants.** `eodInstants(now, "HH:MM")` → the next N EOD timestamps (UTC).
4. **Critical day.** First EOD `E` where `projected(E) < maxAddiction`
   (more negative = worse). If the current value is already over the limit, `E` = next EOD.
5. **Latest take-off.** `departBy = E − flightTime(class) − buffer`.
   If `departBy` is already past: warn "too late for this EOD – fly now, next safe EOD is …".
6. **Flight times to Switzerland** (one way, minutes, to be verified):
   Standard 175 · Airstrip 123 · WLT 88 · Business 53.
   Only the outbound flight counts – the penalty drops as soon as the rehab is done.

Functions: `normalizeSettings`, `parseHHMM`, `eodInstants`, `addSnapshot`, `detectRehab`,
`trendPerDay`, `planRehab(now, settings, history) → { status, eod, departBy, projected, trend }`.
All covered by `tests/rehab-reminder.test.mjs` (time-zone edge cases, EOD just passed,
already over limit, no data, rehab detected).

## Runtime (`module.js`)

- **Launcher** `🏥 Rehab` → panel with: current value + age, limit, trend, next rehab
  (day, take-off TCT + local time, countdown), settings form, "enter value manually" field.
- **Polling** every 15 min (addiction changes slowly; respects API limits, backs off on
  error 5). Re-plan every minute locally without API calls.
- **Notifications** (`ctx.notify`): at `departBy − lead` ("Rehab: take off by 15:52") and at
  `departBy` ("Take off now"). Deduplicated across tabs via `ctx.store` (`notified:<eod>`), so
  several open Torn tabs ring only once – no leader election needed.
- **Suppress** reminders when the travel selection shows the player already flying to /
  staying in Switzerland, or when a rehab was detected after the reminder was planned.
- Everything through `ctx` (styles, timers, launcher) so switching off leaves no trace.

## Storage (`mod:rehab-reminder:*`)

| Key | Content |
|---|---|
| `settings` | `{ eod, maxAddiction, travelClass, bufferMin, leadMin, trendOverride, source }` |
| `history` | `[{ ts, addiction, src: 'api'|'manual' }]` |
| `notified` | `{ <eodTs>: ['lead','now'] }` (pruned) |
| `pos` | panel position |

## Deliverables

1. `src/modules/rehab-reminder/{module.json,logic.js,module.js}`
2. `tests/rehab-reminder.test.mjs`
3. `docs/modules/rehab-reminder.md` (summary, setup, usage, settings, how it works,
   troubleshooting, changelog 1.0.0)
4. Hub version 1.0.0 → **1.1.0**, `CHANGELOG.md` entry, `npm run build && npm test`,
   commit `dist/` with the sources.

## Open questions

1. **Director or employee?** Decides whether the addiction value can come from the API or has
   to be entered manually (phase 0).
2. **Limit semantics:** is "max. addiction" the effectiveness penalty shown in the company
   (e.g. `-5`), or something else?
3. **Travel class** used for rehab trips (or should it be selectable per trip)?
4. **Prediction vs. schedule:** compute the day from the trend (this plan), or simply a fixed
   rhythm ("every X days" / "every Wednesday") with the take-off time derived from EOD?
5. **Notifications:** desktop notification enough, or also a sound like the Chain Alarm?
