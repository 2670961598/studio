/**
 * capability/supply —— 能力供给 CAP 记录写面（REC-CAP-01 声明 / REC-CAP-RECEIPT 探测回执）
 *
 * 规格依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/11 §9 CAP 能力供给族（REC-CAP-01 能力声明＝九维主张、REC-CAP-02 资格认定、
 *     REC-CAP-RECEIPT 能力回执〔宿主回执或独立探测通道，自报仅线索〕、REC-CAP-ACTIVATE）；
 *     §1.8 CAP 族 4 类登记；§0.4（身份/幂等/双时间轴）、§0.5（生效槽）、§0.7（证明边界）；
 *   - docs/v2/07 §一（九维声明与状态链/采集者独立性）、§六（HCL 族闭合判据）；
 *   - docs/v2/02 §五（声明是主张非认定；能力退化/成本失控不得静默）；
 *   - docs/17-§2（主循环七相位；记录写口在判定/收割相位外侧的装配面）＋docs/17-§6
 *     （收割四要件之外的记录/台账面不改）；
 *   - docs/v2/14 §1.6（PORT-HIST **唯一记录写口**）——本件不另建写口、不复制记录字段：
 *     信封/族 payload 形状唯一源＝contract `records/cap.ts`，写前由 `hist.append` 机械判。
 *
 * 边界：
 *   - **形状零自造**：只做「注册面事实 → REC-CAP-01/ REC-CAP-RECEIPT 信封」的映射；
 *     不加字段、不造枚举、不改契约（契约面若需改须单内标注报批）。
 *   - REC-CAP-02 资格认定/ REC-CAP-ACTIVATE 激活批准**不在本件**：前者归独立认定位置
 *     （提供方不得自证），后者归变更链三门；本件不代作。
 *   - 声明是主张：`proofBoundary` 明示「未经独立资格认定、不证明已生效」；回执只覆盖
 *     被探测执行体/版本/时点，自报仅线索（`collector_identity` 如实标注通道）。
 *   - 写口失败：声明失败＝抛（装配期 fail-closed，不静默无供给记录）；回执失败＝日志
 *     明报并返回 undefined（不阻断判定面；缺口决策另经 `judgeGap` fail-closed 拒绝派发）。
 */
import { createHash } from 'node:crypto'
import type { ExecutorCapabilities } from '@studio-next/contract'
import type { HistFace, HistRecordRef } from '@studio-next/store'
import {
  judgeCapabilityGap,
  type CapabilityGapPolicy,
  type CapabilityGapRequest,
  type CapabilityGapRuling,
} from './gap.ts'

/** 冻结 schema 工件引用（与 assembly/ops 同口径：v2/10 §4.1；本件不新造 $id） */
export const CAP_RECORD_SCHEMA_REF = { schemaId: 'studio-next.records.v2', schemaVersion: '1.0.0' } as const

/** 依循的 V2 规范版本（与 contract artifacts 的 SPEC_VERSION 同值） */
export const CAP_RECORD_SPEC_VERSION = '2.0.0'

/** CAP 族初始类型版本（v2/11 §十五-4 全部 74 类初始类型版本 1.0.0） */
export const CAP_RECORD_TYPE_VERSION = '1.0.0'

/** 写入路径名（v2/11 §0.2-1：写入者与具名决定者分开） */
export const CAP_RECORD_WRITTEN_BY = 'daemon:engine/capability'

/** 供给登记面：执行体名＋能力声明（来源＝注册表/agent.yaml；声明是主张非认定） */
export interface CapabilitySupplyExecutor {
  readonly name: string
  readonly capabilities: ExecutorCapabilities
  /** 实现与来源（如 agent.yaml 路径/内置 fake——声明来源可回指） */
  readonly source: string
}

/** 已落库声明（供回执引用；digest＝payload 内容摘要，回执不得外推） */
export interface CapabilityDeclarationRef {
  readonly executor: string
  readonly recordId: string
  readonly digest: string
}

/** 探测回执入参（engine 派发前 `adapter.detect()` 的事实；负向结果必须可记录） */
export interface CapabilityProbeRequest {
  readonly executor: string
  readonly version: string
  readonly ok: boolean
  readonly gaps: readonly string[]
  /** 触发探测的单号（可缺省＝装配/启动探测） */
  readonly ticket?: string
  /** 观测时点（ISO；调用方时钟） */
  readonly at: string
}

