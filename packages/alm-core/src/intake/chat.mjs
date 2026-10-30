const INLINE_TIME =
  /^\s*[-*]?\s*(?:\[|\()?(\d{1,2}:\d{2}(?::\d{2})?)(?:\]|\))?\s*[-–—]?\s*(?:\*\*)?([^：:*]{1,40}?)(?:\*\*)?\s*[：:]\s*(.+)$/
const HEADER = /^\s*[-*]?\s*(?:\*\*)?([^：:*]{1,40}?)(?:\*\*)?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*[：:]?\s*$/
const INLINE = /^\s*[-*]?\s*(?:\*\*)?([^：:*]{1,40}?)(?:\*\*)?\s*[：:]\s*(.+)$/

function clean(line) {
  return line.replace(/^[-*]\s+/, '').trim()
}

/**
 * Parse an exported chat Markdown into messages with stable line references.
 * Supported shapes (common in Feishu/WeChat exports and direct paste):
 *   - 10:12 张三：内容
 *   - **张三** 10:12：内容
 *   - **张三** 10:12      (content on following lines)
 *   - [10:12] 张三: 内容
 *   - 张三：内容           (no timestamp)
 */
export function parseChatMarkdown(text) {
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  const messages = []
  let last = null

  const push = (message) => {
    const id = `M${messages.length + 1}`
    const entry = { id, ...message }
    messages.push(entry)
    last = entry
    return entry
  }

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const trimmed = raw.trim()
    const line = index + 1
    if (trimmed === '' || trimmed.startsWith('#')) {
      last = null
      continue
    }
    if (/^---\s*$/.test(trimmed)) continue

    const inline = INLINE_TIME.exec(trimmed)
    if (inline) {
      push({ line, time: inline[1], speaker: inline[2].trim(), text: inline[3].trim() })
      continue
    }

    const header = HEADER.exec(trimmed)
    if (header) {
      push({ line, time: header[2], speaker: header[1].trim(), text: '' })
      continue
    }

    const plain = INLINE.exec(trimmed)
    if (plain) {
      push({ line, time: null, speaker: plain[1].trim(), text: plain[2].trim() })
      continue
    }

    if (last) {
      last.text = last.text ? `${last.text}\n${clean(trimmed)}` : clean(trimmed)
    } else {
      push({ line, time: null, speaker: '', text: clean(trimmed) })
    }
  }

  return { format: 'markdown-chat', messages, warnings: messages.length === 0 ? ['no chat messages found'] : [] }
}

/** Canonical Markdown keeps the source line so a quote can cite chat.md#L12. */
export function normalizeChatMarkdown({ messages }) {
  return messages
    .map((message) => {
      const meta = [message.time, message.speaker].filter(Boolean).join(' · ')
      return `### ${message.id}${meta ? ` · ${meta}` : ''}\n${message.text}\n<!-- line:${message.line} -->`
    })
    .join('\n\n')
}
