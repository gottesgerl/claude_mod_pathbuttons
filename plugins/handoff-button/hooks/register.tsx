import type { Engine, Register } from 'claude-code'

const SESSIONS = 'ccd_session_mgmt'
const VERSION = /\s\[([A-Z])\]\s*$/
const AFTER_CLEAR_MS = 2000
const IMPORT_MAX_CHARS = 200000
const IMPORT_PANE = 'import-chat'
const EDGE_SUBPATH = '\\Microsoft\\Edge\\Application\\msedge.exe'

// Resolved per machine and user on first use: no user name or install path is baked in.
let EXPORT_DIR = ''
let EDGE = ''

async function resolvePaths($: Engine) {
  if (EXPORT_DIR === '') {
    const home = (await $.env.get('USERPROFILE')) ?? 'C:\\Users\\Public'
    EXPORT_DIR = home + '\\Documents\\Claude Handoffs'
  }
  if (EDGE === '') {
    const candidates = [
      ((await $.env.get('ProgramFiles(x86)')) ?? 'C:\\Program Files (x86)') + EDGE_SUBPATH,
      ((await $.env.get('ProgramFiles')) ?? 'C:\\Program Files') + EDGE_SUBPATH,
    ]
    for (const candidate of candidates) {
      if (await $.fs.exists(candidate)) {
        EDGE = candidate
        break
      }
    }
  }
}

const textOf = (result: { content: { type: string; text?: string }[] }) =>
  result.content.map(block => block.text ?? '').join('\n')

let isRunning = false
let logText = ''
let pendingHandoff: string | undefined
type Back = { id: string; title: string; path: string; pdf?: string }

let pendingBack: Omit<Back, 'id'> | undefined
let backTo: Back | undefined
let backFor = ''

// Drops what the app injects into user messages (system reminders, command
// caveats), which the person never typed.
const clean = (text: string) =>
  text
    .replace(/<(system-reminder|local-command-caveat)>[\s\S]*?<\/\1>/g, '')
    .trim()

