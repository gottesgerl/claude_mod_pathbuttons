import type { Engine, Register } from 'claude-code'

// One round, single-colour emoji per path: the same dot sits in front of the path
// in the text and on its button, so the colour is the link between the two.
const DOTS = ['🔴', '🟠', '🟢', '🔵', '🟣', '🟡', '⚪']
const MAX_BUTTONS = DOTS.length

// Backticked paths may hold spaces; bare ones end at whitespace or quoting.
const PATH = /`([A-Za-z]:[\\/][^`\n]+)`|(?<![A-Za-z0-9])([A-Za-z]:[\\/][^\s`"'<>|*?()[\]]+)/g

// Path -> colour index, handed out in order of first sight and kept for the session,
// so a path keeps its colour wherever it shows up again.
const colours = new Map<string, number>()
let nextColour = 0

const clean = (raw: string) =>
  raw
    .trim()
    .replace(/[.,;:!]+$/, '')
    .replace(/:\d+(:\d+)?$/, '')
    .replace(/\//g, '\\')

function dotFor(path: string) {
  const key = path.toLowerCase()
  let index = colours.get(key)
  if (index === undefined) {
    index = nextColour++ % DOTS.length
    colours.set(key, index)
  }
  return DOTS[index]
}

// The distinct paths of a text, in order of appearance.
function pathsOf(text: string) {
  const found: string[] = []
  for (const match of text.matchAll(PATH)) {
    const path = clean(match[1] ?? match[2] ?? '')
    if (path.length > 3 && !found.some(known => known.toLowerCase() === path.toLowerCase())) {
      found.push(path)
    }
  }
  return found
}

// Folders go to Directory Opus, images and videos to the Chaos Player, the rest to
// the default app (explorer.exe). Each falls back to explorer.exe when not installed.
const OPUS_SUBPATH = '\\GPSoftware\\Directory Opus\\dopusrt.exe'
const CHAOS_SUBPATH = '\\Chaos\\Player\\chaosplayer_qt5.exe'
let OPUS = ''
let CHAOS_PLAYER = ''
let isResolved = false

// Looked up once per load in the Program Files folders of this machine: no install path is baked in.
async function resolvePrograms($: Engine) {
  if (isResolved) {
    return
  }
  isResolved = true
  const candidates = [
    await $.env.get('ProgramFiles'),
    await $.env.get('ProgramW6432'),
    await $.env.get('ProgramFiles(x86)'),
  ]
  const roots = candidates.filter((root, i): root is string => root !== undefined && candidates.indexOf(root) === i)
  for (const root of roots) {
    if (OPUS === '' && (await $.fs.exists(root + OPUS_SUBPATH))) {
      OPUS = root + OPUS_SUBPATH
    }
    if (CHAOS_PLAYER === '' && (await $.fs.exists(root + CHAOS_SUBPATH))) {
      CHAOS_PLAYER = root + CHAOS_SUBPATH
    }
  }
}

// Brings the Opus lister that shows a folder to the front. Written to the temp folder
// on use, so the mod needs no file of its own beside the module.
const FOCUS_OPUS = `# Brings the Directory Opus lister that shows the given folder to the front.
param([string]$Folder)
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class OpusWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte k, byte s, int f, int e);
  public static List<KeyValuePair<IntPtr,string>> Listers() {
    var r = new List<KeyValuePair<IntPtr,string>>();
    EnumWindows((h, l) => {
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      if (c.ToString() == "dopus.lister" && IsWindowVisible(h)) {
        var t = new StringBuilder(512); GetWindowText(h, t, 512);
        r.Add(new KeyValuePair<IntPtr,string>(h, t.ToString()));
      }
      return true;
    }, IntPtr.Zero);
    return r;
  }
  public static void Front(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    keybd_event(0x12, 0, 0, 0);          // a tap on Alt lets the call take the foreground
    SetForegroundWindow(h);
    keybd_event(0x12, 0, 2, 0);
  }
}
"@
$leaf = Split-Path $Folder -Leaf
$target = $null
for ($i = 0; $i -lt 12 -and $null -eq $target; $i++) {
  $listers = [OpusWin]::Listers()
  foreach ($l in $listers) { if ($l.Value -like "*$leaf*") { $target = $l.Key; break } }
  if ($null -eq $target) { Start-Sleep -Milliseconds 150 }
}
if ($null -eq $target -and $listers.Count -gt 0) { $target = $listers[0].Key }
if ($null -ne $target) { [OpusWin]::Front($target); "front" } else { "no lister" }
`

const MEDIA = /\.(png|jpe?g|webp|bmp|gif|tiff?|exr|hdr|tga|dpx|mp4|mov|mkv|avi|webm|m4v|mxf)$/i

// Text files show in a pane of this chat instead of an outside app.
const TEXT = /\.(md|txt)$/i
const VIEWER = 'path-viewer'
const VIEW_MAX_CHARS = 200000
let viewing: { path: string; text: string; isMarkdown: boolean } | undefined

async function view($: Engine, path: string) {
  const whole = String(await $.fs.read(path))
  const isCut = whole.length > VIEW_MAX_CHARS
  viewing = {
    path,
    text: isCut ? whole.slice(0, VIEW_MAX_CHARS) + '\n\n[... gekuerzt]' : whole,
    isMarkdown: /\.md$/i.test(path),
  }
  await $.ui.open({ id: VIEWER, title: path.split('\\').pop() ?? path })
  $.ui.invalidate('ui.render')
}

async function open($: Engine, path: string) {
  let kind: 'file' | 'dir' | 'other' | undefined
  try {
    kind = (await $.fs.stat(path)).kind
  } catch {
    kind = undefined
  }
  if (kind === undefined) {
    $.ui.toast('Pfad gibt es nicht: ' + path)
    return
  }
  const isFolder = kind === 'dir'
  if (!isFolder && TEXT.test(path)) {
    try {
      await view($, path)
    } catch (error) {
      $.ui.toast('Anzeigen fehlgeschlagen: ' + String(error).slice(0, 150))
    }
    return
  }
  await resolvePrograms($)
  let command = ['explorer.exe', path]
  if (isFolder && OPUS !== '') {
    // dopusrt talks to the running Opus: jump to the folder in a tab (an existing one if open).
    command = [OPUS, '/cmd', 'Go', path, 'NEWTAB=findexisting']
  } else if (!isFolder && MEDIA.test(path) && CHAOS_PLAYER !== '') {
    // A long-running player must not be a child of this call, which kills it after 30 s:
    // `start` hands it over and returns at once.
    command = ['cmd.exe', '/c', 'start', '', CHAOS_PLAYER, path]
  }
  try {
    const ran = await $.process.run(command)
    // The exit code of explorer.exe and of a launcher that hands over means nothing,
    // but Opus reporting an error is worth seeing.
    if (command[0] === OPUS && ran.exitCode !== 0) {
      $.ui.toast('Directory Opus: Exit ' + ran.exitCode + ' ' + ran.stderr.slice(0, 120))
    }
    if (command[0] === OPUS) {
      // Go switches the tab but leaves the window where it was: bring it forward.
      const temp = (await $.env.get('TEMP')) ?? 'C:\\Windows\\Temp'
      const script = temp + '\\path-buttons-focus-opus.ps1'
      await $.fs.write(script, FOCUS_OPUS)
      await $.process.run(
        ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Folder', path],
        { timeoutMs: 8000 },
      )
    }
  } catch (error) {
    $.ui.toast('Oeffnen fehlgeschlagen: ' + String(error).slice(0, 150))
  }
}

export const register: Register = on => {
  on('ui.render', { component: 'Pane', requestId: VIEWER }, async ($, e) => {
    const { Box, Text, Markdown } = $.ui.resolve(e)
    if (viewing === undefined) {
      return <Text dimColor>Keine Datei geoeffnet.</Text>
    }
    return (
      <Box flexDirection="column">
        <Text dimColor>{viewing.path}</Text>
        {viewing.isMarkdown ? <Markdown text={viewing.text} /> : <Text>{viewing.text}</Text>}
      </Box>
    )
  })

  // Paths in the transcript get their dot in front.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // A code block has a copy button, so no dot goes inside it: its dots stand on a
    // line above, in the order of its paths. Everywhere else the dot sits before the path.
    const inline = (part: string) =>
      part.replace(PATH, (whole, quoted, bare) => {
        const path = clean(quoted ?? bare ?? '')
        return path.length > 3 ? `${dotFor(path)} ${whole}` : whole
      })
    const text = e.props.text
      .split(/(^```[^\n]*\n[\s\S]*?^```[^\n]*$)/m)
      .map((part, i) =>
        i % 2 === 0 ? inline(part) : (() => {
          const dots = pathsOf(part).map(dotFor)
          return dots.length === 0 ? part : dots.join(' ') + '\n\n' + part
        })(),
      )
      .join('')
    return next(text === e.props.text ? e : { ...e, props: { ...e.props, text } })
  })

  // The buttons sit left of whatever the band holds beneath (the H button).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) {
      return below
    }

    const messages = await $.session.messages()
    // Newest replies first, until the buttons are full; shown oldest to newest.
    const paths: string[] = []
    for (const message of [...messages].reverse()) {
      if (message.role !== 'assistant') {
        continue
      }
      for (const path of pathsOf(message.text).reverse()) {
        if (paths.length < MAX_BUTTONS && !paths.some(known => known.toLowerCase() === path.toLowerCase())) {
          paths.push(path)
        }
      }
      if (paths.length >= MAX_BUTTONS) {
        break
      }
    }
    paths.reverse()
    if (paths.length === 0) {
      return below
    }

    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box justifyContent="flex-end">
        {paths.map((path, i) => (
          <Button key={'path-' + i} label={dotFor(path)} plain onPress={() => {
            $.clock.after(0, () => void open($, path))
          }} />
        ))}
        {below.type !== 'engine' && below}
      </Box>
    )
  })
}
