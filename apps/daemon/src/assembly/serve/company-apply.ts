/**
 * serve/company-apply —— 公司快照整组应用段（L1 热重载与运行期挂单共用的唯一 apply 体）
 *
 * 依据（实现单引用）：
 *   - docs/38-§2 L1（热重载：校验绿后应用段＝岗播种/移除→快照替换→engine.applyCompanyUpdate
 *     →署名上下文；失败＝旧态保持 fail-closed）；
 *   - docs/17-§2（主循环七相位——应用段只做拍边界整组换，不改相位）；
 *   - docs/v2/05-§三 DOM-01（公司目录写面唯一；本件只消费已校验快照，不写目录）；
 *   - studio-dev-541：运行期写面「提交成立→重装载→本应用段」与热重载共用同一体，
 *     防两条 apply 路径语义漂移（单一 apply 实现）。
 *
 * 拆件纪律（20-§十五.三「先拆再增」）：本件自 assembly/serve/runtime.ts 原样析出
 * （行为字节不变），runtime.ts 因此腾出行数预算接线运行期写面（600 行阈）。
 */
import { ensureAiwsTree, ensureWorkspaceTree } from '@studio-next/company'
import { DEFAULT_FLOW_TABLE } from '@studio-next/core'
import type { PeopleChange } from '@studio-next/core'
import type { CompanySnapshot, PersonRef } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import { hrApplySegment } from '../hrsync/assemble.ts'
import { reEnsureChannels } from '../channels/channels.ts'
import { seedJobs, removeMissingJobs } from '../jobs-seed/jobs-seed.ts'
import { ENGINE_CONFIG_DEFAULTS, type Engine } from '../../engine/engine.ts'
import type { HotReloadApplyReport } from '../../control/hot-reload.ts'
import type { MatrixRoomFace } from '../../engine/rooms/room-duty.ts'
import type { PromptAssembler } from '../../engine/prompt-assembly.ts'
import { logJobContractWarnings } from '../../engine/jobs/freshness.ts'
import { flowsFromWorkflows } from '../../engine/typeflows.ts'
import { makeUlid } from '../../engine/tools/id.ts'
import type { ServeConfig } from './config.ts'
import type { daemonIdentity } from './config.ts'

/** 应用段依赖（runtime.ts 装配期注入；全部为既有闭包/活持有者） */
export interface CompanyApplyDeps {
  readonly config: ServeConfig
  readonly ledger: Ledger
  readonly clock: () => number
  readonly log: (line: string) => void
  /** 公司面活持有者（docs/38-§2 L1 替换点——闭包零重建） */
  readonly companyState: { snapshot: CompanySnapshot }
  readonly engine: Engine
  readonly identity: ReturnType<typeof daemonIdentity>
  readonly makeAssembler: () => PromptAssembler
  /** .AIWS 员工工作区树根（DEV-28） */
  readonly aiwsRoot: string
  readonly aiwsClock: () => Date
  /** 常驻角色工作目录树根（studio-dev-723；docs/90-§八；与 company/ 平级、不进 git） */
  readonly workspaceRoot: string
  readonly workspaceClock: () => Date
  /** 频道供给面（130-P3；matrixChannels 关＝返回 undefined） */
  readonly roomFace: () => MatrixRoomFace | undefined
  /** 人事变更双写面（129-C people-change 源 publish；面关＝不注入） */
  readonly publish?: (changes: readonly PeopleChange[], batchId: string) => number
}