const escapeHtml =(text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Prints the chat to a PDF with headless Edge; undefined when that fails.
async function makePdf(
  $: Engine,
  title: string,
  messages: readonly { role: string; text: string; toolUses: readonly { name: string }[] }[],
  pdfPath: string,
) {
  if (EDGE === '') {
    await log($, 'pdf skipped: Microsoft Edge not found')
    return undefined
  }
  try {
    const rows = messages
      .filter(m => m.text.trim() !== '' || m.toolUses.length > 0)
      .map(m => {
        const who = m.role === 'user' ? 'Du' : 'Claude'
        const tools = m.toolUses.length === 0
          ? ''
          : `<div class="tools">${m.toolUses.map(use => escapeHtml(use.name)).join(' · ')}</div>`
        return `<div class="msg ${m.role}"><div class="who">${who}</div><div class="text">${escapeHtml(m.text)}</div>${tools}</div>`
      })
      .join('\n')
    const html =
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>` +
      'body{font:11pt/1.45 "Segoe UI",sans-serif;color:#222;margin:0}' +
      'h1{font-size:16pt;margin:0 0 4pt}.date{color:#888;font-size:9pt;margin-bottom:14pt}' +
      '.msg{margin:0 0 10pt;padding:8pt 10pt;border-radius:6pt;break-inside:avoid-page}' +
      '.user{background:#f1efe8}.assistant{border-left:3pt solid #d97757}' +
      '.who{font-weight:600;font-size:9pt;color:#666;margin-bottom:3pt}' +
      '.text{white-space:pre-wrap;word-wrap:break-word}.tools{color:#999;font-size:8.5pt;margin-top:4pt}' +
      '@page{margin:16mm}</style></head><body>' +
      `<h1>${escapeHtml(title)}</h1><div class="date">${new Date().toLocaleString('de-DE')}</div>${rows}</body></html>`
    const htmlPath = EXPORT_DIR + '\\.tmp\\chat.html'
    await $.fs.write(htmlPath, html)
    const url = 'file:///' + encodeURI(htmlPath.replace(/\\/g, '/'))
    const ran = await $.process.run([
      EDGE,
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      '--user-data-dir=' + EXPORT_DIR + '\\.tmp\\edge-profile',
      '--print-to-pdf=' + pdfPath,
      url,
    ], { timeoutMs: 90000 })
    if (!(await $.fs.exists(pdfPath))) {
      await log($, 'pdf failed: exit ' + ran.exitCode + ' ' + ran.stderr.slice(0, 300))
      return undefined
    }
    await log($, 'pdf ok: ' + pdfPath)
    return pdfPath
  } catch (error) {
    await log($, 'pdf error: ' + String(error))
    return undefined
  }
}

async function openPdf($: Engine, back: Back) {
  if (back.pdf === undefined || !(await $.fs.exists(back.pdf))) {
    $.ui.toast('Fuer "' + back.title + '" gibt es kein PDF. Mit /import-chat kannst du den Verlauf laden.')
    return
  }
  try {
    // explorer.exe opens the file in the default PDF viewer; its exit code means nothing.
    await $.process.run(['explorer.exe', back.pdf])
    await log($, 'opened pdf: ' + back.pdf)
  } catch (error) {
    await log($, 'open pdf failed: ' + String(error))
    $.ui.toast('PDF liess sich nicht oeffnen: ' + back.pdf)
  }
}

// C button: runs /compact straight away. The desktop app's session is headless, where
// $.session.compact is refused, so the command runs as /compact does; a typed /compact is the last resort.
async function compact($: Engine) {
  try {
    const ran = await $.command.run({ command: 'compact' })
    await log($, 'compact via command: ' + JSON.stringify(ran).slice(0, 200))
    return
  } catch (error) {
    await log($, 'compact command error: ' + String(error))
  }
  try {
    await $.prompt.submit({ text: '/compact', asUser: true })
    await log($, 'compact submitted as prompt')
  } catch (error) {
    await log($, 'compact prompt error: ' + String(error))
    $.ui.toast('Compact ging nicht: ' + String(error).slice(0, 200))
  }
}

// ⌾ button: runs /advisor opus straight away, the same way C runs /compact.
async function advisor($: Engine) {
  try {
    const ran = await $.command.run({ command: 'advisor', args: 'opus' })
    await log($, 'advisor via command: ' + JSON.stringify(ran).slice(0, 200))
    return
  } catch (error) {
    await log($, 'advisor command error: ' + String(error))
  }
  try {
    await $.prompt.submit({ text: '/advisor opus', asUser: true })
    await log($, 'advisor submitted as prompt')
  } catch (error) {
    await log($, 'advisor prompt error: ' + String(error))
    $.ui.toast('Advisor ging nicht: ' + String(error).slice(0, 200))
  }
}

// H button: asks for a handover, as if the person had typed it. It runs once the chat is idle.
async function askHandover($: Engine) {
  try {
    await $.prompt.submit({ text: 'Bitte schreib ein Handover.', asUser: true })
  } catch (error) {
    $.ui.toast('Handover ging nicht: ' + String(error).slice(0, 200))
  }
}

async function log($: Engine, line: string) {
  await resolvePaths($)
  logText += new Date().toISOString() + ' ' + line + '\n'
  try {
    await $.fs.write(EXPORT_DIR + '\\handoff-log.txt', logText)
  } catch {
    // logging must never break the handoff
  }
}

async function handoff($: Engine, isWorking: boolean) {
  if (isWorking) {
    $.ui.toast('Handoff: erst warten, bis der Chat fertig geantwortet hat.')
    return
  }
  if (isRunning) {
    $.ui.toast('Handoff laeuft bereits.')
    return
  }
  isRunning = true
  await resolvePaths($)
  logText = ''
  await log($, 'start')

  try {
    const info = await $.mcp.call(SESSIONS, 'get_session', { session_id: 'self' })
    let title = 'Chat'
    try {
      title = JSON.parse(textOf(info)).title ?? title
    } catch {
      // keep the fallback title
    }

    const match = VERSION.exec(title)
    const base = match ? title.slice(0, match.index) : title
    const letter = match ? match[1] : 'A'
    const next = String.fromCharCode(letter.charCodeAt(0) + 1)
    const oldTitle = match ? title : `${base} [A]`
    const newTitle = `${base} [${next}]`

    // 1. Export the whole conversation, before compaction shortens it.
    const messages = (await $.session.messages()).map(m => ({ ...m, text: clean(m.text) }))
    const body = messages
      .filter(m => m.text !== '' || m.toolUses.length > 0)
      .map(m => {
        const tools = m.toolUses.map(use => `  [tool] ${use.name}`).join('\n')
        return `### ${m.role}\n${m.text}${tools === '' ? '' : `\n${tools}`}`
      })
      .join('\n\n')
    const fileName = oldTitle.replace(/[\\/:*?"<>|]/g, '_') + '.txt'
    const path = EXPORT_DIR + '\\' + fileName
    await $.fs.write(path, `${oldTitle}\n\n${body}\n`)
    await log($, 'export ok: ' + path)
    const pdf = await makePdf($, oldTitle, messages, EXPORT_DIR + '\\' + fileName.replace(/\.txt$/, '.pdf'))

    // 2. Summarise: $.session.compact is not available in the desktop app, so ask the model.
    await log($, 'summary start')
    const ask =
      'Schreibe eine Uebergabe fuer einen neuen Chat: Ziel, Stand, getroffene Entscheidungen, offene Punkte, wichtige Dateien und Pfade, naechste Schritte. Knapp, nur die Uebergabe.'
    let summary = ''
    try {
      const forked = await $.model.fork({ prompt: ask })
      if (forked.isAnswered) {
        summary = forked.text
      } else {
        await log($, 'fork failed: ' + forked.reason)
        const done = await $.model.complete({
          model: 'haiku',
          prompt: ask + '\n\nChat:\n' + body.slice(-60000),
        })
        summary = done.isAnswered ? done.text : ''
        await log($, 'complete answered: ' + done.isAnswered)
      }
    } catch (error) {
      await log($, 'summary error: ' + String(error))
    }
    if (summary === '') {
      summary = '(Keine Zusammenfassung moeglich, lies den vollen Verlauf in der Datei.)'
    }
    await log($, 'summary ok, ' + summary.length + ' chars')

    // 3. Rename, then clear; the handoff goes in once the cleared chat is up.
    await $.mcp.call(SESSIONS, 'set_session_title', { session_id: 'self', title: newTitle })
    pendingBack = { title: oldTitle, path, pdf }
    pendingHandoff =
      `Handoff aus dem vorherigen Chat "${oldTitle}" (voller Verlauf: ${path}):\n\n${summary}\n\n` +
      'Nutze diese Uebergabe als Kontext und mach bei der naechsten Nachricht genau da weiter.'
    await log($, 'title ok, clearing')
    let isCleared = false
    try {
      const cleared = await $.mcp.call(SESSIONS, 'clear_session', { session_id: 'self' })
      isCleared = !cleared.isError
      await log($, 'clear_session: ' + textOf(cleared).slice(0, 200))
    } catch (error) {
      await log($, 'clear_session refused: ' + String(error).slice(0, 300))
    }
    if (!isCleared) {
      await log($, 'fallback: running /clear')
      const ran = await $.command.run({ command: 'clear' })
      await log($, 'clear ran: ' + JSON.stringify(ran).slice(0, 200))
    }
  } catch (error) {
    isRunning = false
    await log($, 'error: ' + String(error))
    $.ui.toast(`Handoff fehlgeschlagen: ${String(error).slice(0, 200)}`)
  }
}

// Loads an exported chat into this one: hidden for the user, read by the model,
// plus a one-line notice so the user sees that it happened.
async function importChat($: Engine, path: string, title: string) {
  await resolvePaths($)
  try {
    const whole = String(await $.fs.read(path))
    const isCut = whole.length > IMPORT_MAX_CHARS
    const text = isCut ? whole.slice(-IMPORT_MAX_CHARS) : whole
    const appended = await $.session.append({
      message: {
        type: 'user',
        content: [{
          type: 'text',
          text:
            `Importierter Verlauf aus dem frueheren Chat "${title}" (Datei: ${path}` +
            (isCut ? ', nur das Ende, gekuerzt' : '') +
            '). Nutze ihn als Kontext fuer die naechsten Nachrichten:\n\n' + text,
        }],
      },
    })
    if ('deny' in appended && appended.deny !== undefined) {
      await log($, 'import denied: ' + appended.deny)
      $.ui.toast('Import abgelehnt: ' + appended.deny)
      return
    }
    await $.session.append({
      message: {
        type: 'system',
        content: [{
          type: 'text',
          text: `Verlauf von "${title}" geladen (${Math.round(text.length / 1000)}k Zeichen${isCut ? ', gekuerzt' : ''}).`,
        }],
      },
    })
    await log($, 'imported: ' + path + ' (' + text.length + ' chars)')
  } catch (error) {
    await log($, 'import failed: ' + String(error))
    $.ui.toast('Import fehlgeschlagen: ' + String(error).slice(0, 200))
  }
}

async function exportedChats($: Engine) {
  await resolvePaths($)
  const entries = await $.fs.list(EXPORT_DIR).catch(() => [])
  return entries
    .filter(entry => entry.kind === 'file' && entry.name.endsWith('.txt') && entry.name !== 'handoff-log.txt')
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

// The band's buttons, their dim hover hints, and what a press runs.
type ButtonId = 'back' | 'advisor' | 'compact' | 'ask-handover' | 'handoff'
const HINTS: Record<ButtonId, string> = {
  back: 'Alter Chat (PDF)',
  advisor: 'Advisor (Opus)',
  compact: 'Compact',
  'ask-handover': 'Handover anfragen',
  handoff: 'Volles Handover',
}
let hint: ButtonId | undefined
let lastIsWorking = false
let lastBack: Back | undefined

async function pressButton($: Engine, id: ButtonId) {
  if (id === 'back') {
    if (lastBack !== undefined) {
      await openPdf($, lastBack)
    }
  } else if (id === 'advisor') {
    await advisor($)
  } else if (id === 'compact') {
    await compact($)
  } else if (id === 'ask-handover') {
    await askHandover($)
  } else {
    await handoff($, lastIsWorking)
  }
}

export const register: Register = on => {
  // The hover regions (hover.tsx) post the pointer coming and going, and a left click.
  on('ui.message', async ($, e) => {
    const data = (e as any).data as { action?: string; id?: string } | undefined
    const id = data?.id as ButtonId | undefined
    if (id === undefined || !(id in HINTS)) {
      return {}
    }
    if (data?.action === 'press') {
      $.clock.after(0, () => void pressButton($, id))
    } else if (data?.action === 'enter' || data?.action === 'leave') {
      const next = data.action === 'enter' ? id : hint === id ? undefined : hint
      if (next !== hint) {
        hint = next
        $.ui.invalidate('ui.render')
      }
    }
    return {}
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'import-chat',
      description: 'Einen exportierten Chat aus "Claude Handoffs" in diesen Chat laden',
      argumentHint: '[Nummer oder Name]',
    })

    return next(e)
  })

  on('command.run', { command: 'import-chat' }, async ($, e) => {
    const wanted = (e.args ?? '').trim()
    if (wanted === '') {
      await $.ui.open({ id: IMPORT_PANE, title: 'Chat importieren' })
      return { text: 'Waehle rechts einen exportierten Chat.' }
    }

    const files = await exportedChats($)
    const index = Number(wanted)
    const file = Number.isInteger(index) && index >= 1
      ? files[index - 1]
      : files.find(entry => entry.name.toLowerCase().includes(wanted.toLowerCase()))
    if (file === undefined) {
      return { text: `Kein exportierter Chat passt zu "${wanted}".` }
    }
    await importChat($, EXPORT_DIR + '\\' + file.name, file.name.replace(/\.txt$/, ''))

    return { text: `"${file.name}" importiert.` }
  })

  on('ui.render', { component: 'Pane', requestId: IMPORT_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const files = await exportedChats($)

    return (
      <Box flexDirection="column">
        {files.length === 0 && <Text dimColor>Noch keine exportierten Chats.</Text>}
        {files.map((file, i) => (
          <Button
            key={'import-' + i}
            label={file.name.replace(/\.txt$/, '')}
            plain
            onPress={() => {
              void $.ui.close({ id: IMPORT_PANE })
              $.clock.after(0, () => void importChat($, EXPORT_DIR + '\\' + file.name, file.name.replace(/\.txt$/, '')))
            }}
          />
        ))}
      </Box>
    )
  })

  on('session.end', ($, e, next) => {
    if (e.reason === 'clear' && pendingHandoff !== undefined) {
      const text = pendingHandoff
      const back = pendingBack === undefined ? undefined : { ...pendingBack, id: e.sessionId }
      pendingHandoff = undefined
      pendingBack = undefined
      $.clock.after(AFTER_CLEAR_MS, async () => {
        isRunning = false
        if (back !== undefined) {
          const newId = await $.session.id()
          await $.store.set('back:' + newId, back)
          await log($, 'back link: ' + newId + ' -> ' + back.id)
          $.ui.invalidate('ui.render')
        }
        // A user row the model reads but the chat does not show as a message.
        const appended = await $.session.append({
          message: { type: 'user', content: [{ type: 'text', text }] },
        })
        if ('deny' in appended && appended.deny !== undefined) {
          await log($, 'append denied: ' + appended.deny + ', submitting instead')
          void $.prompt.submit({ text })
        } else {
          await log($, 'handoff appended')
        }
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    // Other mods (path-buttons) may add their own row content; it sits left of H.
    const others = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const id = await $.session.id()
    if (backFor !== id) {
      backFor = id
      backTo = (await $.store.get('back:' + id)) as typeof backTo
    }
    const back = backTo

    lastIsWorking = e.props.isWorking
    lastBack = back
    const { Text, Client } = $.ui.resolve(e) as any
    // Each button keeps its look; an invisible region of hover.tsx over it shows a dim hint
    // while the pointer is on it and runs the action on a click. Without regions, plain buttons.
    const button = (id: ButtonId, label: string) => (
      <Box key={'wrap-' + id} position="relative">
        <Button key={id} label={label} dimColor onPress={() => {
          $.clock.after(0, () => void pressButton($, id))
        }} />
        {Client !== undefined && (
          <Box position="absolute" top={0} left={0} right={0} bottom={0}>
            <Client key={'hover-' + id} module="./hover.tsx" props={{ id }} width="100%" height="100%" />
          </Box>
        )}
      </Box>
    )

    return (
      <Box justifyContent="flex-end" alignItems="center" gap="sm">
        {/* The hint stands leftmost, where path-buttons shows a hovered file name. */}
        {hint !== undefined && (
          <Box key="hint" marginRight="md">
            <Text dimColor>{HINTS[hint]}</Text>
          </Box>
        )}
        {others.type !== 'engine' && others}
        {back !== undefined && button('back', '<<')}
        {button('advisor', '⌾')}
        {button('compact', 'C')}
        {button('ask-handover', 'H')}
        {button('handoff', '⤓')}
      </Box>
    )
  })
}