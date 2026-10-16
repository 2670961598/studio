/**
 * 测试语料工厂：造一个「有 due 岗 / 有在途 run / 有各类事件」的台账语料库。
 *
 * 事件必须过 contract validateEventRecord（appendEvent 前置闸）：本工厂按 EventRecordSchema
 * 列集生成合法行（tokens 至少一桶、事件名走冻结枚举/前缀族）。
 * makeUlid 与 store/test/ulid.ts 同算法（测试专用独立副本，不跨包引测试文件）。
 */
import { randomBytes } from 'node:crypto'

/** 语料时间原点（与 store 测试系同风格：远离真实时钟，判 due 用相对偏移） */
export const T0 = 1770000000000

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function encode(value: bigint, len: number): string {
  let out = ''
  for (let i = len - 1; i >= 0; i--) {
    out += ALPHABET[Number((value / 32n ** BigInt(i)) % 32n)]
  }
  return out
}

/** makeUlid(ts)：时间部分取 ts（epoch ms），随机部分 80bit crypto 随机 */
export function makeUlid(ts: number): string {
  return encode(BigInt(ts), 10) + encode(BigInt(`0x${randomBytes(10).toString('hex')}`), 16)
}

let seq = 0

/** 合法事件行工厂（ts 逐行递增保证 (ts,id) 全序；patch 覆盖造差异） */
export function makeEvent(patch: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1
  const ts = T0 + seq * 1000
  return {
    id: makeUlid(ts),
    ts,
    company: 'demo',
    issue: 'DEMO-1',
    event: 'DISPATCH',
    actor: 'P1/bot',
    attempt: 1,
    level: 3,
    dept: 'departments/工程部',
    tokens: { input: 100 },
    ...patch,
  }
}

/** 定时岗工厂（next_run_at 显式给：due 判据是它与 now 比，cron 解析归 core） */
let jobSeq = 0
export function makeJob(patch: Record<string, unknown> = {}): Record<string, unknown> {
  jobSeq += 1
  return {
    job_id: `job-${jobSeq}`,
    company: 'demo',
    dept: 'departments/工程部',
    cron: '*/5 * * * *',
    role: 'main_worker',
    level: 3,
    model_tier: 'mid',
    next_run_at: T0,
    ...patch,
  }
}

/** work_record 工厂（缺 ended_at = 在途） */
export function makeRun(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `run-${String(++seq)}`,
    issue: 'DEMO-1',
    person_id: 'P1',
    executor: 'dsh',
    started_at: T0 + 100,
    attempt: 1,
    status: 'done',
    ...patch,
  }
}

/** session 工厂（缺 ended_at = 在途会话） */
export function makeSession(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: `sess-${String(++seq)}`,
    issue: 'DEMO-1',
    person_id: 'P1',
    started_at: T0 + 100,
    ...patch,
  }
}
