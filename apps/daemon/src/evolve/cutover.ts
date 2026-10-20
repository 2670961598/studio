/**
 * cutover —— 进化链切权执行器（「…→灰度→切权」的切权环节，20-§九；17-§三进化行）
 *
 * 规格依据（实现单引用）：
 *   - docs/20-§九：一切改进走候选制品管线（观测→提案→沙箱→三态闸门→灰度→**切权**→复盘）——
 *     本文件是链上「切权」一环的受控上产执行面：approved/promoted 候选**真实应用到生产资产**。
 *   - docs/17-§三进化行「→灰度→切权」：灰度归四刀之四（shadow 双跑对比，见头注「后续刀」），
 *     本刀只落切权；17-§2 supervisor 看护重启归运维刀（v0 只提示不实际重启——诚实边界）。
 *   - docs/02 F3-01（统一入口禁旁路）+ 16-§四 v0.10「无 candidate id 的生产改动判负」：
 *     判负闸（src/evolve/evolve-guard.ts，core assertChangeAuthorized）是「不许什么上产」的面；
 *     本文件是它的对偶——「合法授权的改动**可以**上生产」的唯一受控路径。
 *
 * 与 evolve-guard 观察模式的呼应（结构性保证，头注冻结）：
 *   - evolve-guard v0 是观察模式（启动自检 unauthorized 只报不阻断）——其头注声明「真单的
 *     生产改动路径尚不存在」。本刀落地后该前提反转：**合法改动的生产写路径已存在**（本函数），
 *     非授权改动无路可走——apps/daemon 内候选资产面的生产文件写口**只有 runCutover 一处**，
 *     写前双闸（状态前置 + authorize 写前复跑）缺一不落笔。因此观察模式升级为阻断模式的
 *     **接线点已就绪**（阻断后合法改动走本函数过闸，不再被误伤）——升阻断本体归真单刀。
 *   - 结构性对照：sandbox.ts 是「tmp 法」先例（对生产只读，唯一写口 writeInsideTmp 收在 tmp
 *     域）；本文件是它的对偶——从 tmp 走向生产，但**过闸后才许**，且一切写入收口在
 *     writeProduction 唯一写口（同目录 tmp+rename 原子面），写后必复核。
 *
 * 前置全链（顺序冻结，任一环红即拒——写未开始即无半改态）：
 *   ① 候选在库（getCandidate 回查）；
 *   ② 状态闸：status ∈ {approved, promoted}（AUTHORIZING_STATUSES 同款——approved=闸门/人裁
 *      放行待切权；promoted=已在产重切权，如重启后文件复位）；其余态拒（先走闸门，F3-01）；
 *   ③ 新文件可读 → 新内容 sha256（`sha256:<hex>` 前缀形，e2e diffHash 同款）；
 *   ④ **判负闸写前复跑**：authorize((asset_path, 新内容 sha256)) 必须放行——这是护栏的双保险
 *      第二闸：①②读的是候选行，④在写入前一刻对台账**全集现查**（candidatesByStatus 一查），
 *      两闸之间候选被吊销（approved→retired）等 TOCTOU 面由此收口；判负错误（含 nearMisses
 *      诊断）如实上抛，不吞不裹；
 *   ⑤ 写域 containment：asset_path resolve 后必须仍在资产根内（sandbox insideTmp 同精神——
 *      绝对路径 / ../ 形态逃逸即拒，结构性不写根外）；
 *   ⑥ 备份：目标现存文件复制为 `<目标全路径>.bak-<候选id>`（同目录，回滚锚点）。
 *
 * 写入与收口（失败面全枚举——任一失败回滚恢复，**不留半改态**）：
 *   ⑦ 原子写：同目录 tmp（`<目标>.tmp-<候选id>`，同文件系统保证 rename 原子）写 + rename；
 *   ⑧ 复核：读回目标 sha256 必须等于新内容 hash（写后校验 fail-closed）；
 *   ⑨ 状态迁移：approved→promoted（core transitionCandidate 判边 + store 乐观锁，evolution-e2e
 *      daemonTransition 同款接力；promoted 重切权免迁移）；
 *   ⑩ SCHEMA_EVOLVE 事件落账（事件名在 25 类冻结枚举内，contract EVENT_NAMES；note=候选 id+
 *      资产+旧新 hash+备份锚点）。事件记录在**触碰生产文件之前**先过 validateEventRecord 预检
 *      （形状红前移到写之前——事件面失败尽量不产生已写未记的窗口）。
 *   失败面（phase 标记 → 分类 subcause，回滚后如实报）：
 *     - backup-failed（⑥ 备份写失败——写未开始，原文件原样，无回滚面）；
 *     - write-failed（⑦ tmp 写/rename 失败）→ 回滚；
 *     - verify-mismatch（⑧ 读回不符）→ 回滚；
 *     - transition-lost（⑨ 乐观锁落库失败——并发面）→ 回滚；
 *     - event-append-failed（⑩ 落账抛错——预检后仍可能：盘满/库错等）→ 回滚文件，且若本次
 *       run 做过 approved→promoted 迁移，追记 promoted→retired 收口迁移（**合法机器边**，
 *       evolution.ts「promoted→retired=退役/回滚」语义的正用）——文件已回、状态不留孤悬 promoted。
 *     回滚动作：恢复备份逐字节（无备份=新资产面，撤除写入）+ 清理 tmp 残留；恢复失败**如实
 *     报**（备份路径带出——人工恢复锚点，不隐瞒）。备份文件本身**保留**（见清理策略拟稿）。
 *
 * 拟稿待批点（本文件口径，汇报后走批示流）：
 *   - **备份清理策略**：v0 备份**保留不自动清理**（回滚锚点——生产资产的每个切权点都留一个
 *     可逐字节恢复的锚）；同候选重复切权重写同名单锚（`<目标>.bak-<id>` 定名幂等）。老化
 *     （如按谱系代保留 N 代 / 下次同资产切权成功后清旧锚）归批示+后续刀，不静默删。
 *   - **事件名 SCHEMA_EVOLVE**（实现单指定，事件名在 25 类冻结枚举内）：语义面疑点已如实
 *     上报——SCHEMA_EVOLVE 现行用例是「加桶/加列走 SCHEMA_EVOLVE」（schema 演化）；候选资产
 *     上产（尤其 org_config 公司资产）与枚举内 ORG_UPGRADE（组织升级）的贴合度待勘定，批示
 *     前按实现单冻结 SCHEMA_EVOLVE。
 *   - **events.issue 哨兵 '-'**：切权无单号语境（候选 id 是谱系键非单号），取 evolve-guard
 *     ESCALATE 哨兵同款 '-'（拟稿口径同源）；挂真单归提案/审批流后续刀。
 *   - **level 缺省 9**：切权=生产资产变更的制作人对面（闸门/人裁放行后执行），取 postmortem
 *     同款最高档拟稿；actor='daemon' / dept='departments/工程部' 同 daemon 缺省档。
 *   - **promoted 重切权语义**：promoted 候选再跑 cutover=文件复位/重放（如漂移后对齐、重启
 *     加载面），不迁移不复 promoted（幂等），事件照落（重切权也是生产写，留痕面不豁免）。
 *   - **restart v0=只提示**：restart=true（缺省）打印「daemon 需重启加载」（生产资产多在
 *     进程启动时装载）；--no-restart 抑制提示。真重启（supervisor 拉起，launchd/看护脚本）
 *     归运维刀——本刀不做不假装。
 *   - **CLI 扩展面 --company/--root**：实现单 CLI 面 `--db --candidate --file [--no-restart]`；
 *     events.company 是台账路由键（postmortem 同款不猜，必填）；--root 资产根（sandbox 同款，
 *     缺省 '.'）。两旗标为实现单面的必要补全，已上报。
 *
 * 后续刀（本刀不做，头注声明）：
 *   - **灰度**（四刀之四）：已落地为切权后观察窗（src/evolve/gray.ts，v0 文件类资产收窄语义见
 *     其头注）——本文件尾部接线：切权成功即默认开窗（opts.gray !== false），--no-gray 跳过；
 *     shadow 双跑对比（F3-04，公司面候选）仍归后续刀。
 *   - supervisor 看护（launchd/看护脚本拉起 daemon 重启加载）归运维刀。
 *   - evolve-guard 观察模式升阻断模式的接线本体（接线点已就绪，见「呼应」段）归真单刀。
 *
 * 纯 IO 纪律：零新依赖（node:fs/node:crypto 直用）；候选 id/事件 id 生成走注入面（缺省
 * makeUlid，测试确定性替身）；机器边判定**只走 core transitionCandidate 单一状态机**（store
 * 同款纪律——本文件不复制判定面）；probes 注入面（afterWrite/afterMigrate）沿 crash-points
 * 先例，仅供失败面注入测试，生产调用不传。
 */
