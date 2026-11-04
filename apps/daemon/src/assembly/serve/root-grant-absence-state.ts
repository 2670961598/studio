/**
 * serve/root-grant-absence-state —— 根授予无锚启动状态机（studio-dev-707 段1；#648 方案 c）
 *
 * 依据：docs/v2/03 §3.1.1（无锚公司三态与升级出口）、docs/v2/15 §7.3（SEC-ROOT-02 无锚装配态）、
 * docs/v2/17 NEG-ORG-09a–d、docs/17-§2（无锚声明面）。
 *
 * 状态（优先级）：anchored（rootGrant 注入/已落库 REC-AUTH-01>0）＞ unanchored-declared（声明存在且
 * 未到期）＞ unanchored-undeclared（无声明无链）。冲突/过期一律 CONFIG_INVALID 拒启：
 *   - 声明 且（rootGrant 注入 或 REC-AUTH-01>0）→ 双态并行=歧义 → 拒；
 *   - 声明 Until 已过期 → 拒（不得静默转 undeclared 继续跑）。
 * 段1：启动判定＋日志；段2：追加 daemon_kv 投影/ESCALATE 去重/面板块（root-grant-absence-projection.ts）。
 * rootGrant 注入语义：`rootGrantPresent`（runServe 生产注入路径当前**未接线**——runtime.ts 受 600 行阈与
 * 单刀边界约束，#530 根委任生产件未落；调用方可显式传入供测试/未来接线）。
 *
 * 边界：不写 REC-AUTH-01、不伪造外部事实、不改写面判据；读面只 count（带 ReadContext 程序读）。
 */
import type { ReadContext } from '@studio-next/contract'
import { configInvalid } from '@studio-next/contract'
import { createHistFace, type Ledger } from '@studio-next/store'
import type { ServeConfig } from './config.ts'
import {
  ROOT_GRANT_ABSENCE_WARN_DAYS,
  rootGrantAbsenceUntilStatus,
  type RootGrantAbsenceDeclaration,
} from './root-grant-absence.ts'
import { projectRootGrantAbsence, readRootGrantInjected } from './root-grant-absence-projection.ts'

/** 三态（docs/v2/03 §3.1.1 / v2/15 §7.3） */
export type RootGrantAbsenceState = 'anchored' | 'unanchored-declared' | 'unanchored-undeclared'

export interface RootGrantAbsenceResolution {
  readonly state: RootGrantAbsenceState
  /** 已落库 REC-AUTH-01 行数（启动判定读数；不冒充授予事实） */
  readonly authGrantCount: number
  readonly declaration?: RootGrantAbsenceDeclaration
  /** 外部根授予事实是否已注入（rootGrantPresent；当前 runServe 无生产注入路径） */
  readonly rootGrantPresent: boolean
  /** 启动日志行（调用方按序打印；含 G8 双角色残余标注） */
  readonly notice: readonly string[]
}

/** REC-AUTH-01 读上下文（程序读；与 records 写面前件读同纪律，不享无上下文旁路） */
function recordsReadContext(company: string): ReadContext {
  return {
    readScope: {
      company: { companyId: company, slug: company },
      fields: ['records.record.payload'],
      purpose: 'root grant absence audit（records 只读计数；studio-dev-707）',
    },
    caller: { callerId: 'daemon:records/root-grant-absence-state', kind: 'program', programRef: 'studio-next/daemon' },
  }
}

