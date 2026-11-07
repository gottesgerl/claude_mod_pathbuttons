import type { Engine, Register } from 'claude-code'

// One round, single-colour emoji per path: the same dot sits in front of the path
// in the text and on its button, so the colour is the link between the two.
const DOTS = ['🔴', '🟠', '🟢', '🔵', '🟣', '🟡', '⚪']
const MAX_BUTTONS = DOTS.length

// Backticked paths may hold spaces; bare ones end at whitespace or quoting.
const PATH = /`([A-Za-z]:[\\/][^`\n]+)`|(?<![A-Za-z0-9])([A-Za-z]:[\\/][^\s`"'<>|*?()[\]]+)/g

// Short relative paths (`blender\shot\...`) resolve against the session's project folder (base).
// A relative path only counts when its first folder is one of the `relativeFolders` option
// or an alias, so ordinary words with a slash do not turn into buttons. An alias stands for a
// longer folder (`aliases` option: `name=folder\sub; name2=other`). Both empty: absolute paths only.
let base = ''
let ALIASES: Record<string, string> = {}
// Matches nothing until the options name a folder.
let REL = /(?!)()()/g

const listOf = (value: unknown) =>
  String(value ?? '')
    .split(/[,;]/)
    .map(part => part.trim())
    .filter(part => part !== '')

function configure(options: Readonly<Record<string, unknown>>) {
  ALIASES = {}
  for (const pair of listOf(options.aliases)) {
    const [name = '', target = ''] = pair.split('=').map(part => part.trim())
    if (name !== '' && target !== '') {
      ALIASES[name] = target.replace(/\//g, '\\').replace(/^\\+|\\+$/g, '')
    }
  }
  const roots = [...listOf(options.relativeFolders), ...Object.keys(ALIASES)]
  if (roots.length === 0) {
    REL = /(?!)()()/g
    return
  }
  const first = roots.map(root => root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  REL = new RegExp(
    '`((?:' + first + ')[\\\\/][^`\\n]+)`|(?<![A-Za-z0-9:\\\\/._-])((?:' + first + ')[\\\\/][^\\s`"\'<>|*?()[\\]]+)',
    'gi',
  )
}

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

// Icon for the kind of a path, then its dot: ▶ video, ▢ image, ≡ text (md, txt), 📁 folder (no extension), none for other files.
const VIDEO = /\.(mp4|mov|mkv|avi|webm|m4v|mxf)$/i
const IMAGE = /\.(png|jpe?g|webp|bmp|gif|tiff?|exr|hdr|tga|dpx)$/i
function markFor(path: string) {
  const last = path.split('\\').filter(part => part !== '').pop() ?? ''
  const icon = VIDEO.test(last)
    ? '▶'
    : IMAGE.test(last)
      ? '▢'
      : /\.(md|txt)$/i.test(last)
        ? '≡'
        : /\.[A-Za-z0-9]{1,5}$/.test(last)
          ? ''
          : '📁'
  return icon === '' ? dotFor(path) : `${icon} ${dotFor(path)}`
}

// A cleaned path as an absolute one: relative paths get the project folder (and their alias) in front.
function absolute(raw: string) {
  const path = clean(raw)
  if (/^[A-Za-z]:\\/.test(path)) {
    return path
  }
  if (base === '') {
    return ''
  }
  const [first = '', ...rest] = path.split('\\')
  const alias = Object.keys(ALIASES).find(key => key.toLowerCase() === first.toLowerCase())
  return base + '\\' + (alias === undefined ? path : [ALIASES[alias], ...rest].join('\\'))
}

// The project folder of the session, so relative paths open in the project the chat runs in.
async function syncBase($: Engine) {
  try {
    const root = (await $.session.root()).replace(/\//g, '\\').replace(/\\+$/, '')
    if (/^[A-Za-z]:\\/.test(root)) {
      base = root
    }
  } catch {
    // keep the last known folder
  }
}

// The distinct paths of a text (absolute and relative), in order of appearance, as absolute paths.
function pathsOf(text: string) {
  const hits = [...text.matchAll(PATH), ...text.matchAll(REL)]
    .map(match => ({ at: match.index ?? 0, raw: match[1] ?? match[2] ?? '' }))
    .sort((a, b) => a.at - b.at)
  const found: string[] = []
  for (const { raw } of hits) {
    const path = absolute(raw)
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

export const register: Register = (on, options) => {
  configure(options)

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
    await syncBase($)
    // A code block has a copy button, so no dot goes inside it: its dots stand on a
    // line above, in the order of its paths. Everywhere else the dot sits before the path,
    // which shows only as its file name (a folder with its parent); the button keeps the full path.
    const dotted = (whole: string, quoted?: string, bare?: string) => {
      const raw = quoted ?? bare ?? ''
      const path = absolute(raw)
      if (path.length <= 3) {
        return whole
      }
      const tail = quoted === undefined ? (raw.match(/[.,;:!]+$/)?.[0] ?? '') : ''
      // A last part without an extension is a folder: it shows with its parent, as many folders share a name.
      const parts = path.split('\\').filter(part => part !== '')
      const isFolder = !/\.[A-Za-z0-9]{1,5}$/.test(parts[parts.length - 1] ?? '')
      const name = parts.slice(isFolder ? -2 : -1).join('\\') || path
      return `${markFor(path)} \`${name}\`${tail}`
    }
    const inline = (part: string) => part.replace(PATH, dotted).replace(REL, dotted)
    const text = e.props.text
      .split(/(^```[^\n]*\n[\s\S]*?^```[^\n]*$)/m)
      .map((part, i) =>
        i % 2 === 0 ? inline(part) : (() => {
          const dots = pathsOf(part).map(markFor)
          return dots.length === 0 ? part : dots.join(' ') + '\n\n' + part
        })(),
      )
      .join('')
    return next(text === e.props.text ? e : { ...e, props: { ...e.props, text } })
  })

  // The buttons sit left of whatever the band holds beneath (the H button).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    await syncBase($)
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
    const buttons = (
      <Box justifyContent="flex-end">
        {paths.map((path, i) => (
          <Button key={'path-' + i} label={dotFor(path)} plain onPress={() => {
            $.clock.after(0, () => void open($, path))
          }} />
        ))}
        {!e.props.hasSurvey && below.type !== 'engine' && below}
      </Box>
    )
    // A survey or choice box holds the band: the buttons go on a row above it, the box stays untouched.
    return e.props.hasSurvey ? (
      <Box flexDirection="column">
        {buttons}
        {below}
      </Box>
    ) : (
      buttons
    )
  })
}
