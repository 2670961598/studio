/**
 * candidates —— v5 进化管线候选读写面（自 ledger.ts 原样拆出，零行为变更）
 *
 * 表 DDL 归 migrations v5（17-§3 / core evolution 首刀 / 02-F3）：形状闸 CandidateRowSchema /
 * 谱系闸（父在库、挂接不成环、自引用）/ 同 (asset_path,diff_hash) 非终态幂等 / 乐观锁迁移。
 * verification 列序列化在本模块单一口径源（insertCandidate 与 updateVerification 共用）；
 * 状态机边合法性归 core，本面不复制判定（避免第二状态机）。
 * db 由 openLedger 唯一持有并注入，本模块不建连接、不留状态。
 */
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid } from '@studio-next/contract'
import {
  CANDIDATE_STATUS_VALUES,
  CandidateRowSchema,
  TERMINAL_CANDIDATE_STATUS_VALUES,
  type CandidateRow,
  type CandidateStatus,
} from '../records.ts'
import { assertRecord, optStr, str, type SqlRow } from '../row-helpers.ts'
import { canonicalJson, errorMessage, parseJsonValue } from './shared.ts'

/**
 * insertCandidate 结果：inserted=false 即幂等命中（同 (asset_path,diff_hash) 非终态既有候选
 * ——输入 id 被忽略，返回既有 id；或同 id 全列一致的重复登记），不新建行。
 */
export interface InsertCandidateResult {
  id: string
  inserted: boolean
}

/** 候选读写面（Ledger extends 本面——方法名恒平，ledger.ts 摊入） */
export interface CandidatesFace {
  // —— v5 进化管线 candidates 读写面（17-§3 / core evolution 首刀；daemon 接线归后续刀） ——
  /**
   * 候选登记（幂等，core proposeCandidate 语义的持久层镜像）：同 (asset_path, diff_hash)
   * 且非终态命中 → 返回既有 id 不新建（inserted=false）；终态命中放行新建=换代重提。
   * 形状闸（CandidateRowSchema）/ 谱系闸（父在库 evolve/parent-unknown 同义、挂接不成环
   * lineage-cycle 同义、自引用 self-parent 同义）/ 同 id 全列一致跳过·不一致拒。
   */
  insertCandidate(record: unknown): InsertCandidateResult
  /** 按 id 取候选；无此行=undefined */
  getCandidate(id: string): CandidateRow | undefined
  /**
   * 全祖先链 [自身, 父, 祖父, …, 根]（新→旧，core lineage 同序）；初代=仅 [自身]；
   * 无此行=undefined。fail-closed：断链 → lineage-broken（台账丢数据不静默截断——core
   * 同语义）；链成环 → lineage-cycle（seen 集防死循环）。选型=应用层循环，见实现注。
   */
  lineageOf(id: string): CandidateRow[] | undefined
  /**
   * 按状态集取候选（(created_at, id) 升序）——判负查 active 集的库侧消费面（授权态
   * approved|promoted）。枚举外值 / 空数组 → CONFIG_INVALID（fail-closed，空集=调用方 bug）。
   */
  candidatesByStatus(statuses: readonly CandidateStatus[]): CandidateRow[]
  /**
   * 状态迁移（乐观锁）：UPDATE … WHERE id=? AND status=<期望当前值 from>，0 行=false——
   * 两次并发同迁恰一次成功。**不校验边合法性**：状态机单一事实源在 core transitionCandidate
   * （机器边表 + 闸门/人裁边收口），daemon 先经 core 纯函数判定再落库；store 只保并发安全，
   * 不在库层复制判定面（复制=第二状态机，漂移面）。枚举外 from/to → CONFIG_INVALID。
   */
  transitionCandidate(id: string, from: CandidateStatus, to: CandidateStatus): boolean
  /**
   * verification 快照行中写面（沙箱完成点落列——e2e 裸 SQL 模拟的正式化）：
   * 只允许 sandboxed 态——其他态 → CONFIG_INVALID（store/candidates:verification-window，
   * 证据只进沙箱阶段，F3-02 四元组时序）；序列化与 insertCandidate 同源
   * （serializeVerification 单一口径源）；无此行=false（markRan 同风格如实上报）。
   * 乐观锁不需要（单写者）；语句级 WHERE status='sandboxed' 防越阶段。
   */
  updateVerification(id: string, verification: unknown): boolean
}