import { createHash } from 'node:crypto'
import { copyFileSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { configInvalid, validateEventRecord } from '@studio-next/contract'
import type { ClassifiedError, EventRecord } from '@studio-next/contract'
import { transitionCandidate as coreTransition } from '@studio-next/core'
import type { CandidateRecord } from '@studio-next/core'
import type { CandidateRow, Ledger } from '@studio-next/store'
import { createEvolveGuard } from './evolve-guard.ts'
import type { EvolveGuard } from './evolve-guard.ts'
import { makeUlid } from '../engine/tools/id.ts'
import { openGrayWindow } from './gray.ts'

// ————————————————————————— 形状面 —————————————————————————

/** 切权入参（CLI 链组装；测试直调同面）。newFilePath=新内容全文文件（v0 单文件语义，与 sandbox --file 同款） */
export interface CutoverOptions {
  /** 新文件本地路径（内容=候选资产整文件替换——读入后其 sha256 即判负闸消费的 diff_hash） */
  newFilePath: string
  /** 生产资产根（candidate.asset_path 相对此根解析**写入**；写域 containment 见头注⑸） */
  assetRoot: string
  /** 公司 slug（events.company 台账路由键，必填不猜——postmortem 同款） */
  company: string
  /** events.actor（缺省 'daemon'——ENGINE_CONFIG_DEFAULTS 同款拟稿档） */
  actor?: string
  /** events.dept（缺省 'departments/工程部'——deptFallback 同款拟稿档） */
  dept?: string
  /** events.level（缺省 9——生产资产变更=制作人对面，最高档拟稿，头注拟稿点） */
  level?: number
  /** events.issue 哨兵（缺省 '-'——evolve-guard ESCALATE 同款拟稿口径，头注拟稿点） */
  issue?: string
  /** 切权后重启提示面：true（缺省）=打印「daemon 需重启加载」；v0 恒不实际重启（诚实边界） */
  restart?: boolean
  /** 切权后开灰度观察窗：true（缺省）=开窗成为切权默认后缀（src/evolve/gray.ts）；--no-gray 跳过 */
  gray?: boolean
  /** 时钟注入面（缺省 Date.now；事件 ts 取自此） */
  clock?: () => number
  /** ULID 工厂注入面（缺省 makeUlid；测试确定性替身） */
  idFactory?: (ts: number) => string
  /** 判负闸（缺省 createEvolveGuard(ledger)；测试注入替身） */
  guard?: EvolveGuard
  /** 失败面注入探针（crash-points 先例；生产不传——见头注「纯 IO 纪律」） */
  probes?: CutoverProbes
}

/** 失败面注入探针：afterWrite=原子写后/复核前；afterMigrate=状态迁移后/事件落账前 */
export interface CutoverProbes {
  afterWrite?: () => void
  afterMigrate?: () => void
}

/** 切权结果（bin.ts 打印面；测试断言面——store 读面回查应与各字段一致） */
export interface CutoverResult {
  candidateId: string
  assetPath: string
  /** 生产目标文件绝对路径 */
  targetPath: string
  /** 备份文件绝对路径（目标原不存在= null——新资产面无锚） */
  backupPath: string | null
  /** 切权前目标内容 hash（`sha256:<hex>`；目标原不存在= null） */
  oldHash: string | null
  /** 新内容 hash（= 候选 diff_hash 的授权匹配键） */
  newHash: string
  /** 本次是否发生 approved→promoted 迁移（false=promoted 重切权，头注拟稿点） */
  migrated: boolean
  /** 落账的 SCHEMA_EVOLVE 事件（store 读面回查应 deep-equal） */
  event: EventRecord
  /** 灰度观察窗是否已开（缺省开窗；--no-gray/开窗失败=false——见 grayError） */
  grayOpened: boolean
  /** 开窗失败报文（null=开窗成功或 --no-gray 跳过；失败不回滚切权——如实上报） */
  grayError: string | null
  /** restart 透传（渲染层打印重启提示用） */
  restart: boolean
}

/** 写入 phase 标记（失败面分类源——见头注「失败面全枚举」） */
type CutoverPhase = 'write' | 'verify' | 'migrate' | 'event'

// ————————————————————————— 私有小件 —————————————————————————

/** store 行 → core 记录（verification unknown 收窄回 core 形状——sandbox/evolve-guard 同款） */
function toCoreRecord(row: CandidateRow): CandidateRecord {
  return {
    id: row.id,
    asset_type: row.asset_type,
    asset_path: row.asset_path,
    version: row.version,
    diff_hash: row.diff_hash,
    blast_radius: row.blast_radius,
    verification: row.verification as CandidateRecord['verification'],
    parent_id: row.parent_id,
    status: row.status,
  }
}

/** 字节 sha256（`sha256:<hex>` 前缀形——e2e diffHash / evolve-guard fileHash 同款口径） */
function sha256(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 目标是否为现存常规文件（不可 stat = 不存在——新资产面） */
function isRegularFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * **唯一生产写口**（结构性保证的落点，头注「呼应」段）：本模块对生产资产树的全部内容写入
 * 都经此函数——同目录 tmp 写 + rename 原子替换（同文件系统保证 rename 原子性；tmp 定名
 * `<目标>.tmp-<候选id>` 幂等可清理）。逃逸检查在调用侧 containment 闸先行（头注⑸）。
 */
function writeProduction(targetPath: string, tmpPath: string, content: Buffer): void {
  writeFileSync(tmpPath, content)
  renameSync(tmpPath, targetPath)
}

// ————————————————————————— 切权执行器 —————————————————————————

/**
 * runCutover——受控上产（头注「前置全链」①-⑥ + 「写入与收口」⑦-⑩，顺序冻结）。
 *
 * 双闸结构（非授权改动无路可走的机制面）：
 *   - 第一闸（①②）：候选行在库且 status ∈ {approved, promoted}；
 *   - 第二闸（④）：写入前一刻 authorize((asset_path, 新内容 sha256)) 对台账全集现查必须放行
 *     ——两闸之间状态被并发改动（吊销/换代）由此拦截（TOCTOU 收口）。
 * 链内失败如实抛（CONFIG_INVALID 分类，subcause 见头注失败面枚举），bin.ts 捕获 exit 1；
 * 写入开始后的失败先回滚再抛（不留半改态）。同步函数——全链是 fs+SQLite 同步面（sandbox
 * 异步面在子进程，本刀无子进程）。
 */
export function runCutover(ledger: Ledger, candidateId: string, opts: CutoverOptions): CutoverResult {
  const clock = opts.clock ?? Date.now
  const makeId = opts.idFactory ?? makeUlid
  const guard = opts.guard ?? createEvolveGuard(ledger)
  const probes = opts.probes ?? {}

  // —— ① 候选在库 ——
  const row = ledger.getCandidate(candidateId)
  if (row === undefined) {
    configInvalid('daemon/cutover:candidate-unknown', `候选 ${candidateId} 不在库（--candidate 回查失败）`)
  }

  // —— ② 状态闸：切权授权态 = {approved, promoted}（AUTHORIZING_STATUSES 同款；其余态先走闸门，F3-01 禁旁路） ——
  if (row.status !== 'approved' && row.status !== 'promoted') {
    configInvalid(
      'daemon/cutover:status-not-authorizing',
      `候选 ${candidateId} 状态 ${row.status} 不在切权授权态 {approved, promoted}（先走三态闸门/制作人裁决放行——F3-01 统一入口禁旁路；生产写未开始，无半改态）`,
    )
  }

  // —— ③ 新文件读取 + 内容 hash（授权匹配键） ——
  let content: Buffer
  try {
    content = readFileSync(path.resolve(opts.newFilePath))
  } catch (err) {
    configInvalid('daemon/cutover:source-unreadable', `新文件不可读 ${opts.newFilePath}：${errText(err)}`)
  }
  const newHash = `sha256:${sha256(content)}`

  // —— ④ 判负闸写前复跑（双保险第二闸；判负错误含 nearMisses 诊断，如实上抛不裹） ——
  guard.authorize(row.asset_path, newHash)

  // —— ⑤ 写域 containment：目标必须解析在资产根内（sandbox insideTmp 同精神） ——
  const rootAbs = path.resolve(opts.assetRoot)
  const targetPath = path.resolve(rootAbs, row.asset_path)
  if (!targetPath.startsWith(rootAbs + path.sep)) {
    configInvalid(
      'daemon/cutover:path-escape',
      `asset_path 逃逸：${row.asset_path}（resolve 后 ${targetPath} 在资产根 ${rootAbs} 外——写域结构性拒，sandbox insideTmp 同精神）`,
    )
  }

  // —— ⑥ 备份：现存文件 → `<目标>.bak-<候选id>`（保留=回滚锚点，头注清理策略拟稿点） ——
  const backupPath = `${targetPath}.bak-${row.id}`
  const tmpPath = `${targetPath}.tmp-${row.id}`
  const targetExisted = isRegularFile(targetPath)
  let oldHash: string | null = null
  if (targetExisted) {
    oldHash = `sha256:${sha256(readFileSync(targetPath))}`
    try {
      copyFileSync(targetPath, backupPath)
    } catch (err) {
      configInvalid(
        'daemon/cutover:backup-failed',
        `备份失败 ${targetPath} → ${backupPath}：${errText(err)}（写未开始——原文件原样，无半改态；如实拒不冒险）`,
      )
    }
  }

  // —— 事件记录预构+预检（形状红前移到触碰生产之前——事件面失败尽量不产生已写未记窗口） ——
  const ts = clock()
  const event: EventRecord = {
    id: makeId(ts),
    ts,
    company: opts.company,
    issue: opts.issue ?? '-',
    event: 'SCHEMA_EVOLVE',
    actor: opts.actor ?? 'daemon',
    attempt: 1,
    level: opts.level ?? 9,
    dept: opts.dept ?? 'departments/工程部',
    tokens: { input: 0 },
    note:
      `CUTOVER 切权上产：候选 ${row.id}（${row.asset_path} · ${row.asset_type} · blast=${row.blast_radius}）` +
      `｜hash ${oldHash ?? '（无——新资产原不存在）'} → ${newHash}` +
      `｜备份锚点 ${backupPath}${targetExisted ? '' : '（无——新资产面）'}`,
  }
  const precheck = validateEventRecord(event)
  if (!precheck.ok) {
    configInvalid(
      'daemon/cutover:event-invalid',
      `SCHEMA_EVOLVE 事件形状预检不过（写未开始，无半改态）：${precheck.issues.map((i) => `${i.path}: ${i.message}`).join('；')}`,
    )
  }

  // —— ⑦-⑩ 写入与收口（失败信封：任一环红先回滚再如实报，不留半改态） ——
  let migrated = false
  let phase: CutoverPhase = 'write'
  try {
    writeProduction(targetPath, tmpPath, content)
    probes.afterWrite?.()

    phase = 'verify'
    const readBack = `sha256:${sha256(readFileSync(targetPath))}`
    if (readBack !== newHash) {
      configInvalid(
        'daemon/cutover:verify-mismatch',
        `复核不符：${targetPath} 读回 hash ${readBack} ≠ 预期 ${newHash}（写后校验 fail-closed——回滚恢复原文件）`,
      )
    }

    phase = 'migrate'
    if (row.status === 'approved') {
      const next = coreTransition(toCoreRecord(row), 'promoted') // core 单一状态机判边
      if (!ledger.transitionCandidate(row.id, row.status, next.status)) {
        configInvalid(
          'daemon/cutover:transition-lost',
          `候选 ${row.id} approved→promoted 乐观锁落库失败（期望当前值已过期——并发面，回滚文件不留半改态）`,
        )
      }
      migrated = true
      probes.afterMigrate?.()
    }

    phase = 'event'
    ledger.appendEvent(event)

    // —— 灰度观察窗默认后缀（--no-gray 跳过）：生产写已收口，开窗只是 kv 登记——
    //    开窗失败不回滚切权（回滚已成立的上产才是事故），如实上报进结果面；
    //    重跑 cutover（promoted 幂等）即重试开窗（src/evolve/gray.ts 头注接线段）。
    let grayOpened = false
    let grayError: string | null = null
    if (opts.gray !== false) {
      try {
        openGrayWindow(ledger, { candidateId: row.id, assetPath: row.asset_path, company: opts.company, clock })
        grayOpened = true
      } catch (grayErr) {
        grayError = errText(grayErr)
      }
    }

    return {
      candidateId: row.id,
      assetPath: row.asset_path,
      targetPath,
      backupPath: targetExisted ? backupPath : null,
      oldHash,
      newHash,
      migrated,
      event,
      grayOpened,
      grayError,
      restart: opts.restart !== false,
    }
  } catch (err) {
    throw rolledBack(err, phase, { targetPath, tmpPath, backupPath, targetExisted, ledger, row, migrated })
  }
}

/** 回滚信封（写入开始后的失败面收口——头注「失败面全枚举」段的执行体）；返回分类错误供调用点 throw */
function rolledBack(
  err: unknown,
  phase: CutoverPhase,
  ctx: {
    targetPath: string
    tmpPath: string
    backupPath: string
    targetExisted: boolean
    ledger: Ledger
    row: CandidateRow
    migrated: boolean
  },
): Error & ClassifiedError {
  const subcauseOf = phase === 'write' ? 'write-failed' : phase === 'verify' ? 'verify-mismatch' : phase === 'migrate' ? 'transition-lost' : 'event-append-failed'
  const notes: string[] = []

  // 1) tmp 残留清理（rename 未发生面才有残留；不存在即无事）
  try {
    unlinkSync(ctx.tmpPath)
    notes.push(`tmp 残留已清理（${ctx.tmpPath}）`)
  } catch {
    /* 无残留即无事——不冒充清理 */
  }

  // 2) 目标恢复：有备份=逐字节恢复；无备份（新资产面）=撤除写入
  try {
    if (ctx.targetExisted) {
      copyFileSync(ctx.backupPath, ctx.targetPath)
      notes.push(`原文件已从备份逐字节恢复（${ctx.backupPath}——锚点保留）`)
    } else {
      try {
        unlinkSync(ctx.targetPath)
        notes.push('新资产写入已撤除（目标原不存在——回空）')
      } catch {
        notes.push('新资产面无写入残留（写未落）')
      }
    }
  } catch (restoreErr) {
    notes.push(`**回滚恢复失败**：${errText(restoreErr)}（备份仍在 ${ctx.backupPath}——人工恢复锚点，如实上报不隐瞒）`)
  }

  // 3) 事件落账失败面的收口迁移：本 run 迁移过才动——promoted→retired 是合法机器边
  //    （evolution.ts「promoted→retired=退役/回滚」的正用；文件已回，状态不留孤悬 promoted）
  if (ctx.migrated && phase === 'event') {
    try {
      const next = coreTransition({ ...toCoreRecord(ctx.row), status: 'promoted' }, 'retired')
      if (!ctx.ledger.transitionCandidate(ctx.row.id, 'promoted', next.status)) {
        notes.push(`候选 ${ctx.row.id} promoted→retired 收口迁移落库失败（并发面——状态可能孤悬 promoted，人工核对台账）`)
      } else {
        notes.push(`候选 ${ctx.row.id} 已追记 promoted→retired 收口迁移（文件已回滚，状态不留孤悬——合法机器边「退役/回滚」）`)
      }
    } catch (retireErr) {
      notes.push(`候选 ${ctx.row.id} promoted→retired 收口迁移失败：${errText(retireErr)}（状态可能孤悬 promoted，人工核对台账——如实上报）`)
    }
  }

  const err2 = new Error(
    `CONFIG_INVALID/daemon/cutover:${subcauseOf}：切权失败已回滚（不留半改态）：${errText(err)}｜回滚：${notes.join('；')}`,
  ) as Error & ClassifiedError
  err2.category = 'CONFIG_INVALID'
  err2.subcause = `daemon/cutover:${subcauseOf}`
  return err2
}

// ————————————————————————— CLI 链打印面 —————————————————————————

/** 链结果打印面（bin.ts 用：判定行+明细行，日志即证据摘要；restart 提示行=诚实边界） */
export function renderCutoverLines(result: CutoverResult, row: CandidateRow): string[] {
  const lines = [
    `[cutover] 候选 ${row.id}（${row.asset_path} · ${row.asset_type} · blast=${row.blast_radius}）——切权上产完成（20-§九管线「→灰度→切权」切权环节；双闸：status∈{approved,promoted} + 判负闸写前复跑）`,
    `[cutover] 备份锚点：${result.backupPath ?? '（无——目标原不存在，新资产面）'}（保留不自动清理——回滚锚点，清理策略拟稿见 src/evolve/cutover.ts 头注）`,
    `[cutover] 原子写：同目录 tmp+rename → ${result.targetPath}｜复核通过：读回 hash=${result.newHash}`,
    `[cutover] hash 迁移：${result.oldHash ?? '（无）'} → ${result.newHash}`,
    `[cutover] 状态：${result.migrated ? 'approved→promoted（core 判边+store 乐观锁）' : 'promoted 重切权（文件复位/重放，免迁移——幂等）'}`,
    `[cutover] 台账留痕：SCHEMA_EVOLVE 事件 ${result.event.id}｜issue=${result.event.issue}｜note 携候选+资产+旧新 hash+备份锚点`,
    result.grayOpened
      ? `[cutover] 灰度观察窗：已开窗（kv gray:${row.id}，缺省窗 24h·阈值 1 条事故信号——20-§四零事故守夜；检查面：studio-next gray --check，src/evolve/gray.ts）`
      : result.grayError !== null
        ? `[cutover] 灰度观察窗：**开窗失败（如实上报，切权不受影响——生产写已完成且复核过）**：${result.grayError}（重跑 cutover（promoted 幂等）即重试开窗）`
        : '[cutover] 灰度观察窗：跳过（--no-gray）',
  ]
  if (result.restart) {
    lines.push('[cutover] daemon 需重启加载新资产（v0 只提示不实际重启——supervisor 看护归运维刀，诚实边界见 src/evolve/cutover.ts 头注）')
  }
  return lines
}
