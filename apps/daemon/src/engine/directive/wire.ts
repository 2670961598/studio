/**
 * wire —— 批示归一层接线体（studio-dev-171，130-§6.1.2 / docs/18-§2.5；
 * 202-P1 位别两扩：dispatcher 源+验收位打回→已派发+resume 物化，studio-dev-231）。
 *
 * 引擎相位 1 尾的采集归一步（采集相位内的归一面，非新相位）：受影响单拉评论→
 * 词表 v1 解析（parse.ts）→角色校验（qualify.ts，fail-closed）→批准站立（喂相位 2
 * approved 入参=D4 定稿清偿点）/打回声明边过渡/搁置待批留置/拆单 v1 不物化（P2 面）。
 * 幂等=directiveKeys（directive=<评论id>，append-only）；资格拒/畸形=忽略+ESCALATE
 * （伪造批示=事故，可观测）；批示是 comment 信号非状态通道（C3 铁律：daemon 仍是
 * 唯一状态推进者）。打回=机器按批示驱动声明边过渡（边未声明不发明边——fail-closed
 * 可观测，P1 类型流声明 edges 后此面自然生效）。
 *
 * 打回位别目标（202-§5.2）：呈批位（既有面字节不变）→新单声明边；验收位（流声明
 * 待验收→已派发 回退边——T:devtask 声明形）→①声明回退边命中过渡已派发 ②机器回退
 * 步 raw 过渡已派发→新单（重做回派发位——与停摆/消亡面回退同口径，平台是状态权威）
 * ③物化 resume 意图（cause=策划验收打回+理由注入前情面）——同拍 F1-15 消费门接手：
 * 断点解析→续跑计划→decide 5c 四闸→resume 派发（attempt 续号、causation 链上次
 * 工时单、前情摘要含打回理由）。
 */
import type { FlowPlatform, IssueRecord, TicketId } from '@studio-next/contract'
import { canTransition, flowAnchors, type StateFlow } from '@studio-next/core'
import { noteSafe } from '../intents/taxonomy.ts'
import { parseDirectiveComment, type DirectiveVerb } from './parse.ts'
import type { DirectiveAuthorizer, DirectiveIssueFacts } from './qualify.ts'

/** 引擎注入面：IO 钩子（评论拉取/事件落账/镜像同步）与只读索引，归一层零自持状态 */
export interface DirectiveLayerDeps {
  platform: FlowPlatform
  gate: DirectiveAuthorizer
  affected: readonly TicketId[]
  issueById: ReadonlyMap<TicketId, IssueRecord>
  /** 已消费批示键集（directive=<评论id>——append-only 防重放；引擎事件索引注入） */
  consumedKeys: ReadonlySet<string>
  attemptOf(ticket: TicketId): number
  flowOf(issue: IssueRecord): StateFlow | undefined
  /** 本单 dispatcher 工号（202-P1：白名单第四源——镜像列 F2-07；引擎注入 ledger 读） */
  dispatcherOf?(ticket: TicketId): string | undefined
  /**
   * 验收位打回的 resume 意图物化口（202-P1：引擎闭包构造 InvokeIntent{kind:'resume'}
   * 并入队——本拍相位 2 前置消费门（drain）同拍接手；缺省不注入=验收位打回面降级
   * 为纯回退不物化，fail-closed）。
   */
  materializeResumeIntent?(ticket: TicketId, cause: string, note: string): void
  /**
   * 泳道租约释放（202-P1：验收位打回重做链——旧派发租约随回退作废；GATE_FAIL 回退
   * 同口径 lanes.release→回新单。不释放则本拍 decide 5c HOLD_LANE_BUSY，重做断链）。
   */
  releaseLane?(ticket: TicketId): void
  /** 落事件（APPROVE=批示生效面；ESCALATE=拒/畸形/边未声明可观测面） */
  emit(event: 'APPROVE' | 'ESCALATE', issue: IssueRecord, attempt: number, note: string): void
  /** 平台过渡成功后的镜像同步（打回过渡面） */
  afterTransition(issue: IssueRecord): void
  onError(message: string): void
}