/** 能力供给记录面（engine 注入；缺省不注入＝面关零行为变更） */
export interface CapabilitySupplyFace {
  /** 落 REC-CAP-01 声明（每执行体一条；同进程幂等——重复调用返回既有缓存） */
  ensureDeclared(): readonly CapabilityDeclarationRef[]
  /** 落 REC-CAP-RECEIPT 回执（失败不阻断判定面：日志明报＋undefined） */
  recordProbe(request: CapabilityProbeRequest): HistRecordRef | undefined
  /** 五出口决策（纯判定＋出口留痕；fail-closed 由调用方执行） */
  judgeGap(request: CapabilityGapRequest): CapabilityGapRuling
}

/** 装配依赖（全注入：hist＝PORT-HIST 唯一写口，makeId/now＝确定性时钟） */
export interface CapabilitySupplyDeps {
  readonly hist: HistFace
  readonly company: string
  readonly executors: readonly CapabilitySupplyExecutor[]
  readonly makeId: (ts: number) => string
  readonly now: () => number
  /** 出口策略覆盖位（缺省＝gap.ts 保守档） */
  readonly policy?: CapabilityGapPolicy
  readonly log?: (line: string) => void
}

/** 九维声明（v2/07 §一 正文；值取注册面事实，不虚构已验证能力） */
function claimOf(executor: CapabilitySupplyExecutor): Record<string, unknown> {
  const caps = executor.capabilities
  const unsupported = ['资格认定（REC-CAP-02 归独立认定位置；提供方/受益方不得自证）']
  if (!caps.session_resume) unsupported.push('原生会话续跑（session_resume=false）')
  if (!caps.budget_cap) unsupported.push('执行体侧预算硬帽（budget_cap=false——预算闸在 daemon 侧）')
  if (!caps.cancel_turn) unsupported.push('单轮取消（cancel_turn=false——只能整树 kill）')
  return {
    中立能力与类型: `executor:${executor.name}`,
    实现与来源: executor.source,
    宿主与绑定: `studio-next daemon 注册面（executor=${executor.name}）`,
    依赖与冲突: `session_resume=${String(caps.session_resume)};budget_cap=${String(caps.budget_cap)};cancel_turn=${String(caps.cancel_turn)};cost_native=${String(caps.cost_native)}`,
    输入输出与已知限制: `agents_md=${caps.agents_md}；仅经 TaskBrief/stream 端口交互`,
    副作用请求: ['子进程出工（launch/stream/kill）', '工位工作区落盘（REPORT/summary）'],
    生命周期: { supported: ['launch', 'stream', 'kill'], unsupported },
    观测与成本: caps.cost_native ? '执行体原生成本账（cost_native=true）' : '成本按价目折算/适配器自报（cost_native=false）',
    证据与已知不能: '证据＝注册面声明＋detect 探测回执（REC-CAP-RECEIPT）；未经 REC-CAP-02 独立资格认定，不证明已生效',
  }
}

/** 缺口声明证明边界（§0.7-1：证明什么/不证明什么；如实登记证据缺口） */
const DECLARATION_PROOF_BOUNDARY =
  '本记录证明执行体能力供给声明已按 REC-CAP-01 九维登记（声明是主张非认定）；不证明资格已认定（REC-CAP-02 归独立认定位置），不证明运行时已生效（以 REC-CAP-RECEIPT 为准），本轮无可引证据记录（evidence_refs=[]）'

/** 探测回执证明边界（覆盖范围/版本/时点，不外推） */
const RECEIPT_PROOF_BOUNDARY =
  '本记录证明宿主侧探测（adapter.detect）在所载执行体/版本/时点的结论并含负向发现；不证明探测范围外能力、不替代 REC-CAP-02 资格认定、不自报为「已生效」'

