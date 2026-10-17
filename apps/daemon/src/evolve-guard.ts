/**
 * evolve-guard —— 进化管线 daemon 侧判负闸（「无 candidate id 的生产改动判负」接线件）
 *
 * 规格依据（实现单引用）：
 *   - docs/20-§九：一切改进走候选制品管线；「无 candidate id 的生产改动判负」——本文件是该
 *     判定面（core assertChangeAuthorized）的 daemon 接线件。
 *   - docs/02 F3-01（统一入口禁旁路）：判负不是可配置项——闸挂上写径即收口，无开关。
 *   - docs/17-§3：candidates 表是判负查授权态（approved|promoted）的消费面；active 集从
 *     **台账读面**取（candidatesByStatus 全状态集一查）——判负即台账视角，非内存直通。
 *
 * 判负入参语义（冻结，evolution-e2e 头注「判负入参语义收窄说明」同口径）：
 *   authorize 消费的候选集是**全集非授权集**——授权过滤（approved|promoted）在 core
 *   assertChangeAuthorized 内部；nearMisses 诊断面要求非授权态行（draft/rejected/retired…）
 *   可见，只喂授权态行即诊断失明（同资产占键/吊销等近似命中报不出来）。
 *
 * v0 诚实边界（头注冻结——真单刀逐项补齐，观察模式即本刀边界）：
 *   - **真单的生产改动路径（git apply / 框架资产文件写）尚不存在**——本刀把闸挂到 serve
 *     启动自检：启动时对「框架资产清单」的当前 hash 逐项跑 authorize。**观察模式**：
 *     unauthorized 如实报告（日志 + ESCALATE 事件落账）**不阻断启动**；阻断模式（启动拒/
 *     写径拦截）+ 资产面扩展（清单从极小样例集扩到全资产面）归真单刀。
 *   - 沙箱真执行器 / 灰度 / 切权 / 复盘（17-§3 进化行后半链）仍归后续刀——本文件只接
 *     「判负」一环，不碰闸门决策链。
 *
 * 拟稿待批点（本文件口径，汇报后走批示流）：
 *   - **框架资产清单样例集**（FROZEN_FRAMEWORK_ASSETS）：v0 取本仓三件「改动必惊动制作人」
 *     的冻结面——AGENTS.md（仓级纪律本体）/ packages/contract/cases.json（契约规格标尺，
 *     AGENTS.md 纪律 2「验收命令冻结后禁改」）/ docs/20-工程总规程.md（工程总规程本体，
 *     文末「本规程自身变更走提案单+制作人批准」）。三件按 20-§九 语义均属判据类
 *     （criterion，宪法内核）——闸门恒 escalate 面。清单内容与「资产类型标注进清单」
 *     归真单刀批示（v0 authorize 只消费 asset_path×diff_hash，类型不进判定面）。
 *   - **空库首启跳过语义**：candidates 表零行（无任何进化史）时，对清单逐项判负会把全部
 *     资产误报 unauthorized（首启无候选是出厂态，非违规）——首启观察模式**跳过全部检查
 *     （checked=0，skipped='empty-ledger'）并如实上报**（日志明示），不落事件。首批候选
 *     获批后此语义自然失效（表非空即查）。
 *   - **ESCALATE 哨兵单号**：events.issue 契约必填，自检无单号语境——取 serve 心跳哨兵
 *     同款 '-'（engine heartbeatIssue 拟稿口径）；专属哨兵（如 'evolve-guard'）待批示。
 *   - **diff 哈希口径**：v0 = 文件当前字节 sha256（`sha256:<hex>` 前缀形，e2e diffHash
 *     同款）；「当前 hash 命中 approved/promoted 候选」即放行。真 diff（补丁文本哈希）与
 *     资产基线锚定归真单刀。
 *   - **文件缺失的处置**：清单资产不可读（v0 清单以 cwd 相对路径解析，serve 从仓根起跑的
 *     demo 口径）= 检查面错误（errors 如实上报，不阻断启动、不落事件）——缺失不是「改动」，
 *     不冒充 unauthorized；资产面扩展时随阻断模式一并收口。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { assertChangeAuthorized } from '@studio-next/core'
import type { CandidateRecord, ChangeRejectedError, NearMiss, ProposedChange } from '@studio-next/core'
import type { EventRecord } from '@studio-next/contract'
import { CANDIDATE_STATUS_VALUES } from '@studio-next/store'
import type { CandidateRow, Ledger } from '@studio-next/store'

// ————————————————————————— 判负闸本体 —————————————————————————

/** daemon 判负闸句柄：authorize 即判——命中返回授权候选；未命中抛 ChangeRejectedError（core 判定核） */
export interface EvolveGuard {
  authorize(assetPath: string, diffHash: string): CandidateRecord
}