/** 构造应用段：`apply(next)` 幂等可重入；抛错＝apply 整体失败（旧态保持，调用方 fail-closed） */
export function createCompanyApplySegment(deps: CompanyApplyDeps): (next: CompanySnapshot) => Promise<HotReloadApplyReport> {
  const { config, ledger, clock, log, companyState, engine, identity } = deps
  const aiwsClock = deps.aiwsClock
  return async (next: CompanySnapshot): Promise<HotReloadApplyReport> => {
    let seeded = 0
    let kept = 0
    let removed = 0
    // .AIWS 增量同步先行（DEV-28，docs/43-§五「人事变树变」）：新员工得文件夹、
    // 离司/下线归档不删——**先于**一切持有者替换（本步抛错=apply 整体失败 → 旧配置
    // 保持的既有 RELOAD_APPLY_FAILED 面，fail-closed；树与配置不半换）
    const synced = ensureAiwsTree(deps.aiwsRoot, next.departments, next.people, { slug: next.slug, now: aiwsClock })
    if (synced.created > 0 || synced.archived.length > 0) {
      log(
        `[serve] .AIWS 增量同步（reload）：新建 ${synced.created}、归档 ${synced.archived.length}${synced.archived.length > 0 ? `（${synced.archived.join('、')}——内容保留不删）` : ''}`,
      )
    }
    // 常驻角色工作目录树增量同步（studio-dev-723；docs/90-§八）：新角色得家、离司归档不删；
    // 先于持有者替换（抛错=apply 整体失败，旧态保持）。
    const wsSynced = ensureWorkspaceTree(
      deps.workspaceRoot,
      next.departments.map((dept) => ({ path: dept.path, leader: dept.leader })),
      next.people.map((person) => ({ id: person.id, dept: person.dept, ...(person.role !== undefined ? { role: person.role } : {}), ...(person.name !== undefined ? { name: person.name } : {}) })),
      { slug: next.slug, now: deps.workspaceClock },
    )
    if (wsSynced.created > 0 || wsSynced.archived.length > 0) {
      log(`[serve] 工作目录树增量同步（reload）：新建 ${wsSynced.created}、归档 ${wsSynced.archived.length}${wsSynced.archived.length > 0 ? `（${wsSynced.archived.join('、')}——内容保留不删）` : ''}`)
    }
    // —— 人事同步入队（DEV-48，docs/52-§5.2 步2-3/§9.1）：diff 分类→三面任务入队
    //    （哨兵票；diff 基=台账镜像现值零平台 IO；hrSync 关=零动作）——体=hrApplySegment；
    //    抛错=apply 整体失败保持旧态（fail-closed）。
    const hr = hrApplySegment({ enabled: config.hrSync, ledger, prev: companyState.snapshot, next, company: config.company, clock, makeId: makeUlid, log, ...(deps.publish !== undefined ? { publish: deps.publish } : {}) })
    if (config.jobs) {
      // 台账段先行（幂等可重入——seedJobs 逐岗独立 upsert；失败重试下一形态自愈）
      const s = seedJobs(ledger, next.jobs, clock())
      seeded = s.seeded
      kept = s.kept
      removed = removeMissingJobs(ledger, next)
    }
    // 台账镜像（DEV-48，docs/52-§5.2 步4）：people/departments 直覆（status 列归
    // 任务执行写面 setPersonStatus，镜像不动——ledger.ts 头注口径）；幂等可重入。
    // store v2 面本单前从未接 daemon——hrSync 开=启动+reload 双点接线
    if (config.hrSync) {
      ledger.syncCompany(next)
    }
    // 纯赋值段（不抛）：快照持有者 → 引擎整组换 → 署名上下文
    companyState.snapshot = next
    // 频道地图重供给（130-P3 §6.7.3-③）：apply 段同步推进、供给异步收敛（执行体
    // 拆至 assembly/channels/——ensure 幂等只补差集；不入 apply 事务面）
    const roomFace = deps.roomFace()
    if (roomFace !== undefined) reEnsureChannels(roomFace, log)
    // 类型流热换（N1，DEV-43）：拍边界换表——在途单下拍 decide 对新表重解析
    //（resolveTicketFlow 同函数；跨边界遇未知态=既有 L1 热重载纪律 NOOP_UNKNOWN_STATE，
    //  状态权威在平台侧、不猜不动）；无 workflows=flows:undefined=回内置缺省表
    const nextTypeFlows = flowsFromWorkflows(next.workflows)
    // 岗契约装载警告（127-A）：热重载 apply 同面——拍边界随新快照重算，不阻断
    logJobContractWarnings(next.jobs, nextTypeFlows, log, '（reload）')
    engine.applyCompanyUpdate({
      people: next.people,
      assembler: deps.makeAssembler(),
      defaultPersonId: (next.people[0] as PersonRef | undefined)?.id ?? '',
      deptFallback: next.departments[0]?.path ?? ENGINE_CONFIG_DEFAULTS.deptFallback,
      defaultLane: next.departments[0]?.lanes[0] ?? ENGINE_CONFIG_DEFAULTS.defaultLane,
      ...(nextTypeFlows !== undefined ? { flows: { ...DEFAULT_FLOW_TABLE, ...nextTypeFlows } } : {}),
      // 州表卫生白名单热换（127-C）：恒显式（摘声明=空数组=哨兵回全灵敏度——
      // 白名单滞留会静默吞告警，安全面须热换即时生效）
      knownForeignStates: next.knownForeignStates ?? [],
      // 批示归一层 leader 表热换（studio-dev-171）：组织变动 fail-closed（换 leader/
      // 撤部即生效——防离任 leader 批示面残留）
      directives: new Map(next.departments.map((d) => [d.path, d.leader])),
      // cost_guard 段热换（132-§6.4 单C）：恒传（摘段=undefined=闸四联动+源评估面关）
      costGuard: next.costGuard,
    })
    identity.ctx.company = next.name
    identity.ctx.dept = next.departments[0]?.path ?? ENGINE_CONFIG_DEFAULTS.deptFallback
    identity.ctx.level = Math.max(1, next.level)
    return { jobsSeeded: seeded, jobsKept: kept, jobsRemoved: removed, hr }
  }
}
