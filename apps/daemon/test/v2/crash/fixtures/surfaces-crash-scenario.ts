/**
 * surfaces-crash-scenario —— MIG-06 记录面第 7/8/9 注入点 V2 crash 腿共用场景（真进程 SIGKILL）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - plan/03 MIG-06「记录面注入点补点」（2026-10-28 MIG-04 交付登记：余 3 点归本波补登）
 *   - plan/04 §1.6（V5 记录面四点扩展：备份快照写入中／投影重建中／排除域报告写入中）
 *   - docs/v2/17 §1.1 V5 行（每个 kill 点重启后三不变量：不丢终态/不假绿/不重复副作用）
 *   - crash-points.ts 头注第 ⑦⑧⑨ 行（本场景的注入点注册名唯一源）
 *
 * 边界：本文件是**测试夹具**（不进生产面、不新增生产调用点、不改 store 写面）：
 *   - 种子行均为确定性合成 id（cost_daily 4 行／events 6 行），由父测试进程在独立已提交
 *     事务里落库；子进程只读/重放，不冒充任何生产写口；
 *   - 子进程证据行一律 writeSync 直写 fd（SIGKILL 前必须离开进程；stdout 缓冲不可靠）。
 */
import { readFileSync, writeSync } from 'node:fs'

/** 子进程模式（每点 crash/正常腿；与 SN_CRASH_POINT 分离：模式只控自检，点名只控注入） */
export const MODE_ENV = 'SN_SURFACES_MODE'
/** 子进程库路径（备份源库／重建目标库；真文件库，不用 :memory:） */
export const DB_ENV = 'SN_SURFACES_DB'
/** 子进程输入 JSONL（dumpEvents 产物；rebuild / exclusion 报告腿） */
export const SOURCE_ENV = 'SN_SURFACES_SOURCE'
/** 子进程输出件路径（备份件／报告件） */
export const OUT_ENV = 'SN_SURFACES_OUT'

/** 第 7 点注册名（与 crash-points.ts 冻结表逐字一致） */
export const BACKUP_POINT = 'backup-snapshot'
/** 第 8 点注册名（与 crash-points.ts 冻结表逐字一致） */
export const REBUILD_POINT = 'projection-rebuild'
/** 第 9 点注册名（与 crash-points.ts 冻结表逐字一致） */
export const EXCLUSION_POINT = 'exclusion-report'

/** 场景基准时刻（固定，可复现；测试只锚数值，不锚本机时区） */
export const T0 = Date.UTC(2026, 9, 28, 7, 30, 0)

const COMPANY = 'studio-crash'
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function encodeBase32(value: bigint, len: number): string {
  let out = ''
  for (let i = len - 1; i >= 0; i--) out += B32[Number((value / 32n ** BigInt(i)) % 32n)] ?? '0'
  return out
}

/** 确定性合成 ULID（时间位 10 字符＋随机位 16 字符；同参数恒同 id） */
export function ulid(ts: number, seq: number): string {
  return encodeBase32(BigInt(ts), 10) + encodeBase32(BigInt(seq), 16)
}

/** 备份源库种子行数（半写＝前 2 行；父测试与子进程共守同一基线） */
export const EXPECTED_COST_ROWS = 4
/** 投影重建/排除域报告输入事件行数（半重放＝前 3 行） */
export const EXPECTED_EVENTS = 6
/** 备份崩溃腿保留的行数（JSONL 一半） */
export const HALF_COST_ROWS = Math.floor(EXPECTED_COST_ROWS / 2)
/** 重建崩溃腿已重放的行数（事务内重放游标一半） */
export const HALF_EVENTS = Math.floor(EXPECTED_EVENTS / 2)

/** cost_daily 种子 4 行（自然键 (company,person_id,model,cost_date) 互异；写序＝读序可复算） */
export function costRows(): Record<string, unknown>[] {
  const people = ['ENG-1', 'ENG-1', 'ENG-2', 'ENG-2']
  const dates = ['2026-10-24', '2026-10-25', '2026-10-24', '2026-10-25']
  return people.map((person, i) => ({
    id: ulid(T0, 100 + i),
    company: COMPANY,
    person_id: person,
    model: 'deepseek/deepseek-flash',
    cost_date: dates[i],
    tokens: { tokens_in: 1_000 + i * 10, tokens_out: 500 + i, cache_read: 0, cache_creation: 0 },
    price_snapshot_id: 'models-yaml:deepseek/deepseek-flash',
    cost_usd: 0.25 + i * 0.5,
    closed_at: T0 + i,
    closed_by: `cost-close:${String(dates[i])}`,
    note: `surfaces-crash 种子钱账行 ${i}`,
  }))
}

const EVENT_NAMES = ['LLM', 'LLM', 'GATE_PASS', 'CLOSE', 'MERGE', 'HEARTBEAT'] as const

/** events 种子 6 行（id/ts 唯一；重建全量再生后可逐 id 对照） */
export function eventRows(): Record<string, unknown>[] {
  return EVENT_NAMES.map((event, i) => ({
    id: ulid(T0, 10 + i),
    ts: T0 + i,
    company: COMPANY,
    issue: 'STUDIO-706',
    event,
    actor: 'AGENT-1:agent-1',
    attempt: 1,
    level: 2,
    dept: 'departments/工程部',
    tokens: { input: 10 + i, output: 5 + i },
    note: `surfaces-crash 种子事件 ${i}`,
  }))
}

/** 子进程同步证据行（SIGKILL 前必须离开本进程——writeSync 写内核管道，非 stdout 缓冲） */
export function emit(prefix: string, value: unknown): void {
  writeSync(1, `${prefix} ${JSON.stringify(value)}\n`)
}

/** 子进程失败退出（stderr 人话＋专用退出码；绝不以 exit 0 冒充崩溃） */
export function fail(code: number, message: string): never {
  writeSync(2, `${message}\n`)
  process.exit(code)
}

/** 读取必填环境变量；缺失即 fail（fixture 配置 bug，不静默缺省） */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') fail(2, `${name} 缺失（真文件库/真 JSONL 路径必填）`)
  return value
}

/** 读取 JSONL 非空行（不解析语义——解析/校验归 store appendEvent 契约闸） */
export function readJsonlLines(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
}
