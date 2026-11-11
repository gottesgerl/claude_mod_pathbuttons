# Claude-Code-Mods von gottesgerl

Zwei Mods für Claude Code (Desktop-App, Windows), die zusammen eine Leiste über dem Prompt bilden.

| Mod | Was es tut |
| --- | --- |
| `path-buttons` | Ein farbiges Symbol pro Pfad aus den letzten Antworten, bei Bildern und Videos ein Vorschaubild. Linksklick öffnet, Rechtsklick kopiert den Pfad. |
| `handoff-button` | `⌾` für `/advisor opus`, `C` für `/compact`, `H` bittet um ein Handover, `⤓` komprimiert den Chat, benennt ihn in `[A]` um, startet einen neuen Chat `[B]` mit der Übergabe und archiviert den alten. Setzt die Buttons von `path-buttons` links neben das H. |

Das `handoff-button` braucht `path-buttons` nicht, und `path-buttons` braucht kein `handoff-button`. Ohne H stehen die Buttons allein in der Leiste. Mit beiden Mods stehen sie links neben dem H, dafür gibt `handoff-button` den Inhalt anderer Mods in der Leiste weiter.

## Installation

In einer PowerShell (Claude Code muss installiert sein, das Konto spielt keine Rolle):

```powershell
claude plugin marketplace add gottesgerl/claude_mod_pathbuttons
claude plugin install path-buttons@path-buttons
claude plugin install handoff-button@path-buttons
```

Danach Claude neu starten. Die Mods laufen in jeder neuen Sitzung, auch in der Desktop-App.

Update auf eine neue Version:

```powershell
claude plugin marketplace update path-buttons
claude plugin update path-buttons
claude plugin update handoff-button
```

Hast du ein Mod schon als eigenen Ordner unter `~/.claude/mods/` eingetragen (`CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`), entferne den Eintrag, sonst läuft das Mod doppelt.

### Claude die Pfade richtig schreiben lassen

Die Buttons erscheinen nur für Pfade, die Claude vollständig schreibt. Füge dazu diesen Abschnitt in `~/.claude/CLAUDE.md` ein (die Datei gilt für alle Projekte; gibt es sie nicht, lege sie an):

```markdown
## Pfade in Chat-Antworten als path-buttons

Der Mod `path-buttons` macht aus Pfaden in Antworten bunte Buttons, erkennt aber nur vollständige Pfade mit Laufwerksbuchstaben.

- Jede Datei und jeden Ordner als absoluten Windows-Pfad in Backticks schreiben, z. B. `C:\Projekte\beispiel\datei.png`.
- Keine relativen Pfade und keine Markdown-Links auf lokale Dateien.
- Höchstens 7 Pfade pro Antwort (der Mod hat 7 Farben), die wichtigsten zuerst.
```

