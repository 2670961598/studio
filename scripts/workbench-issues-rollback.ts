/**
 * workbench-issues-rollback —— 单子切换「回滚到 Taiga 只读」SOP 干跑（task-127-B）
 *
 * 依据：docs/sentinel-logs/单子切换-runbook-2026-11-18.md §四（回滚）。
 * 边界（铁律）：**只打印步骤 + 只读校验证据件存在性，不执行任何回滚动作**——
 *   不改 daemon 配置、不动任何数据库、不写生产 Taiga、不网络。
 *
 * 校验件（全部只读）：
 *   --snapshot   Taiga/台账导出快照（默认 docs/quality/phase0/ticket-export.json）：存在+可解析+rows≥1
 *   --diff       预期/对账表（默认 docs/quality/phase0/ticket-diff.json）：存在+可解析+stateMatched>0+idRoundtrip
 *   --artifacts  演练证据目录（可选）：rehearse.json（issues-migrate-rehearse/v1 且 ok=true）；
 *                如含 plan.json/diff.json 也一并校验（schema+ok）
 * 退出码：0=步骤打印且校验全过；1=校验失败（缺件/坏件，逐项列出）；2=用法/文件结构错误。
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PHASE0_DIFF_SCHEMA, PHASE0_EXPORT_SCHEMA, REHEARSE_SCHEMA } from './workbench-issues-rehearse.ts'

const USAGE = '用法：node scripts/workbench-issues-rollback.ts [--snapshot <ticket-export.json>] [--diff <ticket-diff.json>] [--artifacts <dir>] [--out <sop.md>]'

/** 与 UsageError 同语义（本文件不引 migrate.ts，保持单向依赖：rollback → rehearse） */
class UsageError extends Error {}

/** runbook §四 的回滚序列（步骤文本冻结自 runbook，改动走批示流） */
export interface RollbackStep {
  readonly n: number
  readonly title: string
  readonly action: string
  readonly verification: string
}

export const ROLLBACK_STEPS: readonly RollbackStep[] = [
  { n: 1, title: '冻结 Workbench 侧写入', action: '停 daemon 单子面派发/评论/流转（Workbench issues 只进不出，防止回滚窗口产生新单）', verification: 'daemon 单子面静默：无新 ticket/comment/event 落库' },
  { n: 2, title: 'daemon 配置回 platform: taiga', action: '改 daemon 配置回 Taiga 通道并重启（配置回滚，分钟级；不动代码）', verification: 'daemon 起后单子面读写走 Taiga，Workbench 侧不再被写' },
  { n: 3, title: '校验 Taiga 冻结快照仍在', action: '核对导出快照（--snapshot）存在且行数与迁移窗口起点一致；Taiga 数据未动（窗口内只读冻结）', verification: '快照文件可解析、rows 与窗口记录一致' },
  { n: 4, title: '校验迁移对账证据仍在', action: '核对预期/对账表（--diff）与演练证据（--artifacts）存在且结论为 ok（回滚决策要有据可查）', verification: 'diff/演练报告可解析、stateMatched/ok 达标' },
  { n: 5, title: 'Workbench issues.db 标记弃用并保留', action: '把演练/影子库改名或标记 deprecated（审计保留，不删除不重放）', verification: '库文件仍在且带弃用标记；无进程持有写句柄' },
  { n: 6, title: 'ticket_mirror 由 events 重建', action: '台账 ticket_mirror 是可重建投影（非事实源）：跑重建脚本恢复 Taiga 侧镜像', verification: '重建后 ticket_mirror 行数/状态与 Taiga 一致' },
  { n: 7, title: '窗口内新产生的 Workbench 单回录', action: '若有新单：导出 JSON 存档、人工回录 Taiga（预期量≈0，窗口内冻结）', verification: '回录清单逐单签字；无遗漏未回录单' },
]

export interface ArtifactCheck {
  readonly name: string
  readonly path: string
  readonly ok: boolean
  readonly detail: string
}

function readJsonFile(file: string): unknown {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (cause) {
    throw new UsageError(`文件不可读：${file}（${String(cause)}）`)
  }
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new UsageError(`${file}: JSON 解析失败（${String(cause)}）`)
  }
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new UsageError(`${where}：应为对象`)
  return value as Record<string, unknown>
}

