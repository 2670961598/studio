/**
 * assemble —— 人事同步器运行时装配体（DEV-48，docs/52-§九；BC-S2 先拆再增：自 serve.ts 拆出）
 *
 * 规格依据：docs/52-§九（hrSync 开=启动期台账镜像接线 syncCompany + 断电复位
 * resetStaleHrSyncApplying + 三面执行体装配 + 消化器注入 EngineDeps.hrSync）；
 * §5.2 步2-3/§9.1（L1 热重载 apply 段 diffPeople 入队——哨兵票，零平台 IO）。
 * 配置面在 ./config.ts；消化器实现体在 src/engine/hrsync/hrsync.ts。
 *
 * hrSync 关=零装配零注入，既有行为字节不变（缺省关——docs/52-§九）。
 */

import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import type { CompanySnapshot, FlowPlatform } from '@studio-next/contract'
import { redactOutbound } from '@studio-next/core'
import type { Ledger } from '@studio-next/store'
import { buildContext } from '@studio-next/taiga'
import {
  createHrSyncDigester,
  enqueueHrBatch,
  type HrEnqueueResult,
  type HrRoomAliases,
  type HrSyncTickReport,
  type MatrixHrFace,
  type TaigaHrFace,
} from '../../engine/hrsync/hrsync.ts'
import { createTaigaHrFace } from '../../engine/hrsync/taiga-face.ts'
import { loadTaigaFieldMap, resolveTaigaAuth } from '../platform/wire.ts'
import type { ServeConfig } from '../serve.ts'
import { collectHrSecrets, parseHrRooms } from './config.ts'

/** 装配入参（serve.ts buildServeRuntime 现场件；raw platform=未经网关代理的原件） */
export interface AssembleHrSyncArgs {
  config: ServeConfig
  /** Matrix 人事执行面工厂（buildServeRuntime opts.hrMatrixFace——hrMatrix: true 时必在） */
  hrMatrixFace?: () => MatrixHrFace
  /** 出站脱敏补充秘密面（opts.hrKnownSecrets——matrix shared_secret 等装配单元持有物） */
  hrKnownSecrets?: readonly string[]
  ledger: Ledger
  snapshot: CompanySnapshot
  clock: () => number
  log: (line: string) => void
  /** engine 配置的 deptFallback（对账单落账部门缺省——engine 同源） */
  engineDeptFallback: string
  /** raw platform（未包网关代理的原件）——对账单开单走原件（网关收口的是 worker 写路径） */
  platformIssues: FlowPlatform['issues']
  /** ULID 生成器（对账单号/事件号——serve 装配同源 makeUlid） */
  makeId: (ts: number) => string
}

/**
 * 人事同步器装配（docs/52-§九）：返回消化器（注入 EngineDeps.hrSync——相位 7 尾
 * drain）；hrSync 关=undefined（零注入零行为）。启动期顺带台账镜像接线与断电复位。
 */