Bei neuen Projekten muss nichts eingetragen werden: Der Hauptordner eines Projekts (der Ordner, in dem die Claude-Sitzung läuft) gilt automatisch als Basis für relative Pfade. Ein kurzer Pfad wie `docs\notizen.md` wird in jedem Projekt im jeweiligen Hauptordner gesucht, sobald `docs` unter [Relative Pfade](#relative-pfade-optional) als Ordner genannt ist.

## path-buttons

Jeder Pfad bekommt ein farbiges Zeichen. Dasselbe Zeichen steht im Antworttext vor dem Pfad und auf seinem Button, so ist klar, welcher Button zu welchem Pfad gehört. Die Form zeigt die Art:

| Art | Zeichen |
| --- | --- |
| Video | Herz ❤️🧡💚💙💛💜🤍 |
| Bild | Quadrat 🟥🟧🟩🟦🟨🟪⬜ |
| alles andere (Ordner, Text, sonstige Dateien) | Kreis 🔴🟠🟢🔵🟡🟣⚪ |

Im Text steht nur der Dateiname (bei Ordnern mit dem übergeordneten Ordner), der Button behält den vollen Pfad. In Codeblöcken stehen die Zeichen in einer Zeile darüber, damit der Copy-Button nur den reinen Pfad kopiert.

| Pfad | Öffnet in |
| --- | --- |
| Ordner | Directory Opus (springt zum Ordner, holt das Fenster nach vorn); ohne Opus im Windows Explorer |
| Bild oder Video (png, jpg, webp, bmp, gif, tif, exr, hdr, tga, dpx, mp4, mov, mkv, avi, webm, m4v, mxf) | Chaos Player; ohne ihn in der Standard-App |
| `.md`, `.txt` | Sidepanel in Claude, Markdown gerendert |
| alles andere | Standard-App von Windows |

Directory Opus und der Chaos Player werden in den Program-Files-Ordnern der Maschine gesucht, es ist nichts fest eingetragen. Sind sie nicht installiert, greift die Standard-App.

Die Buttons zeigen die Pfade der letzten Antworten, die neuesten rechts, höchstens sieben. Ist eine Auswahlbox offen, stehen sie in einer Zeile darüber.

In der Leiste:
- **Bilder und Videos** erscheinen als kleines, helles Schwarz-Weiß-Vorschaubild mit abgerundeten Ecken und einem Balken in der Farbe ihres Symbols oben und unten. Videos zeigen das Bild bei Sekunde 1. Die Vorschau erzeugt `ffmpeg` (gesucht unter `Program Files\ffmpeg\bin`, sonst im PATH) als kleines JPEG im Temp-Ordner. Ohne ffmpeg, oder bis die Vorschau fertig ist, steht das Symbol da.
- **Linksklick** öffnet den Pfad, **Rechtsklick** kopiert den vollen Pfad in die Zwischenablage (kurz erscheint „Pfad kopiert“).
- **Überfahren** zeigt den Dateinamen gedämpft links in der Leiste.

### Relative Pfade (optional)

Ohne Einstellung erkennt das Mod nur absolute Pfade. Soll es auch kurze Pfade wie `blender\shot01\frame.png` erkennen, nenne die ersten Ordner, ab denen das gilt. Sie werden dann im Projektordner der Sitzung gesucht. In `~/.claude/settings.json`:

```json
"pluginConfigs": {
  "path-buttons@path-buttons": {
    "options": {
      "relativeFolders": "blender, renders, docs",
      "aliases": "shot01=blender/shots/shot01"
    }
  }
}
```

- `relativeFolders`: erste Ordner, durch Komma getrennt.
- `aliases`: Kurzname=Ordner im Projekt, durch Semikolon getrennt. `shot01\frame.png` öffnet dann `<Projekt>\blender\shots\shot01\frame.png`.

Die beiden Felder lassen sich auch in Claude unter `/config` setzen.

Hinweise:
- Nur Windows, Pfade mit Laufwerksbuchstaben (`C:\...`, `P:/...`). Pfade mit Leerzeichen werden nur in Backticks erkannt.
- Zum Nach-vorn-Holen von Directory Opus wird kurz ein PowerShell-Skript in den Temp-Ordner geschrieben (`path-buttons-focus-opus.ps1`).

## handoff-button

Vier Buttons rechts in der Leiste über dem Prompt. Beim Überfahren steht links in der Leiste ein kurzer Hinweis, was der Button tut.

| Button | Was er tut |
| --- | --- |
| `⌾` | führt sofort `/advisor opus` aus |
| `C` | führt sofort `/compact` aus, ohne Nachfrage |
| `H` | schickt „Bitte schreib ein Handover.“, als hättest du es getippt |
| `⤓` | das volle Handover, siehe unten |

Der `⤓`-Button:
1. exportiert den Chat als `.txt` und `.pdf` nach `Dokumente\Claude Handoffs`,
2. lässt eine Übergabe schreiben,
3. benennt den Chat `… [A]`, leert ihn und startet ihn als `… [B]` mit der Übergabe,
4. zeigt im neuen Chat einen `<<`-Button, der das PDF des alten Chats öffnet.

Läuft gerade eine Antwort, wartet `H`, bis sie fertig ist. Geht `C` nicht, erscheint eine kurze Meldung.

`/import-chat` lädt einen exportierten Chat in den aktuellen Chat. Das PDF wird mit Microsoft Edge im Hintergrund erzeugt. Ist Edge nicht zu finden, entfällt das PDF.
