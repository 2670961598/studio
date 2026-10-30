/**
 * work/dispatch-seatbelt —— 派发域 seatbelt 圈定调用点（缺省最严／放宽留痕／失败不启）
 *
 * 规格依据（实现单引用——AGENTS §五.1）：
 *   - docs/plan/05 IMPL-07-09（seatbelt 调用方随动·派发域；领土 `engine/work/`）；
 *     plan/02 §五-8（接口耦合：`packages/adapters/src/agentconfig.ts` 签名变更与
 *     `apps/daemon/src/engine/` 派发域调用方互斥但验收绑定——G-5 串行段 07-08→07-09）；
 *   - docs/v2/15 §一 **SEC-FC-05 后半**：缺省最严（派工缺省按 read-only 档圈定写域）、
 *     放宽须显式授权并留痕、**派发校验失败不启动**；实际拦截能力未探＝按不支持处理；
 *   - docs/v2/12 §3.3（写域·任务派工面=未证；PRB-04 含符号链接逃逸未执行）／§3.2（分区
 *     六义·可变工作区随授权最小化）／WS-R5（派发 workspace＝该次尝试的工位目录）；
 *   - docs/v2/07 §三 EXEC-01（三 fail-closed 之一：派发前置校验失败＝不启动，不静默降级）；
 *   - 上游单 IMPL-07-08 产物：`packages/adapters/src/seatbelt.ts` 的档位面
 *     （`resolveSeatbeltGrant`＝档位语义唯一守门点、`DEFAULT_SEATBELT_PLAN`＝read-only 零
 *     写域）与 `agentconfig.ts` 的必填化签名（`builtinResolver(name, seatbelt?)`／
 *     `judgeAwareResolver(base?, seatbelt?)`／`tierAwareResolver(base?, seatbelt?)`／家族
 *     工厂第三参 SeatbeltPlan 必填）。
 *
 * 本件是**派发域的唯一 seatbelt 调用点**，三面：
 *   1. 注册面 `dispatchAdapterResolver`——把派工圈定授权绑进 07-08 的新签名（`base?`＋
 *      `seatbelt?` 两参形态）：装配的 resolver 组合从「`judgeAwareResolver(
 *      tierAwareResolver())`＝不传圈定」改为「本件带 dispatch grant」；省略＝read-only。
 *   2. 启动面 `resolveWorkerDispatchSeatbelt`——每次派发前对「该 attempt 工位＋授权面」做
 *      一次 fail-closed 校验，产出本 attempt 的圈定计划与放宽留痕：
 *        · 缺省（不传 grant）＝read-only 档、写域零放行、无留痕——**不存在「不传=不圈定」**；
 *        · 显式放宽（workspace-write）＝授权面取 `grant.writeRoots`（绝对路径、realpath
 *          归一），本 attempt 写域=工位＋显式追加产出位，逐条须落在授权面内；
 *        · 符号链接/绝对路径逃逸（realpath 越出授权面）＝CONFIG_INVALID 拒派，不剪根；
 *        · 放宽须留痕：authorization 由 07-08 守门（`seatbelt/widening-unauthorized`），
 *          留痕落账由派发域持有（本件产出 trail＋台账 note 行）。
 *   3. 启动闸 `launchWorkerDispatch`——**先校验、先留痕、后 spawn**：任一步失败即抛，
 *      `spawn`（适配器 launch＝真起子进程）一次也不会被调用（SEC-FC-05「派发校验失败
 *      不启动」的机制面；观察面=spawn 调用计数为 0）。
 *
 * 逃逸判据（NEG-RUN-04 的机制位；PRB-04 未执行前的唯一可证面）：
 *   - `(subpath …)` 在内核面**不做符号链接归一化**（seatbelt.ts 头注已知局限），所以派发面
 *     必须在启动前把「授权面 vs 实际写域」按 **realpath** 对齐：本件把工位与追加产出位
 *     一律 realpath 归一后写回计划（profile 拿到的是归一后路径，别名不构成第二入口）；
 *   - 绝对路径逃逸＝追加根不在任何授权根之下；符号链接逃逸＝realpath 后越出授权根
 *     （工位本体是符号链接、或工位内某段是符号链接指向授权面外，两形同判）；
 *   - 授权面本身可以包含符号链接（部署路径事实，如 macOS `/var`→`/private/var`）——
 *     判据按**目标**比较，不按路径字面。
 *
 * 已知缺口（如实登记，不冒充已闭合）：
 *   - **PRB-04 未执行**：实际拦截能力（域外写被拒/域内成功/符号链接逃逸）未探，本件只证
 *     「计划与留痕按档位收口、校验失败不启」，**不得**据此宣称写域已封死（v2/15 §一、
 *     v2/12 §3.3/§五）；探针执行后回写本头注与状态。
 *   - 逐 attempt 收窄需适配器新增 per-launch 写域面（当前 `DshSeatbeltOptions` 在构造期
 *     固定，dsh.ts）；本件给的是「本 attempt 写域 ⊆ 授权面」的校验与留痕，profile 实际
 *     白名单=授权面（与注册面同源）——收窄腿归 LANE-X 后续单（本单不扩 adapters）。
 *   - 引擎派发相位（`engine.ts executeDispatch`）**已接线**：`engine.ts` 在派发前调用
 *     `resolveWorkerDispatchSeatbelt`（F8 基线 `7b38e3c`）；本件提供三面 API 与「先留痕后
 *     spawn」顺序，接线面由 `ws-escape.test.ts`「接线面·真引擎」覆盖。
 *
 * 纪律：零 IO（除 realpath/lstat 只读查询）、零时钟读取、不持引擎状态；调用方注入 spawn
 * 与留痕 sink；判定不复制 core/adapters 的既有规则（档位语义唯一守门＝resolveSeatbeltGrant）。
 */
import { lstatSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  buildWorkerSeatbeltProfile,
  judgeAwareResolver,
  resolveSeatbeltGrant,
  tierAwareResolver,
} from '@studio-next/adapters'
import type { AdapterResolver, SeatbeltGrant, SeatbeltTier } from '@studio-next/adapters'
import { configInvalid } from '@studio-next/contract'
import type { TicketId } from '@studio-next/contract'

// ---------------------------------------------------------------------------
// 一、派发计划类型（校验产物；read-only 无留痕、workspace-write 必有留痕）
// ---------------------------------------------------------------------------

/** 派发圈定请求（一次派发＝一张单一次尝试；workspace 归 WS-R3 纯函数派生） */
export interface WorkerDispatchRequest {
  readonly ticket: TicketId
  /** 执行体注册名（`dsh`／`dsh-mid`／`dsh-judge` 一类；放宽须有 seatbelt 端子） */
  readonly executor: string
  /** 该次尝试的工位目录（**绝对路径**；符号链接工位=拒——派生面被改即拒派） */
  readonly workspace: string
  /**
   * 启动期圈定授权（缺省＝read-only 最严；workspace-write 须显式 tier＋绝对路径根＋
   * authorization 留痕——守门在 07-08 的 resolveSeatbeltGrant，本件不复制规则）。
   */
  readonly grant?: SeatbeltGrant | undefined
  /** 派发期追加产出位（**仅** workspace-write 档；须逐条落在授权面内，相对路径拒收） */
  readonly extraWriteRoots?: readonly string[] | undefined
}

/**
 * 放宽留痕（派发域持有落账/回执——seatbelt.ts 把「留痕落账」明确划给派发域）：
 * 谁授权（authorization）、何单（ticket）、何执行体、授权面（scopeRoots）与本次写域
 * （writeRoots）全部可判读；read-only 档不存在本记录（没有放宽就没有留痕面）。
 */
