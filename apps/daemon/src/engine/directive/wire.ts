/**
 * wire —— 批示归一层接线体（studio-dev-171，130-§6.1.2 / docs/18-§2.5）。
 *
 * 引擎相位 1 尾的采集归一步（采集相位内的归一面，非新相位）：受影响单拉评论→
 * 词表 v1 解析（parse.ts）→角色校验（qualify.ts，fail-closed）→批准站立（喂相位 2
 * approved 入参=D4 定稿清偿点）/打回声明边过渡/搁置待批留置/拆单 v1 不物化（P2 面）。
 * 幂等=directiveKeys（directive=<评论id>，append-only）；资格拒/畸形=忽略+ESCALATE
 * （伪造批示=事故，可观测）；批示是 comment 信号非状态通道（C3 铁律：daemon 仍是
 * 唯一状态推进者）。打回=机器按批示驱动声明边过渡（边未声明不发明边——fail-closed
 * 可观测，P1 类型流声明 edges 后此面自然生效）。
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
    const facts: DirectiveIssueFacts = {
      ...(issue.dept !== undefined ? { dept: issue.dept } : {}),
      ...(issue.level !== undefined ? { level: issue.level } : {}),
      ...(issue.assignee !== undefined ? { assignee: issue.assignee } : {}),
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
        const flow = flowOf(issue)
        const fresh = flow === undefined ? undefined : flowAnchors(flow).fresh
        if (flow !== undefined && fresh !== undefined && fresh !== issue.state && canTransition(flow, issue.state, fresh)) {
          // 声明边命中：机器按批示驱动过渡（声明边语义——边未声明不发明边）；
          // 理由落事件 note（判负线：理由丢失=判负）
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
          // 打回站立但不发明边；P1 类型流声明 edges 后此面自然生效）
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