export interface DirectiveLayerResult {
  /** TickReport.phases.collect.directives 汇报面（同形直录） */
  report: { tickets: number; consumed: number; rejected: number }
  /** 本拍站立动词（ticket→verb；喂相位 2 approved/5a 回弹抑制） */
  verbsNow: ReadonlyMap<TicketId, DirectiveVerb>
  /** 平台过渡计数（打回声明边命中面） */
  mutations: number
}

/**
 * 引擎闭包件 → 归一层 deps 组装（202-P1，studio-dev-231；engine.ts 尺寸基线收口——
 * deps 平铺样板下沉本件）：dispatcherOf=镜像列 F2-07 读；materializeResumeIntent=
 * InvokeIntent{kind:'resume'} 入队（相位 2 前置 drain 同拍接手）；afterTransition=
 * 镜像同步+issueById 回填双钩（打回位别链 已派发→新单 后本拍 decide 须见新单——
 * issueById 建于相位 1 头，不回填则 decide 读到陈旧态、resume 计划同拍失效）。
 */
export interface EngineDirectiveClosures {
  platform: FlowPlatform
  gate: DirectiveAuthorizer
  affected: readonly TicketId[]
  issueById: Map<TicketId, IssueRecord>
  directiveKeys: ReadonlySet<string>
  attemptOf(ticket: TicketId): number
  flowOf(issue: IssueRecord): StateFlow | undefined
  dispatcherOf(ticket: TicketId): string | undefined
  materializeResumeIntent(ticket: TicketId, cause: string, note: string): void
  releaseLane(ticket: TicketId): void
  syncMirror(issue: IssueRecord): void
  emit(event: 'APPROVE' | 'ESCALATE', issue: IssueRecord, attempt: number, note: string): void
  onError(message: string): void
}

export function engineDirectiveDeps(c: EngineDirectiveClosures): DirectiveLayerDeps {
  return {
    platform: c.platform,
    gate: c.gate,
    affected: c.affected,
    issueById: c.issueById,
    consumedKeys: c.directiveKeys,
    attemptOf: c.attemptOf,
    flowOf: c.flowOf,
    dispatcherOf: c.dispatcherOf,
    materializeResumeIntent: c.materializeResumeIntent,
    releaseLane: c.releaseLane,
    afterTransition: (issue) => {
      c.syncMirror(issue)
      c.issueById.set(issue.id, issue)
    },
    emit: c.emit,
    onError: c.onError,
  }
}

/**
 * 归一步主体（引擎相位 1 尾调用；gate 缺省不注入=面关——engine 侧不调用本件）。
 * 每评论恰处理一次：已消费键跳过，自由言论不消费不落事件。
 */