export interface DispatchWideningTrail {
  readonly ticket: TicketId
  readonly executor: string
  readonly tier: 'workspace-write'
  /** 授权留痕原文（07-08 已校验非空白；本件只透传，不改写不截断） */
  readonly authorization: string
  /** 授权面（启动期写域根，realpath 归一） */
  readonly scopeRoots: readonly string[]
  /** 本 attempt 写域（工位＋显式追加位，realpath 归一；逐条 ⊆ scopeRoots） */
  readonly writeRoots: readonly string[]
  /** 本 attempt 工位（realpath 归一后） */
  readonly workspace: string
}

/** 派发圈定计划（校验通过产物；不变量＝档位语义可机械断言） */
export interface WorkerDispatchSeatbelt {
  readonly ticket: TicketId
  readonly executor: string
  readonly tier: SeatbeltTier
  /** 本 attempt 工位（realpath 归一；留痕 note 的 workspace 段源） */
  readonly workspace: string
  /** read-only ⇒ 空数组（写域零放行）；workspace-write ⇒ 非空、realpath 归一的绝对根 */
  readonly writeRoots: readonly string[]
  /** read-only ⇒ undefined；workspace-write ⇒ 必有（放宽须留痕） */
  readonly trail: DispatchWideningTrail | undefined
}

// ---------------------------------------------------------------------------
// 二、启动面：每次派发前的 fail-closed 校验（校验失败＝不启动）
// ---------------------------------------------------------------------------

/**
 * 解析本 attempt 的派发圈定计划（**派发前唯一守门点**；不 spawn、不落盘、不读时钟）：
 *   1. 工位：绝对路径＋（存在时）非符号链接且为目录——WS-R3 派生路径被替换即拒派；
 *   2. 档位：`resolveSeatbeltGrant`（07-08 唯一守门点）——缺省 read-only、非法档/未授权
 *      放宽/相对根/read-only 带根一律构造期 CONFIG_INVALID，本件不吞不改；
 *   3. read-only：不得追加产出位（read-only 加根＝静默放宽，直接拒）；
 *   4. workspace-write：工位须在授权面内 → 本 attempt 写域（工位＋追加位）逐条绝对、
 *      realpath 归一、须落在授权面内（绝对路径/符号链接逃逸同判）→ 产出留痕；
 *   5. 放宽还须执行体有 seatbelt 端子（07-08 的 `agentconfig/seatbelt-unenforceable` 同向）：
 *      工厂构造即验，无端子家族不得在派发面盖「已放宽」章。
 * 抛出即拒派：调用方（launchWorkerDispatch）在任何 spawn 之前收到异常。
 */
export function resolveWorkerDispatchSeatbelt(request: WorkerDispatchRequest): WorkerDispatchSeatbelt {
  const plan = resolveSeatbeltGrant(request.grant) // 档位守门（07-08；缺省=read-only）
  const workspace = assertDispatchWorkspace(request.workspace)
  if (plan.tier === 'read-only') {
    const extras = request.extraWriteRoots ?? []
    if (extras.length > 0) {
      configInvalid(
        'dispatch/seatbelt-read-only-extra-roots',
        `read-only 档不得追加产出位（收到 ${String(extras.length)} 条）——放宽须显式声明 tier:'workspace-write' 并附授权留痕；不静默丢根，也不静默放宽（v2/15 §一 SEC-FC-05）`,
      )
    }
    return {
      ticket: request.ticket,
      executor: request.executor,
      tier: 'read-only',
      workspace,
      writeRoots: [],
      trail: undefined,
    }
  }
  assertWideningEnforceable(request.executor, request.grant)
  const scopeRoots = plan.writeRoots.map(realpathNearest)
  if (!scopeRoots.some((scope) => isInsideOrEqual(scope, workspace))) {
    configInvalid(
      'dispatch/seatbelt-workspace-outside-scope',
      `派发工位不在授权面内（工位 ${workspace}；授权面 ${scopeRoots.join('、')}）——授权与实际派发面不一致＝拒派（不拿授权面外路径当写域）`,
    )
  }
  const writeRoots: string[] = []
  for (const root of [request.workspace, ...(request.extraWriteRoots ?? [])]) {
    const rootReal = assertScopedWriteRoot(root, scopeRoots)
    if (!writeRoots.includes(rootReal)) writeRoots.push(rootReal)
  }
  const authorization = plan.authorization
  if (authorization === undefined) {
    // 不可达（resolveSeatbeltGrant 已保证 workspace-write ⇒ authorization 非空）；守门不靠约定
    configInvalid(
      'dispatch/seatbelt-trail-missing',
      'workspace-write 档缺少 authorization 留痕——没有留痕的放宽在派发面不得成立（v2/15 §一）',
    )
  }
  return {
    ticket: request.ticket,
    executor: request.executor,
    tier: plan.tier,
    workspace,
    writeRoots,
    trail: {
      ticket: request.ticket,
      executor: request.executor,
      tier: 'workspace-write',
      authorization,
      scopeRoots,
      writeRoots,
      workspace,
    },
  }
}

