# Torn Stock ROI

Zeigt alle Aktien des Torn Stock Market in einem Fenster direkt auf torn.com – sortiert nach Profitabilität. Ersetzt die üblichen Stock-ROI-Sheets.

**Installieren:** [torn-stock-roi.user.js](https://raw.githubusercontent.com/JintheGreat-4k/torn-jin-scripthub/main/scripts/torn-stock-roi.user.js)

## Einrichtung

1. Script installieren (Tampermonkey / Violentmonkey).
2. Auf torn.com links am Rand auf **📈 Stocks** klicken.
3. Beim ersten Start öffnen sich die Einstellungen (⚙): API-Key (Limited Access) eintragen → **Speichern**.

Auf der Aktien-Seite (`page.php?sid=stocks`) öffnet sich das Fenster automatisch. In **Torn PDA** wird der Key automatisch über den Platzhalter `###PDA-APIKEY###` eingesetzt.

## Bedienung

| Element | Funktion |
|---|---|
| Spaltenkopf anklicken | Sortieren (nochmals klicken = Richtung umkehren) |
| ☐ nur aktive Dividenden | Aktien mit passiven Boni ausblenden |
| ⟳ | Daten neu von der API laden (sonst 5 Min. Cache) |
| ⚙ | Einstellungen |
| grüner Balken links | Aktie ist in deinem Besitz |

Standard-Sortierung ist **ROI nächster** – also die Reihenfolge, in der sich ein Kauf als Nächstes am meisten lohnt.

## Spalten

| Spalte | Bedeutung |
|---|---|
| Kurs | Aktueller Aktienkurs |
| Dividende | Benefit laut API (z. B. `$50,000,000`, `1x Drug Pack`) |
| Wert/Ausz. | Geschätzter $-Wert einer Auszahlung (Hover zeigt die Quelle) |
| Tage | Auszahlungsintervall |
| Block (Aktien) | Benötigte Aktien für den ersten Benefit Block (BB) |
| Block-Kosten | Aktien × Kurs für den ersten Block |
| ROI p.a. (1. Block) | Jahresertrag ÷ Block-Kosten |
| Besitz | Anzahl Blöcke, die du hältst (Hover: Anzahl Aktien) |
| Fehlt f. nächsten | Aktien, die dir bis zum nächsten Block fehlen |
| Kosten nächster | Fehlende Aktien × Kurs |
| ROI nächster | Jahresertrag ÷ Kosten des nächsten Blocks |
| P/L | Gewinn/Verlust gegenüber deinen Kaufpreisen |

Oben werden zusätzlich Portfolio-Wert, Gesamt-P/L und Dividenden pro Jahr (inkl. Rendite) angezeigt.

## Berechnung

- **Jahresertrag** = Wert einer Auszahlung × 365 ÷ Intervall (Tage)
- **Blöcke:** Torn verdoppelt die Anforderung pro weiterem Block. Bei Anforderung `R` brauchst du für `n` Blöcke insgesamt `R × (2ⁿ − 1)` Aktien. Der nächste Block kostet also `R × 2ⁿ` Aktien und sein ROI halbiert sich jeweils.
- **P/L** = Aktien × aktueller Kurs − Summe (Aktien × Kaufpreis) aus deinen Transaktionen.
- Passive Benefits (Rabatte, Boni usw.) haben keinen $-Wert und stehen ohne ROI unten in der Liste.

### Bewertung der Auszahlungen

| Benefit | Wert |
|---|---|
| Cash (`$…`) | Betrag direkt |
| Items (`1x …`) | `market_value` aus `torn/?selections=items` |
| Points | Günstigstes Angebot im Points-Markt (oder manuell) |
| Energy | Xanax-Marktwert ÷ 250 (oder manuell) |
| Nerve / Happy | nur manuell in ⚙ |
| Random Property (HRG) | nur manuell in ⚙ |

## Einstellungen (⚙)

| Feld | Beschreibung |
|---|---|
| API-Key | Dein Torn-API-Key (Limited Access) |
| $ pro Energy | `0` = automatisch (Xanax ÷ 250) |
| $ pro Nerve | Wert pro Nerve-Punkt |
| $ pro Happy | Wert pro Happy-Punkt |
| $ pro Point | `0` = automatisch (Points-Markt) |
| $ pro Property (HRG) | Wert einer Random Property |
| Manuelle Werte | Überschreibt den Wert pro Auszahlung einer Aktie, z. B. `HRG=400m, TCC=60m` (Suffixe `k`, `m`, `b` erlaubt) |

## Verwendete API-Aufrufe

| Aufruf | Zweck |
|---|---|
| `torn/?selections=stocks,items` | Kurse, Benefits, Item-Marktwerte |
| `user/?selections=stocks` | Eigene Aktien & Transaktionen |
| `market/?selections=pointsmarket` | Points-Preis (optional) |

Pro Laden sind das 3 Requests; Ergebnisse werden 5 Minuten gecacht.

## Fehlerbehebung

| Meldung | Lösung |
|---|---|
| `Kein API-Key gesetzt` | Key unter ⚙ eintragen |
| `API-Fehler 2: Incorrect Key` | Key prüfen / neu erstellen |
| `API-Fehler 16: Access level of this key is not high enough` | Key mit **Limited Access** verwenden |
| `User-Stocks: …` oben in der Zusammenfassung | Marktdaten funktionieren, eigene Aktien konnten nicht geladen werden (meist Key-Level) |
| `kein Preis – ⚙` / `Wert in ⚙` | Für diesen Benefit gibt es keinen Marktpreis → Wert in ⚙ eintragen |

## Changelog

- **1.0.0** – Erste Version: ROI-Tabelle, nächster Block, P/L, Einstellungen, Torn-PDA-Support.
