import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const clientPath = fileURLToPath(new URL('../client.js', import.meta.url))
const client = readFileSync(clientPath, 'utf8')

test('list title preserves the exact title for the hover tooltip and truncates its visible text', () => {
  assert.match(client, /title: item\.title,/)
  assert.match(client, /textOverflow: 'ellipsis'/)
  assert.match(client, /whiteSpace: 'nowrap'/)
})

test('missing acceptance uses a workflow action rather than command-registration jargon', () => {
  assert.match(client, /code === 'acceptance-missing'\) return \{ label: '补充验收'/)
  assert.match(client, /\? '待补充验收'/)
  assert.doesNotMatch(client, /label: '登记验收'/)
  assert.doesNotMatch(client, /\? '未登记验收命令'/)
})