export function assembleHrSync(args: AssembleHrSyncArgs): { drain(): Promise<HrSyncTickReport> } | undefined {
  const { config, ledger, snapshot, clock, log } = args
  if (!config.hrSync) return undefined
  const knownSecrets = collectHrSecrets(process.env, args.hrKnownSecrets)
  const redact = (text: string): string => redactOutbound(text, knownSecrets)
  const faces: { taiga?: TaigaHrFace; matrix?: MatrixHrFace; rooms?: HrRoomAliases } = {}
  if (config.platform === 'taiga') {
    const inviteLogPath = resolvePath(config.hrTaigaInviteLog ?? '')
    faces.taiga = createTaigaHrFace({
      context: buildContext({
        baseUrl: config.taigaUrl ?? '',
        project: config.taigaProject ?? '',
        auth: resolveTaigaAuth(config.taigaAuth ?? 'password'),
        ...(config.taigaEntity !== undefined ? { entity: config.taigaEntity } : {}),
        ...(config.taigaFieldsFile !== undefined ? { fields: loadTaigaFieldMap(config.taigaFieldsFile) } : {}),
      }),
      baseUrl: config.taigaUrl ?? '',
      inviteLog: {
        read: (): Promise<string> => Promise.resolve(readFileSync(inviteLogPath, 'utf8')),
        polls: config.hrTaigaInvitePolls,
        intervalMs: config.hrTaigaInvitePollMs,
      },
    })
    log(`[serve] hr-sync Taiga 面：项目 ${config.taigaProject ?? ''}；邀请令牌日志 ${inviteLogPath}（轮询 ${String(config.hrTaigaInvitePolls)}×${String(config.hrTaigaInvitePollMs)}ms——docs/52-§6.1）`)
  } else {
    log('[serve] hr-sync 警告：platform 非 taiga——Taiga 面未装配，入场/升降/退场的 taiga 任务将重试至 failed（如实明报，不静默）')
  }
  if (config.hrMatrix) {
    if (args.hrMatrixFace === undefined) {
      throw new Error('CONFIG_INVALID：hrSync+hrMatrix: true 需注入 Matrix 人事面工厂（buildServeRuntime opts.hrMatrixFace）——daemon 不强依赖 @studio-next/matrix；装配单元注入 createMatrixHrFace 产物（docs/52-§七）')
    }
    faces.matrix = args.hrMatrixFace()
    const rooms = parseHrRooms(config.hrMatrixRooms ?? '')
    faces.rooms = rooms
    log(`[serve] hr-sync Matrix 面：已注入（公司房 ${rooms.company}、部门房 ${String(Object.keys(rooms.byDept).length)} 项——docs/52-§7.2）`)
  }
  // 台账镜像 + 断电复位（§5.2 步1 / §9.2 applying 超时窗）
  const mirrored = ledger.syncCompany(snapshot)
  const applyingTimeout = config.hrApplyingTimeoutMs > 0 ? config.hrApplyingTimeoutMs : config.tickMs * 10
  const stale = ledger.resetStaleHrSyncApplying(clock() - applyingTimeout)
  log(
    `[serve] hr-sync 台账接线：people ${String(mirrored.people)} / departments ${String(mirrored.departments)} 镜像落库` +
      `${stale > 0 ? `；断电复位 applying×${String(stale)}（窗 ${String(applyingTimeout)}ms）` : ''}——digest ${String(config.hrMaxPerTick)} 条/拍、重试上限 ${String(config.hrRetryLimit)}（docs/52-§9.2）`,
  )
  return createHrSyncDigester({
    ledger,
    // 对账单开单走 raw platform（不经网关代理——代理是 worker 写收口，非 daemon 自身动作）
    platform: { issues: args.platformIssues },
    clock,
    makeId: args.makeId,
    log,
    config: {
      company: config.company,
      deptFallback: args.engineDeptFallback,
      maxPerTick: config.hrMaxPerTick,
      retryLimit: config.hrRetryLimit,
      approver: 'daemon/hr-sync',
    },
    faces,
    redact,
  })
}

/** L1 热重载 apply 段的人事入队（docs/52-§5.2 步2-3/§9.1）：diff 分类 → 三面任务入队（哨兵票）。 */
export function hrApplySegment(args: {
  enabled: boolean
  ledger: Ledger
  /** 替换前快照（prev 基；台账 people 镜像现值=判别基——enqueueHrBatch 内自读） */
  prev: CompanySnapshot
  next: CompanySnapshot
  company: string
  clock: () => number
  makeId: (ts: number) => string
  log: (line: string) => void
}): HrEnqueueResult {
  if (!args.enabled) return { batchId: null, summary: '', enqueued: 0 }
  const ts = args.clock()
  const hr = enqueueHrBatch(args.ledger, {
    prev: args.prev,
    next: args.next,
    company: args.company,
    batchId: args.makeId(ts),
    ts,
  })
  if (hr.enqueued > 0) {
    args.log(`[serve] 人事批次 ${hr.batchId}：${hr.summary}（任务 ${String(hr.enqueued)} 条入队——哨兵票，相位尾消化器补单/执行）`)
  }
  return hr
}