/** store 行 → core 记录（verification unknown 收窄回 core 形状——写入口径保证可收窄，e2e toCoreRecord 同款） */
function toCoreRecord(row: CandidateRow): CandidateRecord {
  return {
    id: row.id,
    asset_type: row.asset_type,
    asset_path: row.asset_path,
    version: row.version,
    diff_hash: row.diff_hash,
    blast_radius: row.blast_radius,
    verification: row.verification as CandidateRecord['verification'],
    parent_id: row.parent_id,
    status: row.status,
  }
}

/** 台账视角候选全集（全状态集一查——判负入参语义见文件头注） */
function candidateUniverse(ledger: Ledger): CandidateRecord[] {
  return ledger.candidatesByStatus([...CANDIDATE_STATUS_VALUES]).map(toCoreRecord)
}

/**
 * 判负闸工厂：authorize = core assertChangeAuthorized ∘ 台账全集。每次调用现查台账
 * （单写者下无脏读面；自检面量级=清单长度，逐项现查保证判负恒对台账当下负责）。
 */
export function createEvolveGuard(ledger: Ledger): EvolveGuard {
  return {
    authorize(assetPath: string, diffHash: string): CandidateRecord {
      const change: ProposedChange = { asset_path: assetPath, diff_hash: diffHash }
      return assertChangeAuthorized(change, candidateUniverse(ledger))
    },
  }
}

// ————————————————————————— 框架资产清单（v0 极小样例集） —————————————————————————

/** 清单条目：path=仓相对路径（v0 以进程 cwd 解析——锚定口径见头注拟稿）；why=冻结依据（日志人读） */
export interface FrozenAsset {
  path: string
  why: string
}

/** v0 极小样例集（拟稿待批，头注清单）：三件「改动必惊动制作人」的仓级冻结面（20-§九 判据类语义） */
export const FROZEN_FRAMEWORK_ASSETS: readonly FrozenAsset[] = [
  { path: 'AGENTS.md', why: '仓级纪律本体（worker 第一上下文——纪律 5「不伪造不隐瞒」等的载体）' },
  { path: 'packages/contract/cases.json', why: '契约规格标尺（AGENTS.md 纪律 2「验收命令冻结后禁改」）' },
  { path: 'docs/20-工程总规程.md', why: '工程总规程本体（文末：本规程自身变更走提案单+制作人批准）' },
]

