/**
 * company-commit · 公共类型（MIG-05 / IMPL-05-06「挂单 commit·公司目录运行期唯一写者」，LANE-E）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - plan/05 IMPL-05-06（组织变更单＝一个 commit；旁路写被拒；`git log` 逐单可查）
 *   - docs/v2/05 §三 DOM-01（公司 git 目录＝组织/人事/岗位/章程文本唯一权威；
 *     **唯一写入者＝daemon（挂单 commit）**；变更历史靠 DOM-03 事件）
 *   - docs/v2/06 §五.1（配置声明的是**拟任**不是任命：直接改文件不产生任命/离职/结清；
 *     本模块只落「已决定变更的目录形态」，不自行决定、不伪造生效）
 *   - docs/v2/11 §〇.4（记录身份不复用；**同一对象同一版本只允许一次成功迁移，重复提交
 *     返回既有结果、不产生第二次副作用**——本模块重放幂等的规范源）、§3.2 组织侧
 *     REC-LIFE-07..11 与 §2.2 REC-AUTH-01（组织面记录族；commit message 引其记录引用）
 *   - docs/v2/14 §二（PORT-REG `reg.ts` 备注「DOM-01 挂单 commit 由 daemon」）——本模块即
 *     该备注的实现面：**写路径在 daemon 内，但「已提交」不等于「已生效」**
 *   - docs/v2/16 §三 company 行（org-config 只读兼容至 MIG-08；纯投影消费）
 *
 * 边界（不新增记录类/端口——plan/05 约束）：
 *   本文件只有**编排入参/证据/审计**三类结构，不是 contract ports/records 的公共形状，
 *   也不进 `packages/contract`。组织面记录的**本体**在 v2/11（REC- 族），本模块只引用其
 *   「记录类型#记录 id」字符串；订单不是记录、不是授权、不是端口。
 *
 * 只写可擦除语法（strict + erasableSyntaxOnly）；相对 import 带 `.ts`。
 */

// ───────────────────────── 组织变更单（订单） ─────────────────────────

/** 文件 upsert 操作：以整文件内容替换（不做行级合并——行级 diff 归变更链记录，不在此） */
export interface FileUpsertOp {
  readonly kind: 'upsert-file'
  /** 公司目录内相对路径（posix；只许组织面可写前缀，见 order.ts 的单点白名单） */
  readonly path: string
  /** 提交后的完整文件内容（UTF-8；git 面逐字节提交） */
  readonly content: string
}

/** 文件删除操作（部门撤销/档案移出等，语义仍由订单所引组织记录决定） */
export interface FileDeleteOp {
  readonly kind: 'delete-file'
  readonly path: string
}

export type OrgChangeOp = FileUpsertOp | FileDeleteOp

/**
 * 组织变更单：一次组织变更＝**一个 commit**（plan/05 IMPL-05-06 冻结口径）。
 * 订单只描述「已决定变更要落成的目录形态」；决定者/依据/范围由所引组织记录承载
 * （v2/11 REC-LIFE-07..11 / REC-AUTH-01），本模块不重述、不判定授权（判定面另单）。
 */
export interface OrgChangeOrder {
  /** 组织变更单号（幂等键的一半：同单重放不得产生第二个 commit） */
  readonly orderId: string
  /** 单行摘要（进 commit message 首行，可人读） */
  readonly summary: string
  /** 决定位置（具名；禁「daemon/系统/框架」冒充当决定者——v2/11 §〇.2-1） */
  readonly decidedBy: string
  /** 决定时间（ISO 8601；记录时间轴在记录本体，本字段只作 message 留痕） */
  readonly decidedAt: string
  /** 记录引用（`REC-LIFE-08#org-event-0001` 形态；≥1，家族限组织面六族） */
  readonly recordRefs: readonly string[]
  /** 目录操作（≥1；路径去重；只许公司目录组织面可写前缀） */
  readonly ops: readonly OrgChangeOp[]
}

// ───────────────────────── 提交证据 ─────────────────────────

/**
 * 挂单结果三态（互不可合并）：
 *   - committed＝本次产生了且仅产生了一个 commit；
 *   - replayed ＝同单号同内容已有挂单 commit，返回**既有结果**、零新副作用（v2/11 §〇.4-4）；
 *   - unchanged＝订单内容与当前工作树逐字节相同，无可提交变更（不造空 commit）。
 */
export type CommitStatus = 'committed' | 'replayed' | 'unchanged'

/** 挂单证据：调用方据此断言「一点：一个 commit、只写公司目录」 */
export interface CommitEvidence {
  readonly status: CommitStatus
  readonly orderId: string
  /** 挂单 commit 全长哈希；unchanged 时 null */
  readonly commit: string | null
  /** 实际使用的 commit message（含单号/记录引用；unchanged 时为将要使用的 message） */
  readonly message: string
  /** 订单内容摘要（`<hex>`；commit message 以 `sha256:` 前缀留痕） */
  readonly digest: string
  /** 本单实际改动的目录相对路径（排序；unchanged 时为空） */
  readonly paths: readonly string[]
  readonly recordRefs: readonly string[]
  /** 本单之前的 HEAD（首单可为既有基线 commit） */
  readonly previousHead: string | null
  /** 首单基线采纳的 HEAD；null＝本单之前已有挂单历史（基线确立过一次不再变） */
  readonly baseline: string | null
  /** 提交后回读校验（message 单号/摘要、改动路径集合）通过＝true */
  readonly verified: boolean
}

// ───────────────────────── 唯一写入者审计（旁路写检测） ─────────────────────────

export type BypassFindingKind = 'not-a-worktree' | 'no-baseline' | 'unattributed-commit' | 'dirty-worktree'

/** 旁路写发现（非 daemon 路径写公司目录的证据项） */
export interface BypassFinding {
  readonly kind: BypassFindingKind
  readonly detail: string
  readonly commit: string | null
  readonly path: string | null
}

/** daemon 自有挂单 commit（message 带订单 trailer 者） */
export interface OwnedCommit {
  readonly hash: string
  readonly orderId: string
  readonly digest: string | null
}

/** 唯一写入者审计报告（只读；apply 前的否决依据） */
export interface SoleWriterAudit {
  readonly companyDir: string
  readonly head: string | null
  /** 基线 commit（首次挂单 commit 的父；无挂单历史时＝当前 HEAD 的「待采纳」值） */
  readonly baseline: string | null
  readonly lastOwnedCommit: string | null
  readonly ownedCommits: number
  readonly scannedCommits: number
  readonly findings: readonly BypassFinding[]
  readonly soleWriter: boolean
}

// ───────────────────────── git 原语的中立形状 ─────────────────────────

/** 一条 commit（按 `git log` 新→旧顺序消费） */
export interface GitCommit {
  readonly hash: string
  readonly at: string
  readonly author: string
  readonly message: string
}

/** 一条 `git status --porcelain` 条目（只留状态字母与路径） */
export interface GitStatusEntry {
  readonly status: string
  readonly path: string
}

// ───────────────────────── 编排选项 ─────────────────────────

/** 挂单选项（可选审计回调：宿主落审计台账归 DOM-03，本模块不写其它事实源） */
export interface ApplyOptions {
  readonly onAudit?: (audit: SoleWriterAudit) => void
}
