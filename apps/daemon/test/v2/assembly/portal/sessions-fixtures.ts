/**
 * 会话档案夹具（docs/plan/11-公司门户-2026-11-23.md §九.1 v2 第一刀）。
 *
 * 在 makeTree 根下补造 `.AIWS/departments/<dept>/<PersonId>/tickets/<ticket>/att<N>/`
 * 工位树（两岗位×两单子×两尝试）：brief/REPORT/summary + deliverables 树 +
 * `.dsh-home/sessions/<ws>/<session-…>/session.v4.jsonl.zstd`（**写入明文 JSONL 字节**——
 * 测试注入 fake 解压面直读文件，不真起 zstd；生产是 zstd 压缩位，形状一致）。
 * 平台侧补 SESS-1/SESS-2 两张单子（单子联动断言用）。mtime 用 utimesSync 钉死排序。
 */
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { PortalTree } from './fixtures.ts'

/** 会话 id（合法 uuid 形——详情页 ?sessionId= 反查用） */
export const SESS1_ID = 'session-11111111-1111-4111-8111-111111111111'
export const SESS2_ID = 'session-22222222-2222-4222-8222-222222222222'
export const SESS1_ID_UNKNOWN = 'session-99999999-9999-4999-8999-999999999999'

/** 脱敏语料用的「主机绝对路径」前缀（分段拼装——仓里不落字面主机路径，AGENTS §五.6；
 *  拼出形态命中 chat/mask 的 HOST_PATH_RE：/Users/<x>） */
export const SECRET_HOST = ['', 'Users', 'secret'].join('/')

const T0 = Date.parse('2026-11-22T10:00:00.000Z')

/** SESS-1 att1 轨迹（v4 事件族全覆盖＋坏行＋超长文本＋主机绝对路径脱敏语料） */
export function sess1Transcript(): string {
  let seq = 0
  const ev = (offsetSec: number, type: string, data: Record<string, unknown>): string => JSON.stringify({ seq: (seq += 1), time: T0 + offsetSec * 1000, type, data })
  return [
    ev(0, 'session', { id: SESS1_ID, createdAt: T0, version: 4, cwd: `${SECRET_HOST}/ws` }),
    ev(1, 'permission/preset', { mode: 'worktree' }),
    ev(2, 'sandbox/mode', { mode: 'workspace-write' }),
    ev(3, 'approval/policy', { auto: 'deny' }),
    ev(4, 'request/header', { header: { config: { provider: 'dsh', model: 'glm-test' }, tools: ['bash', 'read', 'write'] } }),
    ev(5, 'agent/inbox/spliced', { inserted: [{ content: [{ type: 'text', text: `任务书：完成 SESS-1 第一刀交付。参考 ${SECRET_HOST}/brief.log` }] }] }),
    ev(6, 'user/message', { content: [{ type: 'text', text: `请开始干活，注意 ${SECRET_HOST}/library.log` }] }),
    ev(7, 'system/message', { message: { content: [{ type: 'text', text: 'L0-L5 提示词'.repeat(50) }] } }),
    ev(8, 'assistant/message', { message: { content: [{ type: 'reasoning', text: '先查目录结构' }, { type: 'text', text: '我先看一下目录结构。' }] } }),
    ev(9, 'tool/call', { name: 'bash', arguments: JSON.stringify({ command: `ls -la ${SECRET_HOST}`, description: '列目录' }) }),
    ev(10, 'tool/result', { message: { content: [{ type: 'text', text: 'total 0' }] } }),
    ev(11, 'assistant/message', { message: { content: [{ type: 'text', text: '长文本'.repeat(1500) }] } }),
    ev(12, 'tool/call', { name: 'read', arguments: JSON.stringify({ file_path: `${SECRET_HOST}/a.md` }) }),
    ev(13, 'tool/result', { isError: true, message: { content: [{ type: 'text', text: `no such file ${SECRET_HOST}/a.md` }] } }),
    ev(14, 'turn/start', { turn: 1 }),
    ev(15, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ev(16, 'compaction/summary', { summary: { content: [{ type: 'text', text: '压缩摘要：已列目录，读取失败一次。' }] } }),
    ev(17, 'step/start', { step: 1 }),
    ev(18, 'session/title', { title: 'SESS-1 第一刀' }),
    ev(19, 'turn/start', { turn: 2 }),
    ev(20, 'turn/end', { turn: 2, reason: { kind: 'error', message: 'boom' } }),
    'not-json{',
    '',
  ].join('\n')
}

/** SESS-2 att1 轨迹（头＋一问一答＋256 次工具调用＋回合 → 260 事件：折叠断言用） */
export function sess2Transcript(): string {
  const lines: string[] = [
    JSON.stringify({ seq: 1, time: T0, type: 'session', data: { id: SESS2_ID, createdAt: T0, version: 4 } }),
    JSON.stringify({ seq: 2, time: T0 + 1000, type: 'user/message', data: { content: [{ type: 'text', text: '巡检开始' }] } }),
    JSON.stringify({ seq: 3, time: T0 + 2000, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '巡检完成，无异常。' }] } } }),
  ]
  for (let i = 0; i < 256; i += 1) {
    lines.push(JSON.stringify({ seq: 4 + i, time: T0 + 3000 + i, type: 'tool/call', data: { name: 'bash', arguments: JSON.stringify({ command: `check-${String(i)}` }) } }))
  }
  lines.push(JSON.stringify({ seq: 300, time: T0 + 300_000, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }))
  lines.push('')
  return lines.join('\n')
}

