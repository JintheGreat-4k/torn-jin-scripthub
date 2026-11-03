# 📈 Stock ROI

Shows every stock of the Torn stock market in one window on torn.com, ranked by profitability.
Replaces the usual stock-ROI spreadsheets.

| | |
|---|---|
| Module id | `stock-roi` |
| Default | on |
| API access | **Limited** (Public is enough for the market data, your own holdings need Limited) |
| API comment | `StockROI` |

## Setup

1. Enable **Stock ROI** in the 🧩 Hub (it is on by default) and make sure your API key is saved there.
2. Click the **📈 Stocks** tab on the left edge of the screen.

On the stock market page (`page.php?sid=stocks`) the window opens automatically. Otherwise it
remembers whether you left it open.

## Controls

| Element | Function |
|---|---|
| Column header | Sort (click again to reverse) |
| ☐ active dividends only | Hide stocks with passive benefits |
| ⟳ | Reload from the API (otherwise data is cached for 5 minutes) |
| ⚙ | Module settings (payout values) |
| Green bar on the left | You own this stock |

The default sort is **Next block ROI** – the order in which a purchase pays off most next.

## Columns

| Column | Meaning |
|---|---|
| Price | Current share price |
| Dividend | Benefit as reported by the API (e.g. `$50,000,000`, `1x Drug Pack`) |
| Value/payout | Estimated $ value of one payout (hover shows the source) |
| Days | Payout interval |
| Block (shares) | Shares required for the first benefit block (BB) |
| Block cost | Shares × price for the first block |
| ROI p.a. (1st block) | Yearly return ÷ block cost |
| Owned | Number of blocks you hold (hover: number of shares) |
| Missing for next | Shares you still need for the next block |
| Next block cost | Missing shares × price |
| Next block ROI | Yearly return ÷ cost of the next block |
| P/L | Profit/loss against your purchase prices |

The summary line shows portfolio value, total P/L and dividends per year (incl. yield).

## Calculation

- **Yearly return** = value of one payout × 365 ÷ interval (days)
- **Blocks:** Torn doubles the requirement for every further block. With requirement `R`, `n`
  blocks need `R × (2ⁿ − 1)` shares in total. The next block therefore costs `R × 2ⁿ` shares and its
  ROI halves each time.
- **P/L** = shares × current price − sum of (shares × purchase price) from your transactions.
- Passive benefits (discounts, boosts, …) have no $ value and are listed at the bottom without ROI.

### Payout valuation

| Benefit | Value |
|---|---|
| Cash (`$…`) | The amount itself |
| Items (`1x …`) | `market_value` from `torn/?selections=items` |
| Points | Cheapest offer on the points market (or manual) |
| Energy | Xanax market value ÷ 250 (or manual) |
| Nerve / Happy | Manual only (⚙) |
| Random property (HRG) | Manual only (⚙) |

## Settings (⚙)

| Field | Description |
|---|---|
| $ per energy | `0` = automatic (Xanax ÷ 250) |
| $ per nerve | Value of one nerve point |
| $ per happy | Value of one happy point |
| $ per point | `0` = automatic (points market) |
| $ per property (HRG) | Value of a random property |
| Manual value per payout | Overrides the value of one payout for a stock, e.g. `HRG=400m, TCC=60m` (suffixes `k`, `m`, `b` allowed) |

The API key itself is managed in the hub (**API key…** button).

## API calls

| Call | Purpose |
|---|---|
| `torn/?selections=stocks,items` | Prices, benefits, item market values |
| `user/?selections=stocks` | Your stocks & transactions |
| `market/?selections=pointsmarket` | Points price (optional) |

3 requests per load; results are cached for 5 minutes.

## Troubleshooting

| Message | Fix |
|---|---|
| `No API key set` | Save your key in the 🧩 Hub |
| `API error 2: Incorrect Key` | Check / recreate your key |
| `API error 16: Access level of this key is not high enough` | Use a **Limited Access** key |
| `Your stocks: …` in the summary line | Market data works, but your own holdings could not be loaded (usually the key level) |
| `no price – ⚙` / `set value in ⚙` | There is no market price for this benefit → enter a value in ⚙ |

## Changelog

- **1.1.0** – Now a Scripthub module: shared API key from the hub, launcher tab in the hub dock,
  English UI, can be switched on/off at runtime.
- **1.0.0** – First version (standalone userscript): ROI table, next block, P/L, settings, Torn PDA support.