/** 派发闸依赖（spawn＝真起子进程面；recordWidening＝留痕落账，派发域注入） */
export interface WorkerDispatchGate<T> {
  /** 真 spawn（适配器 launch/resumeWithSession）；**只在留痕之后**被调用 */
  readonly spawn: (seatbelt: WorkerDispatchSeatbelt) => Promise<T>
  /** 放宽留痕落账（台账/事件 note）；workspace-write 档缺此 sink＝拒派（不静默无痕放宽） */
  readonly recordWidening?: ((trail: DispatchWideningTrail, note: string) => void) | undefined
}

/** 派发闸产物（seatbelt＝本次生效计划；result＝spawn 结果） */
export interface WorkerDispatchOutcome<T> {
  readonly seatbelt: WorkerDispatchSeatbelt
  readonly result: T
}

/**
 * 派发启动闸（SEC-FC-05「派发校验失败不启动」的机制面）：
 *   校验（失败即抛，spawn 零调用）→ 放宽留痕（缺 sink 或落账抛错同样不 spawn，且先于
 *   spawn——「先留痕后放宽」，账上不存在无痕的放宽）→ spawn。
 * 顺序不可交换：留痕失败仍启动＝不可审计的放宽；校验后置＝已启动才知非法。
 */
export async function launchWorkerDispatch<T>(
  request: WorkerDispatchRequest,
  gate: WorkerDispatchGate<T>,
): Promise<WorkerDispatchOutcome<T>> {
  const seatbelt = resolveWorkerDispatchSeatbelt(request)
  if (seatbelt.trail !== undefined) {
    const recordWidening = gate.recordWidening
    if (recordWidening === undefined) {
      configInvalid(
        'dispatch/seatbelt-trail-unrecorded',
        `executor ${request.executor} 以 workspace-write 派生单 ${request.ticket}：放宽未接留痕 sink（recordWidening）——无留痕的放宽不得启动（v2/15 §一「放宽须显式授权并留痕」）`,
      )
    }
    recordWidening(seatbelt.trail, wideningTrailNote(seatbelt.trail))
  }
  const result = await gate.spawn(seatbelt)
  return { seatbelt, result }
}

// ---------------------------------------------------------------------------
// 三、注册面：07-08 新签名的派发域调用点（省略＝read-only 最严）
// ---------------------------------------------------------------------------

/**
 * 派发域 resolver 组合（daemon 装配的**唯一调用点**；07-08 两参签名随动）：
 *   `dispatchAdapterResolver(grant?, base?)` = `judgeAwareResolver(tierAwareResolver(base,
 *   grant), grant)`——四家名/档位位/判断位三层同源同一个派工圈定授权，**省略＝read-only**。
 *
 * 为什么先 resolve 一次：非法档/未授权放宽在**装配期**即 CONFIG_INVALID（不等到 launch
 * 才败，也不留「装配成功但圈定是假的」中间态）；下游两次解析同参同计划（纯函数）。
 * base 注入面保留给测试/自定义家：base 自己的圈定授权归 base（本函数不替它决定）。
 */