/**
 * verification 列序列化（**单一口径源**：insertCandidate 与 updateVerification 共用——
 * 两写面落列字节同源，读面 deep-equal 往返的机制保证）。归一：undefined≡null
 * （core 形状是 GateEvidence|null；zod unknown 收 JS 缺键形态）；不可 JSON 化的值
 * 拒收不静默（同 jobs.payload 口径：stringify 抛错或返 undefined 均拒）。
 * 返回列值（null=未跑沙箱）。
 */
function serializeVerification(verification: unknown, candidateId: string): string | null {
  if (verification === undefined || verification === null) return null
  try {
    const serialized = JSON.stringify(verification)
    if (serialized === undefined) {
      configInvalid('store/candidates:verification-unserializable', `候选 ${candidateId} verification 含不可 JSON 序列化的值`)
    }
    return serialized
  } catch (err) {
    configInvalid('store/candidates:verification-unserializable', `候选 ${candidateId} verification 不是可序列化 JSON 值：${errorMessage(err)}`)
  }
}

/** 候选面工厂（openLedger 唯一组装点摊入；db=同一句柄，不复制连接/状态） */
export function createCandidatesFace(db: DatabaseSync): CandidatesFace {
  // —— v5 进化管线 candidates 读写面实现（接口行注与文件头注 v5 段为语义依据） ——

  const rowToCandidate = (row: SqlRow): CandidateRow => {
    const verificationJson = optStr(row, 'verification')
    return {
      id: str(row, 'id'),
      asset_type: str(row, 'asset_type') as CandidateRow['asset_type'],
      asset_path: str(row, 'asset_path'),
      version: str(row, 'version'),
      diff_hash: str(row, 'diff_hash'),
      blast_radius: str(row, 'blast_radius') as CandidateRow['blast_radius'],
      // 快照不猜结构（同 jobs.payload 口径）：JSON 往返，坏列如实报；null=未跑沙箱
      verification: verificationJson === undefined ? null : parseJsonValue(verificationJson, 'store/candidates:verification-corrupt'),
      parent_id: row['parent_id'] === null || row['parent_id'] === undefined ? null : String(row['parent_id']),
      status: str(row, 'status') as CandidateRow['status'],
      created_at: Number(row['created_at']),
    }
  }

  const getCandidate = (id: string): CandidateRow | undefined => {
    const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id) as SqlRow | undefined
    return row === undefined ? undefined : rowToCandidate(row)
  }

  /** 单跳谱系查询（id → parent_id），主键定位；缺行=undefined */
  const parentLinkOf = (id: string): { id: string; parent_id: string | null } | undefined => {
    const row = db.prepare('SELECT id, parent_id FROM candidates WHERE id = ?').get(id) as SqlRow | undefined
    if (row === undefined) return undefined
    return {
      id: str(row, 'id'),
      parent_id: row['parent_id'] === null || row['parent_id'] === undefined ? null : String(row['parent_id']),
    }
  }

  /**
   * insert 谱系环闸（core ancestorIds 同语义）：沿 parent_id 上爬，遇链内已见 id 即环。
   * 既有环（库已坏）也在此如实抛（无此闸则悬挂链静默入库）；断链容忍（爬到缺失行自然停
   * ——core 同口径：环检不要求全链在库，lineage 读面才 fail-closed）。
   */
  const assertNoLineageCycleOnInsert = (newId: string, parentId: string): void => {
    const seen = new Set<string>([newId, parentId])
    let cur = parentLinkOf(parentId) // 存在性已由 parent-unknown 闸保证
    while (cur !== undefined && cur.parent_id !== null) {
      if (seen.has(cur.parent_id)) {
        configInvalid(
          'store/candidates:lineage-cycle',
          `候选 ${newId} 挂接父 ${parentId} 将构成谱系环（${cur.parent_id} 处闭环——若非新挂边所致即库内既有环）`,
        )
      }
      seen.add(cur.parent_id)
      cur = parentLinkOf(cur.parent_id)
    }
  }

  const insertCandidate = (record: unknown): InsertCandidateResult => {
    const r = assertRecord(CandidateRowSchema, record, 'store/candidates:invalid')
    // verification 序列化闸：serializeVerification 单一口径源（与 updateVerification 同源）
    const verificationJson = serializeVerification(r.verification, r.id)
    // 幂等闸（core proposeCandidate 语义）：同 (asset_path, diff_hash) 且非终态 → 既有 id 不新建；
    // 终态命中放行新建=换代重提（rejected/retired 后同键再提案是新谱系代）。同键多行时取
    // (created_at, id) 首行——不变量下同键至多一行非终态（insert 前置闸保证），多行为防御面
    const keyHits = db
      .prepare('SELECT * FROM candidates WHERE asset_path = ? AND diff_hash = ? ORDER BY created_at ASC, id ASC')
      .all(r.asset_path, r.diff_hash) as SqlRow[]
    const activeHit = keyHits.find((row) => !(TERMINAL_CANDIDATE_STATUS_VALUES as readonly string[]).includes(String(row['status'])))
    if (activeHit !== undefined) return { id: str(activeHit, 'id'), inserted: false }
    // id 冲突前置分类（PK 裸 UNIQUE 错误不是 ClassifiedError）：同 id 全列一致=幂等跳过，不一致=拒
    const byId = db.prepare('SELECT * FROM candidates WHERE id = ?').get(r.id) as SqlRow | undefined
    if (byId !== undefined) {
      const normalized = { ...r, verification: r.verification ?? null }
      if (canonicalJson(rowToCandidate(byId)) === canonicalJson(normalized)) return { id: r.id, inserted: false }
      configInvalid('store/candidates:duplicate-id', `候选 id=${r.id} 已存在且内容不一致（拒绝覆盖语义的重复登记）`)
    }
    // 谱系闸（core 同名闸镜像）：自引用 / 父不在库 / 挂接成环
    if (r.parent_id === r.id) {
      configInvalid('store/candidates:self-parent', `候选 ${r.id} 谱系父指向自身（自引用环）`)
    }
    if (r.parent_id !== null) {
      if (parentLinkOf(r.parent_id) === undefined) {
        configInvalid('store/candidates:parent-unknown', `候选 ${r.id} 谱系父 ${r.parent_id} 不在候选集（F3-02 谱系可反追）`)
      }
      assertNoLineageCycleOnInsert(r.id, r.parent_id)
    }
    db.prepare(
      `INSERT INTO candidates (
         id, asset_type, asset_path, version, diff_hash, blast_radius, verification, parent_id, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(r.id, r.asset_type, r.asset_path, r.version, r.diff_hash, r.blast_radius, verificationJson, r.parent_id, r.status, r.created_at)
    return { id: r.id, inserted: true }
  }

  /**
   * 全祖先链（应用层循环，非递归 CTE——选型说明）：
   *   - 断链/成环的 fail-closed 分类错（lineage-broken / lineage-cycle，与 core lineage 逐字
   *     同语义）在应用层自然表达；递归 CTE 里断链静默截断、环需 UNION 防重手法且难指认环点；
   *   - 每跳一条主键 SELECT，跳数=谱系深度（F3-02「反追 ≥3 跳」口径即个位数量级，N 条 SQL
   *     换语义精确性，量级可接受——涨量后再评估 CTE，拟稿）。
   */
  const lineageOf = (id: string): CandidateRow[] | undefined => {
    const self = getCandidate(id)
    if (self === undefined) return undefined
    const out: CandidateRow[] = [self]
    const seen = new Set<string>([self.id])
    let parent = self.parent_id
    while (parent !== null) {
      // seen 集：既有环如实抛 + 防死循环（环内候选反追不出根——库侧数据损坏防御面）
      if (seen.has(parent)) {
        configInvalid('store/candidates:lineage-cycle', `候选 ${id} 谱系链在 ${parent} 处成环（环内候选反追不出根）`)
      }
      const row = getCandidate(parent)
      if (row === undefined) {
        configInvalid('store/candidates:lineage-broken', `候选 ${id} 谱系断链：祖先 ${parent} 不在候选集（F3-02 反追 ≥3 跳不可满足）`)
      }
      seen.add(parent)
      out.push(row)
      parent = row.parent_id
    }
    return out
  }

  /** 状态值域运行期闸（TS 字面量类型挡编译期，JS 调用方/配置驱动仍须如实拒——对齐 listBudgets kinds 闸） */
  const isCandidateStatus = (v: unknown): v is CandidateStatus =>
    (CANDIDATE_STATUS_VALUES as readonly string[]).includes(v as string)

  const candidatesByStatus = (statuses: readonly CandidateStatus[]): CandidateRow[] => {
    if (!Array.isArray(statuses) || statuses.length === 0) {
      configInvalid('store/candidates:bad-statuses', 'statuses 须为非空数组（按状态集查询——空集=调用方 bug，fail-closed 拒）')
    }
    const bad = (statuses as readonly unknown[]).find((s) => !isCandidateStatus(s))
    if (bad !== undefined) {
      configInvalid('store/candidates:bad-statuses', `statuses 含枚举外值：${String(bad)}（值域 ${CANDIDATE_STATUS_VALUES.join('/')}）`)
    }
    // 占位符逐个参数化绑定（无内插面）；值域闸已过，长度安全
    const placeholders = statuses.map(() => '?').join(', ')
    const rows = db
      .prepare(`SELECT * FROM candidates WHERE status IN (${placeholders}) ORDER BY created_at ASC, id ASC`)
      .all(...statuses) as SqlRow[]
    return rows.map(rowToCandidate)
  }

  const transitionCandidate = (id: string, from: CandidateStatus, to: CandidateStatus): boolean => {
    if (!isCandidateStatus(from) || !isCandidateStatus(to)) {
      configInvalid(
        'store/candidates:bad-status',
        `状态值域外：from=${String(from)} to=${String(to)}（值域 ${CANDIDATE_STATUS_VALUES.join('/')}）`,
      )
    }
    // 乐观锁：期望当前值不匹配（已迁走/无此行）即 0 行=false——两次并发同迁恰一次成功。
    // 边合法性（机器边 / 闸门边 / 人裁边）归 core transitionCandidate 纯函数，本面不复制判定
    //（复制=第二状态机，漂移面；见接口行注）。
    const result = db.prepare('UPDATE candidates SET status = ? WHERE id = ? AND status = ?').run(to, id, from)
    return Number(result.changes) > 0
  }

  /**
   * verification 快照行中写面（沙箱完成点落列；接口行注为语义依据）：
   *   - 序列化闸先行（serializeVerification 与 insertCandidate 同源——输入面校验先于状态窗，
   *     对齐 insert「形状闸→幂等闸→写」的顺序）；
   *   - 窗口闸 fail-closed 分类：无此行=false（markRan 同风格，不猜不抛）；非 sandboxed 态
   *     → CONFIG_INVALID（store/candidates:verification-window——证据只进沙箱阶段，F3-02
   *     四元组时序：gated 之后闸门已消费快照，再写=改口供）；
   *   - 语句级 WHERE status='sandboxed' 防越阶段：乐观锁不需要（daemon 单写者），此处是
   *     「读到 status」与「写入」两步间的兜底（正常流不触发，触发即并发违规面如实 false）。
   */
  const updateVerification = (id: string, verification: unknown): boolean => {
    const verificationJson = serializeVerification(verification, id)
    const row = db.prepare('SELECT status FROM candidates WHERE id = ?').get(id) as { status: unknown } | undefined
    if (row === undefined) return false
    if (row.status !== 'sandboxed') {
      configInvalid(
        'store/candidates:verification-window',
        `候选 ${id} 状态 ${String(row.status)} 不在 verification 写入窗口（仅 sandboxed——证据只进沙箱阶段，F3-02 四元组时序）`,
      )
    }
    const result = db
      .prepare("UPDATE candidates SET verification = ? WHERE id = ? AND status = 'sandboxed'")
      .run(verificationJson, id)
    return Number(result.changes) > 0
  }

  return {
    insertCandidate,
    getCandidate,
    lineageOf,
    candidatesByStatus,
    transitionCandidate,
    updateVerification,
  }
}
