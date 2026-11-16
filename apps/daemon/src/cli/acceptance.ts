/**
 * acceptance —— 验收结论记录 CLI（task-39；提案 task-38 已批）
 *
 * 用法：acceptance record --db <库> --company <slug> --ticket <单号> --status pass|return|need-evidence|waived
 *        --by <验收方> --evidence <证据说明/路径> [--signoff lead-verifier|eng0|producer] [--json]
 *
 * 只写一条**既有事件词 APPROVE**（note `ACCEPTANCE;status=...`；不新增事件词/表/schema），
 * 由派发/CLOSE 闸读取最新结论；不自动改单/不做审批动作。验收方/证据必填（不伪造）。
 */
import path from 'node:path'
import { openLedger } from '@studio-next/store'
import { recordAcceptance, type AcceptanceStatus } from '../engine/acceptance/index.ts'
import { makeUlid } from '../engine/tools/id.ts'
import { CONCISE, SECTION } from './usage.ts'
import { errText } from './argv.ts'
import { helpOk, usageFail, wantsHelp } from './help.ts'

const STATUSES: readonly AcceptanceStatus[] = ['pass', 'return', 'need-evidence', 'waived']
const SIGNOFFS = ['lead-verifier', 'eng0', 'producer'] as const

export async function cmdAcceptance(argv: string[]): Promise<number> {
  if (wantsHelp(argv)) return helpOk(SECTION['acceptance'])
  const [sub, ...rest] = argv
  if (sub !== 'record') return usageFail('acceptance', `子命令须 record（收到 ${sub ?? '空'}）`, CONCISE['acceptance'])
  const values: Record<string, string> = {}
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? ''
    if (token === '--json') {
      values['json'] = 'true'
      continue
    }
    if (!token.startsWith('--')) return usageFail('acceptance', `未知位置参数：${token}`, CONCISE['acceptance'])
    const eq = token.indexOf('=')
    const key = eq >= 0 ? token.slice(2, eq) : token.slice(2)
    if (!['db', 'company', 'ticket', 'status', 'by', 'evidence', 'signoff'].includes(key)) {
      return usageFail('acceptance', `未知参数：${token}`, CONCISE['acceptance'])
    }
    const value = eq >= 0 ? token.slice(eq + 1) : rest[i + 1]
    if (value === undefined || value.startsWith('--')) return usageFail('acceptance', `参数缺值：${token}`, CONCISE['acceptance'])
    values[key] = value
    if (eq < 0) i += 1
  }
  const missing = ['db', 'company', 'ticket', 'status', 'by', 'evidence'].filter((k) => values[k] === undefined || values[k] === '')
  if (missing.length > 0) return usageFail('acceptance', `缺少必填：${missing.join('/')}`, CONCISE['acceptance'])
  const status = values['status']
  if (!STATUSES.includes(status as AcceptanceStatus)) return usageFail('acceptance', `status 须 ${STATUSES.join('|')}`, CONCISE['acceptance'])
  const signoff = values['signoff'] ?? 'lead-verifier'
  if (!(SIGNOFFS as readonly string[]).includes(signoff)) return usageFail('acceptance', `signoff 须 ${SIGNOFFS.join('|')}`, CONCISE['acceptance'])
  const db = path.resolve(values['db'] as string)
  const ledger = openLedger(db)
  try {
    const event = recordAcceptance({
      ledger,
      company: values['company'] as string,
      ticket: values['ticket'] as string,
      status: status as AcceptanceStatus,
      by: values['by'] as string,
      evidence: values['evidence'] as string,
      signoff,
      at: Date.now(),
      makeId: (ts) => makeUlid(ts),
    })
    if (values['json'] === 'true') console.log(JSON.stringify({ ok: true, eventId: event.id, ticket: event.issue, status, signoff }))
    else console.log(`验收已记录：${event.issue} status=${status} by=${values['by'] as string} signoff=${signoff} event=${event.id}`)
    return 0
  } catch (err) {
    console.error(`acceptance 失败：${errText(err)}`)
    return 2
  } finally {
    ledger.close()
  }
}