/** 只读校验：快照/预期表/演练证据的存在性与结论（不执行任何回滚动作） */
export function validateRollbackArtifacts(snapshotPath: string, diffPath: string, artifactsDir: string | null): ArtifactCheck[] {
  const checks: ArtifactCheck[] = []

  const snapshotOk = existsSync(snapshotPath)
  let snapshotDetail = '缺失'
  if (snapshotOk) {
    try {
      const rows = asArray(asRecord(readJsonFile(snapshotPath), 'snapshot')['rows'] ?? [], 'snapshot.rows')
      snapshotDetail = `存在且可解析：rows=${String(rows.length)}`
      checks.push({ name: 'snapshot', path: snapshotPath, ok: rows.length > 0, detail: snapshotDetail })
    } catch (cause) {
      checks.push({ name: 'snapshot', path: snapshotPath, ok: false, detail: `存在但不可解析（${cause instanceof UsageError ? cause.message : String(cause)}）` })
    }
  } else checks.push({ name: 'snapshot', path: snapshotPath, ok: false, detail: snapshotDetail })

  if (existsSync(diffPath)) {
    try {
      const rec = asRecord(readJsonFile(diffPath), 'diff')
      const stateMatched = Number(rec['stateMatched'] ?? 0)
      const idRoundtrip = rec['idRoundtrip'] === true
      checks.push({
        name: 'diff',
        path: diffPath,
        ok: stateMatched > 0 && idRoundtrip,
        detail: `存在且可解析：stateMatched=${String(stateMatched)} idRoundtrip=${String(idRoundtrip)}`,
      })
    } catch (cause) {
      checks.push({ name: 'diff', path: diffPath, ok: false, detail: `存在但不可解析（${cause instanceof UsageError ? cause.message : String(cause)}）` })
    }
  } else checks.push({ name: 'diff', path: diffPath, ok: false, detail: '缺失' })

  if (artifactsDir !== null) {
    if (!existsSync(artifactsDir) || !statSync(artifactsDir).isDirectory()) {
      checks.push({ name: 'artifacts-dir', path: artifactsDir, ok: false, detail: '目录缺失' })
    } else {
      const rehearsePath = path.join(artifactsDir, 'rehearse.json')
      if (!existsSync(rehearsePath)) {
        checks.push({ name: 'artifacts:rehearse', path: rehearsePath, ok: false, detail: '缺失（127-B 演练报告 rehearse.json）' })
      } else {
        try {
          const rec = asRecord(readJsonFile(rehearsePath), 'rehearse')
          const ok = rec['ok'] === true
          const schemaOk = rec['schema'] === REHEARSE_SCHEMA
          checks.push({ name: 'artifacts:rehearse', path: rehearsePath, ok: ok && schemaOk, detail: `存在且可解析：schema=${String(rec['schema'])}（期望 ${REHEARSE_SCHEMA}）ok=${String(ok)}` })
        } catch (cause) {
          checks.push({ name: 'artifacts:rehearse', path: rehearsePath, ok: false, detail: `存在但不可解析（${cause instanceof UsageError ? cause.message : String(cause)}）` })
        }
      }
      for (const [name, schema, needOk] of [['plan.json', 'issues-migrate-plan/v1', false], ['diff.json', 'issues-migrate-diff/v1', true]] as const) {
        const p = path.join(artifactsDir, name)
        if (!existsSync(p)) continue // 可选件：在则校验
        try {
          const rec = asRecord(readJsonFile(p), name)
          const schemaOk = rec['schema'] === schema
          const okOk = !needOk || rec['ok'] === true
          checks.push({ name: `artifacts:${name.replace('.json', '')}`, path: p, ok: schemaOk && okOk, detail: `存在且可解析：schema=${String(rec['schema'])}${needOk ? ` ok=${String(rec['ok'])}` : ''}` })
        } catch (cause) {
          checks.push({ name: `artifacts:${name.replace('.json', '')}`, path: p, ok: false, detail: `存在但不可解析（${cause instanceof UsageError ? cause.message : String(cause)}）` })
        }
      }
    }
  }
  return checks
}

function asArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new UsageError(`${where}：应为数组`)
  return value
}

function isDirectRun(): boolean {
  const argv1 = process.argv[1]
  if (argv1 === undefined) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

export function rollbackCli(argv: readonly string[]): { code: number; stdout: string } {
  const args = [...argv]
  const valueOf = (name: string): string | undefined => {
    const i = args.indexOf(name)
    if (i < 0) return undefined
    const value = args[i + 1]
    if (value === undefined) throw new UsageError(`${name} 缺参数；${USAGE}`)
    args.splice(i, 2)
    return value
  }
  const snapshot = valueOf('--snapshot') ?? path.resolve(import.meta.dirname, '../docs/quality/phase0/ticket-export.json')
  const diff = valueOf('--diff') ?? path.resolve(import.meta.dirname, '../docs/quality/phase0/ticket-diff.json')
  const artifacts = valueOf('--artifacts') ?? null
  const out = valueOf('--out')
  if (args.some((a) => a === '--help' || a === '-h')) return { code: 0, stdout: `${USAGE}\n` }
  if (args.length > 0) throw new UsageError(`未知参数：${args.join(' ')}；${USAGE}`)

  const checks = validateRollbackArtifacts(snapshot, diff, artifacts)
  const lines: string[] = [
    '# 回滚 SOP（dry-run）：单子切换 Taiga ← Workbench issues',
    '',
    '> 本输出只是步骤打印 + 证据件只读校验，未执行任何回滚动作（不改配置/不动库/不网络）。',
    `> 步骤冻结自 docs/sentinel-logs/单子切换-runbook-2026-11-18.md §四；快照口径 ${PHASE0_EXPORT_SCHEMA} / ${PHASE0_DIFF_SCHEMA}。`,
    '',
    '## 步骤（人工按序执行；每步验证通过才进下一步）',
    '',
    ...ROLLBACK_STEPS.flatMap((step) => [
      `${String(step.n)}. ${step.title}`,
      `   - 动作：${step.action}`,
      `   - 验证：${step.verification}`,
    ]),
    '',
    '## 证据件校验（只读）',
    '',
    ...checks.map((c) => `- [${c.ok ? 'PASS' : 'FAIL'}] ${c.name}：${c.path} —— ${c.detail}`),
    '',
  ]
  const allOk = checks.every((c) => c.ok)
  const summary = { ok: allOk, dryRun: true, steps: ROLLBACK_STEPS.length, checks: checks.length, failed: checks.filter((c) => !c.ok).length }
  const text = `${lines.join('\n')}\n${JSON.stringify(summary)}\n`
  if (out !== undefined) {
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, text)
  }
  return { code: allOk ? 0 : 1, stdout: text }
}

if (isDirectRun()) {
  try {
    const { code, stdout } = rollbackCli(process.argv.slice(2))
    process.stdout.write(stdout)
    process.exit(code)
  } catch (cause) {
    if (cause instanceof UsageError) {
      console.error(`[workbench-issues-rollback] ${cause.message}`)
      process.exit(2)
    }
    throw cause
  }
}