export function dispatchAdapterResolver(grant?: SeatbeltGrant, base?: AdapterResolver): AdapterResolver {
  resolveSeatbeltGrant(grant) // 装配期守门（非法档/未授权放宽立即拒）
  return judgeAwareResolver(tierAwareResolver(base, grant), grant)
}

/** 档位面完整性（本件只认两档；「关掉即裸」不是第三路——值集归 07-08） */
export const DISPATCH_SEATBELT_TIERS: readonly SeatbeltTier[] = ['read-only', 'workspace-write']

// ---------------------------------------------------------------------------
// 四、留痕文本（台账 note 行；单行可判读，防 note 锚点注入）
// ---------------------------------------------------------------------------

/**
 * 派发留痕 note（台账/事件 note 行，两档都产）：
 *   - read-only：`seatbelt=read-only;roots=0;workspace=<…>`
 *   - workspace-write：`seatbelt=workspace-write;auth=<…>;roots=<…>;scope=<…>;workspace=<…>`
 * 单行化＋`;` 归一（authorization 是操作者自由文本——不得把台账 note 的锚点面
 * `;wait=…`/`;prio=…` 注入进来；engine 侧 DISPATCH note 按 `;key=value` 解析）。
 */
export function seatbeltNote(seatbelt: WorkerDispatchSeatbelt): string {
  if (seatbelt.trail === undefined) {
    return `seatbelt=read-only;roots=0;workspace=${noteText(seatbelt.workspace)}`
  }
  return wideningTrailNote(seatbelt.trail)
}

/** 放宽留痕 note 行（与 seatbeltNote 的 workspace-write 形同源） */
export function wideningTrailNote(trail: DispatchWideningTrail): string {
  return [
    'seatbelt=workspace-write',
    `auth=${noteText(trail.authorization)}`,
    `roots=${trail.writeRoots.map(noteText).join(',')}`,
    `scope=${trail.scopeRoots.map(noteText).join(',')}`,
    `workspace=${noteText(trail.workspace)}`,
  ].join(';')
}