function digestOf(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/**
 * 建 CAP 记录写面（一 serve 进程一实例；engine 经 EngineDeps.capabilitySupply 消费）：
 *   - `ensureDeclared()`：注册面执行体逐条落 REC-CAP-01（幂等缓存）；
 *   - `recordProbe()`：detect 事实落 REC-CAP-RECEIPT（引用声明 ID＋digest，负向结果必载）；
 *   - `judgeGap()`：五出口决策（core 判定本体；出口动作留痕 trace 供事件 note）。
 */
export function createCapabilitySupplyFace(deps: CapabilitySupplyDeps): CapabilitySupplyFace {
  const declared = new Map<string, CapabilityDeclarationRef>()
  let bootSequence: string | undefined

  const declarationRefOf = (executor: string): CapabilityDeclarationRef | undefined => declared.get(executor)

  const ensureDeclared = (): readonly CapabilityDeclarationRef[] => {
    if (declared.size === deps.executors.length) return [...declared.values()]
    const bootAt = deps.now()
    const at = iso(bootAt)
    bootSequence ??= `serve-boot:${at}`
    for (const executor of deps.executors) {
      if (declared.has(executor.name)) continue
      const payload = {
        claim: claimOf(executor),
        claimant: `executor:${executor.name}`,
        version: CAP_RECORD_TYPE_VERSION,
        evidence_refs: [],
      }
      const record = {
        recordId: deps.makeId(bootAt),
        recordType: 'REC-CAP-01',
        schemaRef: CAP_RECORD_SCHEMA_REF,
        specVersion: CAP_RECORD_SPEC_VERSION,
        companyRef: deps.company,
        producedAt: at,
        producer: { decidedBy: `executor:${executor.name}`, writtenBy: CAP_RECORD_WRITTEN_BY },
        basisRefs: [],
        payload,
        effectiveState: 'effective',
        effectiveTime: { from: at },
        proofBoundary: DECLARATION_PROOF_BOUNDARY,
        idempotencyKey: {
          companyRef: deps.company,
          recordType: 'REC-CAP-01',
          subjectId: `executor:${executor.name}`,
          operationClass: 'declare',
          requesterSequence: bootSequence,
        },
      }
      const ref = deps.hist.append(record)
      declared.set(executor.name, { executor: executor.name, recordId: ref.recordId, digest: digestOf(payload) })
      deps.log?.(`[capability] REC-CAP-01 已落库：executor=${executor.name} record=${ref.recordId}${ref.appended ? '' : '（幂等重放）'}`)
    }
    return [...declared.values()]
  }

  const recordProbe = (request: CapabilityProbeRequest): HistRecordRef | undefined => {
    const declaration = declarationRefOf(request.executor)
    if (declaration === undefined) {
      deps.log?.(`[capability] 探测回执未落库：执行体 ${request.executor} 无 REC-CAP-01 声明引用（不造悬空引用）`)
      return undefined
    }
    const atMs = Date.parse(request.at)
    const record = {
      recordId: deps.makeId(Number.isFinite(atMs) ? atMs : deps.now()),
      recordType: 'REC-CAP-RECEIPT',
      schemaRef: CAP_RECORD_SCHEMA_REF,
      specVersion: CAP_RECORD_SPEC_VERSION,
      companyRef: deps.company,
      producedAt: request.at,
      producer: { decidedBy: `executor:${request.executor}/detect`, writtenBy: CAP_RECORD_WRITTEN_BY },
      basisRefs: [],
      payload: {
        receipt_kind: 'probing',
        capability_ref: { refType: 'REC-CAP-01', refId: declaration.recordId, refVersion: CAP_RECORD_TYPE_VERSION },
        capability_digest: declaration.digest,
        probe_method: { method: 'adapter.detect', checklist_ref: { refId: 'v2/12', refVersion: '2.0.0' } },
        environment: { host_form: 'studio-next.worker', environment: deps.company, version: request.version },
        result: {
          proved: request.ok,
          evidence_refs: [{ refId: `runtime:detect:${request.executor}`, refVersion: '1.0.0' }],
          negative_findings: [...request.gaps],
        },
        collector_identity: {
          collector: `executor:${request.executor}/detect`,
          channel: '执行体自报探测（adapter.detect；仅线索）',
          independent: false,
        },
        observed_at: request.at,
      },
      effectiveState: 'effective',
      effectiveTime: { from: request.at },
      proofBoundary: RECEIPT_PROOF_BOUNDARY,
      idempotencyKey: {
        companyRef: deps.company,
        recordType: 'REC-CAP-RECEIPT',
        subjectId: `executor:${request.executor}`,
        operationClass: 'probe',
        requesterSequence: `${request.ticket ?? 'boot'}:${request.at}`,
      },
    }
    try {
      const ref = deps.hist.append(record)
      deps.log?.(
        `[capability] REC-CAP-RECEIPT 已落库：executor=${request.executor} proved=${String(request.ok)}` +
          `${request.ticket !== undefined ? ` ticket=${request.ticket}` : ''} record=${ref.recordId}`,
      )
      return ref
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      deps.log?.(`[capability] REC-CAP-RECEIPT 未落库（写口 fail-closed 上报，不改判探测事实）：${message}`)
      return undefined
    }
  }

  const judgeGap = (request: CapabilityGapRequest): CapabilityGapRuling => {
    let ruling: CapabilityGapRuling
    try {
      ruling = deps.policy === undefined ? judgeCapabilityGap(request) : judgeCapabilityGap(request, deps.policy)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ruling = {
        ok: false,
        subcause: 'gap-judge-error',
        detail: `能力缺口判定异常（gap-judge-error）：${message}——fail-closed 不继续`,
        trace: `cap-gap:${request.ticket};kind=${request.kind};fail-closed=gap-judge-error`,
      }
    }
    deps.log?.(`[capability] ${ruling.trace}`)
    return ruling
  }

  return { ensureDeclared, recordProbe, judgeGap }
}