/** 文件当前字节哈希（`sha256:<hex>` 前缀形——e2e diffHash 同款；口径拟稿见头注） */
function fileHash(absolutePath: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(absolutePath)).digest('hex')}`
}

// ————————————————————————— serve 启动自检（v0 观察模式） —————————————————————————

/** 判负发现（unauthorized 项——ESCALATE note 的源料；nearMisses 即 core 诊断原文） */
export interface UnauthorizedFinding {
  asset_path: string
  diff_hash: string
  message: string
  nearMisses: readonly NearMiss[]
}

/** 自检汇报（serve 启动面观测 + 测试断言面；JSON 可序列化） */
export interface EvolveSelfCheckReport {
  /** 实际跑 authorize 的资产数（空库跳过=0；文件缺失不计——计 errors） */
  checked: number
  authorized: number
  unauthorized: readonly UnauthorizedFinding[]
  /** 空库首启（candidates 零行）→ 跳过全部检查（零检查如实——头注拟稿语义） */
  skipped: 'empty-ledger' | null
  /** 检查面错误（资产文件缺失/不可读等——如实上报，不阻断启动、不落事件） */
  errors: readonly string[]
  /** 本次自检落的 ESCALATE 事件（「无 candidate id 判负」的台账留痕面——note 携 nearMisses 摘要） */
  events: readonly EventRecord[]
}

/** 自检依赖（serve 装配注入；manifest/hashFile/fileExists 测试可注入确定性替身） */
export interface EvolveSelfCheckDeps {
  ledger: Ledger
  clock: () => number
  /** 事件 id 生成器（daemon 持 ULID——src/id.ts；测试注入确定性序列） */
  makeId: (ts: number) => string
  company: string
  actor: string
  dept: string
  /** events.issue 哨兵（契约必填；缺省 '-'——engine heartbeatIssue 拟稿口径，头注拟稿） */
  issue?: string
  log: (line: string) => void
  /** 判负闸（缺省 createEvolveGuard(ledger)） */
  guard?: EvolveGuard
  /** 资产清单（缺省 FROZEN_FRAMEWORK_ASSETS） */
  manifest?: readonly FrozenAsset[]
  /** 文件存在性（缺省 existsSync，cwd 相对解析——v0 锚定口径见头注） */
  fileExists?: (assetPath: string) => boolean
  /** 文件当前 diff 哈希（缺省 sha256 字节哈希；测试注入确定性值） */
  hashFile?: (assetPath: string) => string
}

/**
 * serve 启动自检（v0 观察模式，接线点=buildServeRuntime）：
 *   1. 空库首启（candidates 零行）→ 跳过全部检查，日志如实（不误报不落事件）；
 *   2. 逐资产取当前 hash → guard.authorize：命中=authorized；判负=收集 finding
 *      （ChangeRejectedError 原文 + nearMisses）；**其他异常（形状坏等）上抛**——
 *      观察模式不阻断的是「判负发现」，代码级 CONFIG_INVALID 应 fail-fast；
 *   3. 每个判负发现落一条 ESCALATE（note=core 报文原文——已含 nearMisses 摘要），
 *      tokens 零值桶（无计量事件口径，contract TokenBucketsSchema）。
 */
export function runEvolveStartupSelfCheck(deps: EvolveSelfCheckDeps): EvolveSelfCheckReport {
  const { ledger, clock, makeId, company, actor, dept, log } = deps
  const guard = deps.guard ?? createEvolveGuard(ledger)
  const manifest = deps.manifest ?? FROZEN_FRAMEWORK_ASSETS
  const fileExists = deps.fileExists ?? ((p: string): boolean => existsSync(path.resolve(p)))
  const hashFile = deps.hashFile ?? ((p: string): string => fileHash(path.resolve(p)))
  const issue = deps.issue ?? '-'

  // 空库首启：零候选=进化史未开卷，逐项判负会把出厂态误报 unauthorized——零检查如实上报
  if (candidateUniverse(ledger).length === 0) {
    log('[evolve-guard] 台账零候选（空库首启）：冻结资产判负自检跳过——零检查如实上报，不落事件（首启语义拟稿见 src/evolve-guard.ts 头注）')
    return { checked: 0, authorized: 0, unauthorized: [], skipped: 'empty-ledger', errors: [], events: [] }
  }

  const unauthorized: UnauthorizedFinding[] = []
  const errors: string[] = []
  const events: EventRecord[] = []
  let checked = 0
  let authorized = 0

  for (const asset of manifest) {
    if (!fileExists(asset.path)) {
      errors.push(`资产文件缺失：${asset.path}（${asset.why}）——无法取当前 hash，不冒充 unauthorized（v0 清单以 cwd 解析，锚定口径见 evolve-guard.ts 头注）`)
      continue
    }
    const hash = hashFile(asset.path)
    checked += 1
    try {
      guard.authorize(asset.path, hash)
      authorized += 1
    } catch (err) {
      // 只收判负（CONFIG_INVALID/evolve/unauthorized）——core 判定核的其他异常（形状坏等）
      // 是代码级问题，如实上抛（观察模式不掩盖 bug）
      const rejected = err as ChangeRejectedError
      if (rejected.category !== 'CONFIG_INVALID' || rejected.subcause !== 'evolve/unauthorized') throw err
      unauthorized.push({
        asset_path: asset.path,
        diff_hash: hash,
        message: rejected.message,
        nearMisses: rejected.nearMisses,
      })
    }
  }

  // 台账留痕面（20-§九「无 candidate id 判负」）：一发现一事件；note=core 报文原文
  //（已含 nearMisses 摘要——不伪造不隐瞒，诊断面原文落账）
  for (const finding of unauthorized) {
    const ts = clock()
    const rec: EventRecord = {
      id: makeId(ts),
      ts,
      company,
      issue,
      event: 'ESCALATE',
      actor,
      attempt: 1,
      level: 1,
      dept,
      tokens: { input: 0 },
      note: `EVOLVE_GUARD 启动自检判负：${finding.message}（观察模式不阻断启动——v0 边界，阻断模式+资产面扩展归真单刀，src/evolve-guard.ts 头注）`,
    }
    const appended = ledger.appendEvent(rec)
    if (appended.appended) events.push(rec)
  }

  if (unauthorized.length === 0 && errors.length === 0) {
    log(`[evolve-guard] 启动自检：${checked} 资产全绿（当前 hash 均命中 approved/promoted 候选——20-§九 判负面，v0 观察模式）`)
  } else {
    log(
      `[evolve-guard] 启动自检：checked=${checked} authorized=${authorized} unauthorized=${unauthorized.length}` +
        `（已落 ESCALATE 事件 ${events.length} 条——观察模式不阻断启动；errors=${errors.length}）`,
    )
    for (const err of errors) log(`[evolve-guard] ${err}`)
  }

  return { checked, authorized, unauthorized, skipped: null, errors, events }
}