/** 统计 REC-AUTH-01 行数（只读；读失败=fail-closed 拒启，不把读失败当 0） */
export function countRootGrantFacts(ledger: Ledger, company: string): number {
  try {
    const hist = createHistFace(ledger.db)
    return hist.query({ company, type: 'REC-AUTH-01' }, recordsReadContext(company)).length
  } catch (err) {
    throw configInvalid(
      'serve/root-grant-absence:authority-read-failed',
      `根授予无锚判定无法读取 REC-AUTH-01 计数（fail-closed，不猜 0）：${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** 纯判定（测试可注入 authGrantCount；不触 IO） */
export function decideRootGrantAbsenceState(input: {
  readonly declaration?: RootGrantAbsenceDeclaration
  readonly authGrantCount: number
  readonly rootGrantPresent?: boolean
  readonly now: number
}): RootGrantAbsenceResolution {
  const { declaration, authGrantCount, now } = input
  const rootGrantPresent = input.rootGrantPresent === true
  const residual = '含 G8 双角色拒写残余（ENG-0，另单）'
  if (declaration !== undefined) {
    const untilStatus = rootGrantAbsenceUntilStatus(declaration.until, now)
    if (untilStatus === 'expired') {
      throw configInvalid(
        'serve/root-grant-absence:until-expired',
        `无锚声明 Until 已过期（${declaration.until}）——不得无限期降级/静默续期，须取得真实外部事实或重新声明（docs/v2/03 §3.1.1）`,
      )
    }
    if (authGrantCount > 0 || rootGrantPresent) {
      throw configInvalid(
        'serve/root-grant-absence:declaration-conflicts-anchored',
        `无锚声明与${rootGrantPresent ? '已注入 RootGrantFact' : `已落库 REC-AUTH-01（${String(authGrantCount)} 行）`}并存＝歧义态，拒绝启动（声明不是授予；docs/v2/03 §3.1.1 / NEG-ORG-09c）`,
      )
    }
    const notice: string[] = [
      `[serve] 根授予无锚已声明（declaredBy=${declaration.declaredBy} until=${declaration.until}）：REC-AUTH-01 不写、REC-LIFE-01 保持 fail-closed；状态=unanchored-declared；${residual}`,
    ]
    if (untilStatus === 'expiring') {
      const days = Math.max(0, Math.ceil((new Date(declaration.until).getTime() - now) / (24 * 60 * 60 * 1000)))
      notice.push(
        `[serve] 根授予无锚声明临期（until=${declaration.until}，剩余约 ${String(days)} 天 ≤${String(ROOT_GRANT_ABSENCE_WARN_DAYS)} 天）：到期将 CONFIG_INVALID 拒启——请制作人签立外部事实（docs/v2/03 §3.1.1）`,
      )
    }
    return { state: 'unanchored-declared', authGrantCount, rootGrantPresent, declaration, notice }
  }
  if (rootGrantPresent || authGrantCount > 0) {
    return {
      state: 'anchored',
      authGrantCount,
      rootGrantPresent,
      notice: [
        rootGrantPresent
          ? '[serve] 根授予外部事实已注入（RootGrantFact）：状态=anchored'
          : `[serve] 根授予锚已存在（REC-AUTH-01×${String(authGrantCount)}）：状态=anchored`,
      ],
    }
  }
  return {
    state: 'unanchored-undeclared',
    authGrantCount,
    rootGrantPresent,
    notice: [
      `[serve] 根授予无锚未声明（欠账）：REC-AUTH-01/REC-LIFE-01 保持 fail-closed；状态=unanchored-undeclared；${residual}`,
    ],
  }
}

/** 启动判定（run.ts 在 records 相位 0 装载之后调用；日志经注入 log 打印） */
export function resolveRootGrantAbsenceState(args: {
  readonly config: ServeConfig
  readonly ledger: Ledger
  readonly log: (line: string) => void
  readonly now?: () => number
}): RootGrantAbsenceResolution {
  const authGrantCount = countRootGrantFacts(args.ledger, args.config.company)
  const rootGrantPresent = readRootGrantInjected(args.ledger, args.log)
  const now = args.now?.() ?? Date.now()
  const resolution = decideRootGrantAbsenceState({
    ...(args.config.recordRootGrantAbsence !== undefined ? { declaration: args.config.recordRootGrantAbsence } : {}),
    authGrantCount,
    rootGrantPresent,
    now,
  })
  for (const line of resolution.notice) args.log(line)
  // 段2 投影（kv/ESCALATE/面板块；best-effort 恒不抛——失败只 log、不阻断启动）
  projectRootGrantAbsence({
    ledger: args.ledger,
    company: args.config.company,
    state: resolution.state,
    authGrantCount,
    rootGrantPresent,
    ...(resolution.declaration !== undefined ? { declaration: resolution.declaration } : {}),
    now,
    log: args.log,
  })
  return resolution
}