export async function runDirectiveLayer(deps: DirectiveLayerDeps): Promise<DirectiveLayerResult> {
  const report = { tickets: 0, consumed: 0, rejected: 0 }
  const verbsNow = new Map<TicketId, DirectiveVerb>()
  let mutations = 0
  const { platform, gate, affected, issueById, consumedKeys, attemptOf, flowOf, emit, afterTransition } = deps
  for (const ticket of affected) {
    const issue = issueById.get(ticket)
    if (issue === undefined) continue
    let comments
    try {
      comments = await platform.comments.list(ticket)
    } catch (err) {
      deps.onError(`批示归一层拉取评论失败 ${ticket}：${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    report.tickets += 1
    const attempt = attemptOf(ticket)
    const issueFlow = flowOf(issue)
    const dispatcher = deps.dispatcherOf === undefined ? undefined : deps.dispatcherOf(ticket)
    const slot = issueFlow === undefined ? undefined : approvalSlotOf(issueFlow, issue.state)
    const facts: DirectiveIssueFacts = {
      ...(issue.dept !== undefined ? { dept: issue.dept } : {}),
      ...(issue.level !== undefined ? { level: issue.level } : {}),
      ...(issue.assignee !== undefined ? { assignee: issue.assignee } : {}),
      ...(dispatcher !== undefined ? { dispatcher } : {}),
      ...(slot !== undefined ? { approvalSlot: slot } : {}),
    }
    for (const c of comments) {
      if (consumedKeys.has(c.id)) continue // 已消费（含拒/畸形）——append-only 防重放
      const parsed = parseDirectiveComment(c.body)
      if (parsed.kind === 'none') continue // 自由言论：不消费不落事件
      if (parsed.kind === 'malformed') {
        report.consumed += 1
        report.rejected += 1
        emit('ESCALATE', issue, attempt, `DIRECTIVE_MALFORMED;why=${parsed.why};actor=${noteSafe(c.author)};directive=${c.id}`)
        continue
      }
      const q = gate.qualify(c.author, facts, parsed.verb)
      if (!q.ok) {
        // 伪造防御（判负线：伪造批示不得推进状态）——忽略+ESCALATE，状态不动
        report.consumed += 1
        report.rejected += 1
        emit(
          'ESCALATE',
          issue,
          attempt,
          `DIRECTIVE_REJECTED;why=${q.why};verb=${parsed.verb};actor=${noteSafe(c.author)};directive=${c.id}`,
        )
        continue
      }
      report.consumed += 1
      verbsNow.set(ticket, parsed.verb)
      if (parsed.verb === '打回') {
        const flow = issueFlow
        const anchors = flow === undefined ? undefined : flowAnchors(flow)
        const fresh = anchors === undefined ? undefined : anchors.fresh
        const dispatchedTarget = anchors === undefined ? undefined : anchors.dispatched
        if (
          flow !== undefined &&
          dispatchedTarget !== undefined &&
          dispatchedTarget !== issue.state &&
          slot === 'post-verified' &&
          canTransition(flow, issue.state, dispatchedTarget)
        ) {
          // 验收位打回（202-§5.2）：①声明回退边命中过渡已派发（边未声明不发明边——
          // 上面 canTransition 闸）＋旧派发租约释放（GATE_FAIL 回退同口径）②机器回退
          // 步 raw 过渡已派发→新单（重做回派发位——停摆/消亡面回退同口径，平台是状态
          // 权威；无此步则单卡已派发无在工，decide 5d 结构性等证据、resume 计划同拍
          // 失效，重做链断在派发位）③resume 意图物化（cause=策划验收打回，理由注入
          // 前情面）——同拍 F1-15 消费门：断点解析→续跑计划→decide 5c 四闸→resume
          // 派发（attempt 续号/causation 链/前情摘要）。理由落事件 note（判负线：
          // 理由丢失=判负）。
          try {
            const rolled = await platform.issues.transition(ticket, dispatchedTarget)
            afterTransition(rolled)
            mutations += 1
            deps.releaseLane?.(ticket)
            let staged: IssueRecord = rolled
            let stagingNote = ''
            if (fresh !== undefined && fresh !== rolled.state) {
              try {
                staged = await platform.issues.transition(ticket, fresh)
                afterTransition(staged)
                mutations += 1
                stagingNote = `→${fresh}（重做回派发位）`
              } catch (err) {
                // 不回滚①（平台已收过渡）——onError 明报，单留已派发走停摆回退兜底
                deps.onError(`批示:打回重做回派发位失败 ${ticket}：${err instanceof Error ? err.message : String(err)}`)
                stagingNote = `（重做回派发位失败——留${rolled.state}，停摆回退兜底）`
              }
            }
            const cause = '策划验收打回'
            const reasonNote = parsed.text === '' ? cause : `${cause}：${parsed.text}`
            if (deps.materializeResumeIntent !== undefined) {
              deps.materializeResumeIntent(ticket, cause, reasonNote)
            }
            emit(
              'APPROVE',
              staged,
              attempt,
              `DIRECTIVE;verb=打回;actor=${noteSafe(c.author)};directive=${c.id};reason=${noteSafe(parsed.text)}` +
                `;target=${dispatchedTarget}（声明回退边）${stagingNote};resume=意图已物化（cause=${cause}）`,
            )
          } catch (err) {
            deps.onError(`批示:打回迁移失败 ${ticket}：${err instanceof Error ? err.message : String(err)}`)
            emit(
              'ESCALATE',
              issue,
              attempt,
              `DIRECTIVE_EDGE_UNDECLARED;verb=打回;actor=${noteSafe(c.author)};directive=${c.id};reason=${noteSafe(parsed.text)}`,
            )
          }
        } else if (flow !== undefined && fresh !== undefined && fresh !== issue.state && canTransition(flow, issue.state, fresh)) {
          // 呈批位声明边命中（既有面，字节不变）：机器按批示驱动过渡（声明边语义——
          // 边未声明不发明边）；理由落事件 note（判负线：理由丢失=判负）
          try {
            const rolled = await platform.issues.transition(ticket, fresh)
            afterTransition(rolled)
            mutations += 1
            emit(
              'APPROVE',
              rolled,
              attempt,
              `DIRECTIVE;verb=打回;actor=${noteSafe(c.author)};directive=${c.id};reason=${noteSafe(parsed.text)}`,
            )
          } catch (err) {
            deps.onError(`批示:打回迁移失败 ${ticket}：${err instanceof Error ? err.message : String(err)}`)
            emit(
              'ESCALATE',
              issue,
              attempt,
              `DIRECTIVE_EDGE_UNDECLARED;verb=打回;actor=${noteSafe(c.author)};directive=${c.id};reason=${noteSafe(parsed.text)}`,
            )
          }
        } else {
          // 边未声明/无流/已居首态：状态不动＋可观测，理由不丢（fail-closed——
          // 打回站立但不发明边；验收位流未声明回退边同落此面）
          report.rejected += 1
          emit(
            'ESCALATE',
            issue,
            attempt,
            `DIRECTIVE_EDGE_UNDECLARED;verb=打回;actor=${noteSafe(c.author)};directive=${c.id};reason=${noteSafe(parsed.text)}`,
          )
        }
      } else {
        // 批准（站立喂相位 2 approved 入参）/搁置（待批留置即语义）/拆单（v1 解析
        // 合格不物化——物化归 130-P2）；尾注容留不丢
        emit(
          'APPROVE',
          issue,
          attempt,
          `DIRECTIVE;verb=${parsed.verb};actor=${noteSafe(c.author)};directive=${c.id}` +
            (parsed.text === '' ? '' : `;note=${noteSafe(parsed.text)}`),
        )
      }
    }
  }
  return { report, verbsNow, mutations }
}

/**
 * 5a 回弹抑制判定（docs/18-§2.5「close the loop including the no」）：打回/拆单/
 * 搁置站立期不自动呈批——部长已说 no，机器不把未修订件弹回批位；改判批示（站立
 * 翻转）或平台侧人工拖单（§2.3 制作人任意介入）后自然恢复。观测面由引擎落
 * WAIT_APPROVAL（理由码冻结清单既有名——决策码零增删）。
 */
export function reboundSuppressed(verbNow: DirectiveVerb | null | undefined, actionType: string): boolean {
  return (
    actionType === 'submit_approval' && (verbNow === '打回' || verbNow === '拆单' || verbNow === '搁置')
  )
}

/**
 * 批示位别判定（202-P1，R3/§5.2）：当前态居流主干何位——复验锚之后的批示位
 * =验收位（post-verified，工序已在派发/复验之后，批示对象是已完工复验件）；
 * 此前=呈批位（pre-dispatch，派单前的部门审批）。
 *
 * 保守判据（repeated-name 面）：仅当当前态名在主干**唯一出现**且其位次在复验锚
 * 之后才判 post-verified——L2 一类「待批」双现名流不判（位别未知→呈批位既有行为
 * +严格派单律，字节不变）；T:devtask「待验收」与首锚「新单」异名避开消歧（202-§5.1
 * W-9 同款考量）。无 approval 锚/无流=undefined（既有面）。
 */
export function approvalSlotOf(flow: StateFlow, state: string): 'pre-dispatch' | 'post-verified' | undefined {
  const anchors = flowAnchors(flow)
  if (anchors.approval === '' || state !== anchors.approval) return undefined
  const mainline = flow.mainline
  const occurrences = mainline.filter((s) => s === state).length
  if (occurrences !== 1) return undefined // 双现名流不判——保守留呈批位既有面
  const at = mainline.indexOf(state)
  if (at === -1) return undefined
  const verifiedAt = mainline.lastIndexOf(anchors.verified)
  if (verifiedAt === -1 || at <= verifiedAt) return 'pre-dispatch'
  return 'post-verified'
}