/** 平台补单（SESS-1/SESS-2——/tickets 联动断言用；形状同 fixtures.ISSUE_FILES） */
export const SESS_ISSUE_FILES: Readonly<Record<string, string>> = {
  'issues/SESS-1.jsonl': [
    JSON.stringify({ type: 'created', ts: '2026-11-21T08:00:00.000Z', state: '已派发', input: { title: '门户 v2 第一刀：会话档案', description: '会话档案只读浏览。', type: 'devtask', dept: 'departments/研发部', level: 2, assignee: 'ENG-1', lane: 'core' } }),
    '',
  ].join('\n'),
  'issues/SESS-2.jsonl': [
    JSON.stringify({ type: 'created', ts: '2026-11-21T09:00:00.000Z', state: '已交付', input: { title: '例行巡检单', description: '巡检。', type: 'patrol', dept: 'departments/研发部', level: 1, assignee: 'QA-1' } }),
    '',
  ].join('\n'),
}

const write = (dir: string, rel: string, content: string): void => {
  const abs = path.join(dir, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

/** 造 .AIWS 工位树＋平台补单；mtime 钉死（att1 最新 → SESS-2 → att2） */
export function seedSessions(tree: PortalTree): void {
  const aiws = path.join(tree.root, '.AIWS')
  // —— 研发部/ENG-1/SESS-1/att1：全量产物＋双交付物＋会话轨迹 ——
  const att1 = path.join(aiws, 'departments', '研发部', 'ENG-1', 'tickets', 'SESS-1', 'att1')
  write(att1, 'brief.md', `# 任务书 SESS-1\n\n交付会话档案；日志在 ${SECRET_HOST}/brief.log。\n`)
  write(att1, 'REPORT.md', `# REPORT SESS-1\n\n结论：交付完成。原始 ${SECRET_HOST}/report-body.txt\n`)
  write(att1, 'summary.json', JSON.stringify({ ticket: 'SESS-1', attempt: 1, conclusion: 'SESS-1 att1 结论：交付组织架构图与单子联动。', changed_files: [], acceptance: [] }))
  write(att1, 'deliverables/notes/a.md', `# 交付注记\n\n见 ${SECRET_HOST}/notes.txt\n`)
  write(att1, 'deliverables/data.json', '{"ok":true,"n":1}\n')
  write(att1, 'deliverables/skipme.bin', 'BINARY\x00\x01')
  write(att1, 'deliverables/big.log', `${'行数据x'.repeat(10)}\n`.repeat(6500))
  write(att1, `.dsh-home/sessions/ws-host-secret/${SESS1_ID}/session.v4.jsonl.zstd`, sess1Transcript())
  // —— 研发部/ENG-1/SESS-1/att2：只有 brief（无会话——空轨迹降级态） ——
  const att2 = path.join(aiws, 'departments', '研发部', 'ENG-1', 'tickets', 'SESS-1', 'att2')
  write(att2, 'brief.md', '# 任务书 SESS-1 第二次尝试\n')
  // —— 研发部/QA-1/SESS-2/att1：brief＋summary＋会话 ——
  const s2 = path.join(aiws, 'departments', '研发部', 'QA-1', 'tickets', 'SESS-2', 'att1')
  write(s2, 'brief.md', '# 任务书 SESS-2\n')
  write(s2, 'summary.json', JSON.stringify({ ticket: 'SESS-2', attempt: 1, conclusion: 'SESS-2 att1 结论：巡检通过。' }))
  write(s2, `.dsh-home/sessions/ws-qa/${SESS2_ID}/session.v4.jsonl.zstd`, sess2Transcript())
  // mtime 钉序（updatedAt=max(轨迹 mtime, brief/REPORT/summary mtime)）：att1(+3h) > SESS-2(+2h) > att2(+1h)
  const touch = (p: string, offsetMs: number): void => {
    const t = new Date(T0 + offsetMs)
    utimesSync(p, t, t)
  }
  touch(path.join(att1, 'brief.md'), 3 * 3_600_000)
  touch(path.join(att1, 'REPORT.md'), 3 * 3_600_000)
  touch(path.join(att1, 'summary.json'), 3 * 3_600_000)
  touch(path.join(att1, '.dsh-home', 'sessions', 'ws-host-secret', SESS1_ID, 'session.v4.jsonl.zstd'), 3 * 3_600_000)
  touch(path.join(att2, 'brief.md'), 1 * 3_600_000)
  touch(path.join(s2, 'brief.md'), 2 * 3_600_000)
  touch(path.join(s2, 'summary.json'), 2 * 3_600_000)
  touch(path.join(s2, '.dsh-home', 'sessions', 'ws-qa', SESS2_ID, 'session.v4.jsonl.zstd'), 2 * 3_600_000)
  // 平台补单
  for (const [rel, content] of Object.entries(SESS_ISSUE_FILES)) write(tree.platformRoot, rel, content)
}
