# Branch- & Backup-Übersicht

Kurzreferenz, **wo was abgelegt ist**. Stand: 2026-07-08 (nach Rollback von `main`
auf den stabilen Stand).

## Wo liegt was?

| Branch | Inhalt / Zweck | Stand (Commit) |
|---|---|---|
| **`main`** | ✅ **Stabil & live** auf GitHub Pages. Basis-App (Kamerawahl + Zoom), **ohne** Preisvergleich/Scraper. | `723920c`-Inhalt (Merge `3a29f81`) |
| `backup/main-dev-2026-07-08` | 🔒 Sicherung des kompletten **in-Entwicklung**-Stands: Preisvergleich **+** externer Scraper. | `f040dc9` |
| `backup/main-2026-06-12` | 🔒 Ältere Sicherung des stabilen Stands (identisch zum aktuellen `main`-Inhalt). | `723920c` |
| `claude/webshop-price-comparison-login-aj8nar` | 🛠️ **Aktive Weiterentwicklung**: Preisvergleich, externer Scraper (`scraper/`), `getWorkList`-Endpunkt, TODO-Checkliste. | `f1acc00` |

> Hinweis: Der Live-Deploy (GitHub Pages) folgt **immer `main`** — jeder Push/Merge
> auf `main` löst `.github/workflows/deploy.yml` aus.

## Was steckt im Feature-Stand (Preisvergleich + Scraper)?

Enthalten in `backup/main-dev-2026-07-08` und im Feature-Branch:
- `apps-script/Preise.gs` — nächtlicher Preis-Trigger + `handleGetWorkList`.
- `apps-script/Code.gs` — Actions `getProductSuppliers` (mit Preisen), `pushPrices`, `getWorkList`.
- `scraper/` — eigenständiger Node-Dienst (HTTP/Playwright) für `external`-Shops.
- `TODO.md` — Inbetriebnahme-Checkliste für den Scraper.

## Feature wieder aktivieren (auf `main` bringen)

Wenn der Preisvergleich/Scraper fertig getestet ist:

```bash
# Weiterarbeit auf dem Feature-Branch, dann per Pull Request nach main mergen:
git checkout claude/webshop-price-comparison-login-aj8nar
# … committen/pushen … → PR gegen main öffnen und mergen
```

Der Feature-Branch ist gegenüber dem aktuellen `main` divergiert (durch den
Rollback). Vor einem erneuten PR ggf. `main` in den Branch mergen bzw. den Branch
auf `main` rebasen, damit der PR sauber nur die gewünschten Änderungen zeigt.

## Erneut zurückrollen (falls nötig)

`main` inhaltlich auf einen bekannten Gut-Stand setzen — **ohne** History-Rewrite,
als Vorwärts-Commit (so wie beim letzten Rollback via PR #16):

```bash
STABLE=723920c   # gewünschter Gut-Stand
git fetch origin main
git checkout -B rollback/main-to-stable origin/main
NEW=$(git commit-tree "$STABLE^{tree}" -p origin/main -m "revert: Rollback von main auf $STABLE")
git reset --hard "$NEW"
git push -u origin rollback/main-to-stable
# → PR gegen main öffnen und mergen (Force-Push auf main wird vermieden)
```

Vorher immer den aktuellen `main` sichern:
`git branch backup/main-<datum> origin/main && git push origin backup/main-<datum>`.

## Aufräum-Notiz

`rollback/main-to-stable-723920c` wurde lokal gelöscht; der Remote-Rest ist
harmlos (vollständig in `main` gemergt) und kann im GitHub-UI unter *Branches*
entfernt werden — Branch-Löschen per Push ist in dieser Umgebung gesperrt.