/** note 文本归一：分号/换行/连续空白一律压平（单行、不破 `;key=value` 锚点面） */
function noteText(text: string): string {
  return text.replaceAll(/[;\r\n]+/g, ',').replaceAll(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// 五、内部工具（只读查询＋纯函数；不读环境、不写盘）
// ---------------------------------------------------------------------------

/** 工位校验：绝对路径＋（存在时）非符号链接且为目录；返回 realpath 归一的工位 */
function assertDispatchWorkspace(workspace: string): string {
  if (workspace === '' || !isAbsolute(workspace)) {
    configInvalid(
      'dispatch/seatbelt-workspace-absolute',
      `派发工位须为绝对路径（收到 ${JSON.stringify(workspace)}）——WS-R3 纯函数派生的工位路径被替换即拒派（v2/12 §3.1）`,
    )
  }
  const existing = lstatOrUndefined(workspace)
  if (existing !== undefined) {
    if (existing.isSymbolicLink()) {
      configInvalid(
        'dispatch/seatbelt-workspace-symlink',
        `派发工位是符号链接（${workspace}）——工位路径由 WS-R3 派生，链接化即写域可被重定向到授权面外，拒派（NEG-RUN-04）`,
      )
    }
    if (!existing.isDirectory()) {
      configInvalid(
        'dispatch/seatbelt-workspace-not-dir',
        `派发工位不是目录（${workspace}）——工位=该次尝试的目录（WS-R5），不是文件，拒派`,
      )
    }
  }
  return realpathNearest(workspace)
}

/**
 * 单条写域根的逃逸校验（绝对路径逃逸/符号链接逃逸同判）：
 *   - 相对路径＝拒（内核面按 cwd 解析＝隐式放宽）；
 *   - realpath 归一后须落在**授权面**内；越出即「逃逸」——不静默降级为「仅工位」
 *     （那等于替调用方剪根，账上就看不见被丢掉的根）。
 */
function assertScopedWriteRoot(root: string, scopeRoots: readonly string[]): string {
  if (root === '' || !isAbsolute(root)) {
    configInvalid(
      'dispatch/seatbelt-write-root-absolute',
      `派发写域根须为绝对路径（收到 ${JSON.stringify(root)}）——相对根在内核面按 cwd 解析，等于隐式放宽`,
    )
  }
  const rootReal = realpathNearest(root)
  if (!scopeRoots.some((scope) => isInsideOrEqual(scope, rootReal))) {
    configInvalid(
      'dispatch/seatbelt-write-root-escape',
      `写域根越出授权面（${root} → ${rootReal}；授权面 ${scopeRoots.join('、') || '（空）'}）——绝对路径/符号链接逃逸一律拒派，不静默剪根（NEG-RUN-04；v2/15 §一 SEC-FC-05）`,
    )
  }
  return rootReal
}

/** 放宽须可执行：执行体必须能构造出带圈定端子的适配器（07-08 同向，无端子＝拒） */
function assertWideningEnforceable(executor: string, grant: SeatbeltGrant | undefined): void {
  const factory = dispatchAdapterResolver(grant)(executor)
  if (factory === undefined) {
    configInvalid(
      'dispatch/seatbelt-unknown-executor',
      `执行体 ${JSON.stringify(executor)} 不在注册面（resolver 未知）——放宽无处落地，拒派（不猜家）`,
    )
  }
  try {
    factory(undefined) // 工厂构造＝端子检查（claude/codex/kimi 无 seatbelt 端子即 CONFIG_INVALID）
  } catch (err) {
    configInvalid(
      'dispatch/seatbelt-unenforceable',
      `执行体 ${executor} 无法执行 workspace-write 放宽：${err instanceof Error ? err.message : String(err)}——无 seatbelt 端子不得在派发面盖「已放宽」章（G-PORT-WS 接线腿）`,
    )
  }
}

/** 全路径 realpath（不存在的尾段按词法拼接；存在的祖先逐段归一） */
function realpathNearest(target: string): string {
  const abs = resolve(target)
  let head = abs
  const tail: string[] = []
  for (;;) {
    try {
      const real = realpathSync(head)
      return tail.length === 0 ? real : join(real, ...tail.slice().reverse())
    } catch {
      const parent = dirname(head)
      if (parent === head) return abs // 根不可解（异常面）：按词法绝对路径返回
      tail.push(basename(head))
      head = parent
    }
  }
}

/** parent 为 child 的祖先或同一路径（path.relative 判据；异根/盘符自然为外） */
function isInsideOrEqual(parent: string, child: string): boolean {
  if (parent === child) return true
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** lstat 容错：不存在/不可读＝undefined（按「不存在」分支走，不吞其它校验面） */
function lstatOrUndefined(target: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(target)
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// 六、profile 面（本 attempt 写域 → SBPL 文本；纯函数，测试与派发回执同源）
// ---------------------------------------------------------------------------

/**
 * 本 attempt 的 seatbelt profile 文本（SBPL）：写域取派发计划的有效根（read-only＝零条）。
 * 只做机械渲染（生成器=07-08 的 buildWorkerSeatbeltProfile）；档位语义不在渲染器里。
 */
export function dispatchSeatbeltProfile(seatbelt: WorkerDispatchSeatbelt, label?: string): string {
  return buildWorkerSeatbeltProfile({
    writeRoots: seatbelt.writeRoots,
    ...(label !== undefined ? { label } : {}),
  })
}
