/**
 * qualify —— 批示角色校验（fail-closed）（studio-dev-171，130-§6.1.2 / docs/18-§2.5）。
 *
 * 白名单={ticket.dept 的 leader}∪{组织锚白名单}∪{制作人}；未知 actor=拒（宁拒不错派）；
 * 伪造/越级=忽略＋ESCALATE（伪造批示=事故）；派单律（仅动词「批准」；制作人豁免）：
 * 批示人 level 严格高于被派单人 level——被派单按 assignee→defaultAssignee 链解析，
 * 不可解析=拒。纯函数核，IO 归 wire.ts 接线体。
 */
import type { DirectiveVerb } from './parse.ts'

/** 引擎侧消费的最小人员面（PersonRef 结构子集——纯函数不引契约形状） */
export interface DirectivePerson {
  /** 工号（人员索引主键；leader 表/白名单的匹配位） */
  id: string
  /** 平台账号（评论 author 的锚——LocalFile 例外直接给工号，两形态都认） */
  login: string
  level: number
}

/** 资格校验的单据事实面（IssueRecord 结构子集） */
export interface DirectiveIssueFacts {
  dept?: string
  level?: number
  assignee?: string
}

/** 归一层依赖注入面（engine.ts EngineDeps.directives 同形；缺省不注入=面关） */
export interface DirectiveGateDeps {
  /** 部门表：dept path → leader 工号（白名单第一源；serve 从快照装配，热重载整组换） */
  departments: ReadonlyMap<string, string>
  /** 组织锚白名单工号/账号（如 PRIME-0——demo 公司组织锚；daemon.yaml 可选键） */
  extraWhitelist?: readonly string[]
  /** 制作人账号/工号（豁免派单律——docs/18-§2.3 任意介入不受限） */
  producer?: string
}

export type DirectiveQualify =
  | { ok: true; person: DirectivePerson; exempt: boolean }
  | { ok: false; why: 'unknown-actor' | 'not-whitelisted' | 'dispatch-law'; person?: DirectivePerson }

export interface DirectiveAuthorizer {
  /** 评论 author（平台账号或工号）→人员索引；不可解析=undefined */
  resolveActor(actor: string): DirectivePerson | undefined
  /**
   * 资格校验（序即优先级）：未知 actor → 白名单 → 派单律（仅「批准」，制作人豁免）。
   * 被派单人=assignee→defaultAssignee 解析（与引擎 resolvePerson 同源链），不可解析=拒。
   */
  qualify(actor: string, issue: DirectiveIssueFacts, verb: DirectiveVerb): DirectiveQualify
}

/**
 * 构造资格校验器。peopleRef 取引用闭包（人员索引 L1 热替换后校验面即随换——
 * 与 engine people let 化同生命周期，防陈旧名册放行）。
 */
export function buildDirectiveAuthorizer(
  deps: DirectiveGateDeps,
  peopleRef: () => readonly DirectivePerson[],
  defaultAssignee?: string,
): DirectiveAuthorizer {
  const resolveActor = (actor: string): DirectivePerson | undefined =>
    peopleRef().find((p) => p.login === actor || p.id === actor)
  const whitelistHit = (actor: string, person: DirectivePerson, dept: string | undefined): boolean => {
    const leader = dept === undefined ? undefined : deps.departments.get(dept)
    if (leader !== undefined && leader === person.id) return true
    return deps.extraWhitelist?.some((w) => w === person.id || w === actor) === true
  }
  return {
    resolveActor,
    qualify(actor, issue, verb) {
      const person = resolveActor(actor)
      if (person === undefined) return { ok: false, why: 'unknown-actor' }
      // 制作人豁免（docs/18-§2.3：任意介入不受限——含派单律）
      if (deps.producer !== undefined && (actor === deps.producer || person.id === deps.producer)) {
        return { ok: true, person, exempt: true }
      }
      if (!whitelistHit(actor, person, issue.dept)) return { ok: false, why: 'not-whitelisted', person }
      if (verb === '批准') {
        const target =
          resolveActor(issue.assignee ?? '') ??
          (defaultAssignee === undefined ? undefined : resolveActor(defaultAssignee))
        if (target === undefined) return { ok: false, why: 'dispatch-law', person }
        if (person.level <= target.level) return { ok: false, why: 'dispatch-law', person }
      }
      return { ok: true, person, exempt: false }
    },
  }
}
