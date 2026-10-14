# Claude-Code-Mods von gottesgerl

Zwei Mods für Claude Code (Desktop-App, Windows), die zusammen eine Leiste über dem Prompt bilden.

| Mod | Was es tut |
| --- | --- |
| `path-buttons` | Runde Farb-Buttons, einer pro Pfad aus den letzten Antworten. Ein Klick öffnet den Pfad. |
| `handoff-button` | `H`-Button: komprimiert den Chat, benennt ihn in `[A]` um, startet einen neuen Chat `[B]` mit der Übergabe und archiviert den alten. Setzt die Buttons von `path-buttons` links neben das H. |

Das `handoff-button` braucht `path-buttons` nicht, und `path-buttons` braucht kein `handoff-button`. Ohne H stehen die Buttons allein in der Leiste. Mit beiden Mods stehen sie links neben dem H, dafür gibt `handoff-button` den Inhalt anderer Mods in der Leiste weiter.

## Installation

Im Terminal-Prompt von Claude Code (nicht in der Desktop-App):

```
/plugin install path-buttons --marketplace gottesgerl/claude_mod_pathbuttons
/plugin install handoff-button --marketplace gottesgerl/claude_mod_pathbuttons
```

Beim ersten Mal mit `y` das Marketplace hinzufügen, dann einen Bereich wählen (User). Die Mods laufen danach in jeder neuen Sitzung, auch in der Desktop-App.

Update nach neuen Versionen: `claude plugin update path-buttons` und `claude plugin update handoff-button`.

Hast du `handoff-button` schon als eigenen Ordner unter `~/.claude/mods/` eingetragen (`CLAUDE_CODE_PLUGIN_DIRS`), entferne den Eintrag und den Ordner, sonst läuft das Mod doppelt.

## path-buttons

Jeder Pfad bekommt einen Farbpunkt (🔴🟠🟢🔵🟣🟡⚪). Derselbe Punkt steht im Antworttext vor dem Pfad, so ist klar, welcher Button zu welchem Pfad gehört. In Codeblöcken steht der Punkt in einer Zeile darüber, damit der Copy-Button nur den reinen Pfad kopiert.

| Pfad | Öffnet in |
| --- | --- |
| Ordner | Directory Opus (springt zum Ordner, holt das Fenster nach vorn); ohne Opus im Windows Explorer |
| Bild oder Video (png, jpg, webp, bmp, gif, tif, exr, hdr, tga, dpx, mp4, mov, mkv, avi, webm, m4v, mxf) | Chaos Player; ohne ihn in der Standard-App |
| `.md`, `.txt` | Sidepanel in Claude, Markdown gerendert |
| alles andere | Standard-App von Windows |

Directory Opus und der Chaos Player werden in den Program-Files-Ordnern der Maschine gesucht, es ist nichts fest eingetragen. Sind sie nicht installiert, greift die Standard-App.

Die Buttons zeigen die Pfade der letzten Antworten, die neuesten rechts, höchstens sieben.

Hinweise:
- Nur Windows, Pfade mit Laufwerksbuchstaben (`C:\...`, `P:/...`). Pfade mit Leerzeichen werden nur in Backticks erkannt.
- Zum Nach-vorn-Holen von Directory Opus wird kurz ein PowerShell-Skript in den Temp-Ordner geschrieben (`path-buttons-focus-opus.ps1`).

## handoff-button

Der `H`-Button in der Leiste über dem Prompt:
1. exportiert den Chat als `.txt` und `.pdf` nach `Dokumente\Claude Handoffs`,
2. lässt eine Übergabe schreiben,
3. benennt den Chat `… [A]`, leert ihn und startet ihn als `… [B]` mit der Übergabe,
4. zeigt im neuen Chat einen `<<`-Button, der das PDF des alten Chats öffnet.

`/import-chat` lädt einen exportierten Chat in den aktuellen Chat. Das PDF wird mit Microsoft Edge im Hintergrund erzeugt. Ist Edge nicht zu finden, entfällt das PDF.
