# path-buttons

Ein Mod für Claude Code (Desktop-App, Windows). Nennt Claude in einer Antwort Pfade, erscheinen links neben dem Prompt runde, einfarbige Buttons, einer pro Pfad. Ein Klick öffnet den Pfad.

Jeder Pfad bekommt einen Farbpunkt (🔴🟠🟢🔵🟣🟡⚪). Derselbe Punkt steht im Antworttext vor dem Pfad, so ist klar, welcher Button zu welchem Pfad gehört. In Codeblöcken steht der Punkt in einer Zeile darüber, damit der Copy-Button nur den reinen Pfad kopiert.

## Was ein Klick öffnet

| Pfad | Öffnet in |
| --- | --- |
| Ordner | Directory Opus (springt zum Ordner, holt das Fenster nach vorn); ohne Opus im Windows Explorer |
| Bild oder Video (png, jpg, webp, bmp, gif, tif, exr, hdr, tga, dpx, mp4, mov, mkv, avi, webm, m4v, mxf) | Chaos Player; ohne ihn in der Standard-App |
| `.md`, `.txt` | Sidepanel in Claude, Markdown gerendert |
| alles andere | Standard-App von Windows |

Directory Opus und der Chaos Player werden in den Program-Files-Ordnern der Maschine gesucht, es ist nichts fest eingetragen. Sind sie nicht installiert, greift die Standard-App.

Die Buttons zeigen die Pfade der letzten Antworten, die neuesten rechts, höchstens sieben.

## Installation

Im Terminal-Prompt von Claude Code:

```
/plugin install path-buttons --marketplace <owner>/<repo>
```

Mit `y` das Marketplace hinzufügen, dann einen Bereich wählen (User). Das Mod läuft danach in jeder neuen Sitzung.

Ohne Marketplace: den Ordner kopieren und in `~/.claude/settings.json` eintragen:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/path-buttons", "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1" } }
```

## Hinweise

- Nur Windows, Pfade mit Laufwerksbuchstaben (`C:\...`, `P:/...`). Pfade mit Leerzeichen werden nur in Backticks erkannt.
- Neben dem H-Button des Mods `handoff-button` stehen die Buttons nur, wenn dieses Mod auch den Inhalt anderer Mods übernimmt (`await next(e)` im `AbovePrompt`-Hook). Ohne H-Button stehen sie allein in der Leiste.
- Zum Öffnen von Directory Opus wird kurz ein PowerShell-Skript in den Temp-Ordner geschrieben (`path-buttons-focus-opus.ps1`).
