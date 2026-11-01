# Torn-Jin-Scripthub

Sammlung von Userscripts für [Torn City](https://www.torn.com), die über die offizielle **Torn API** laufen und ihre Ergebnisse direkt im Browser anzeigen – ohne Google Sheets oder externe Tools.

## Scripts

| Script | Beschreibung | Installieren | Doku |
|---|---|---|---|
| **Torn Stock ROI** | Alle Aktien sortiert nach Profitabilität: Dividenden-ROI, Kosten & ROI des nächsten Blocks, Portfolio-P/L | [Installieren](https://raw.githubusercontent.com/JintheGreat-4k/torn-jin-scripthub/main/scripts/torn-stock-roi.user.js) | [docs/torn-stock-roi.md](docs/torn-stock-roi.md) |

## Schnellstart

1. Userscript-Manager installieren: [Tampermonkey](https://www.tampermonkey.net/) oder [Violentmonkey](https://violentmonkey.github.io/) (Torn PDA wird ebenfalls unterstützt).
2. In der Tabelle oben auf **Installieren** klicken – der Manager öffnet automatisch den Installationsdialog.
3. Torn öffnen und im Script den API-Key eintragen (siehe jeweilige Doku).

Updates werden über `@updateURL` automatisch von diesem Repo bezogen.

## API-Key & Sicherheit

- Erstelle einen eigenen Key unter **Torn → Settings → API Keys**. Für die Scripts reicht **Limited Access**.
- Der Key wird nur lokal im Userscript-Speicher deines Browsers abgelegt und ausschliesslich an `api.torn.com` gesendet.
- Die Scripts lesen nur Daten und führen keine Aktionen im Spiel aus – sie entsprechen damit den [Torn-API-Regeln](https://www.torn.com/api.html).
- Alle Requests tragen `comment=StockROI` o. Ä., damit du sie in deinem API-Log zuordnen kannst.

## Repo-Struktur

```
scripts/   Userscripts (*.user.js)
docs/      Dokumentation pro Script
```

## Probleme / Wünsche

Bitte ein [Issue](https://github.com/JintheGreat-4k/torn-jin-scripthub/issues) eröffnen – bei Fehlern am besten die Fehlermeldung aus dem Script-Fenster mitschicken.
