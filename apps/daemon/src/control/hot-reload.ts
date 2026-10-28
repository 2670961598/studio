/**
 * hot-reload —— L1 配置级热重载（docs/38-§2 L1 / §4 R-A，制作人 2026-10-19 全批）
 *
 * 语义：公司目录装载面（org-config/charter/prompts/departments…）变更 → **drain 到拍边界**
 * （不中断在途单/dispatch）→ 重走装载面（校验 → 快照 → 装配器/人员索引/调度岗替换）→ 继续
 * 跑，**零进程重启**。触发面＝自动（每拍 stat+mtime，稳定窗后重装载）＋手动（`studio-next
 * reload`，控制面文件通道）。check() 只由 serve 主循环在 engine.tick() 收口后调用（单线程，
 * 无并发 tick）——重装载不可能打断在途拍；旧单跑旧装配方。
 *
 * 部分失败面（与 cutover 原子语义对齐——不留半改态）：校验不过→保持旧配置 + ESCALATE
 * （RELOAD_CONFIG_INVALID；同 stat 形态只告一次，stat 再变＝新告警防刷屏）；apply 抛错→保持
 * 旧态 + ESCALATE（RELOAD_APPLY_FAILED）。**信任锚应用门**（SEC-FC-03 后半；docs/43-附录A-3）：
 * **锚在场且校验过**才允许应用——坏锚（不可读/坏 JSON/形状不符）→拒自动应用 + ESCALATE
 * （RELOAD_TRUST_ANCHOR_INVALID，具名接收者=制作人），重复出现→自动面停用
 * （RELOAD_TRUST_ANCHOR_DISABLED；不静默重试），坏锚在场时构造即拒启 CONFIG_INVALID；无锚≠
 * 坏锚：未显式声明无锚→拒（RELOAD_TRUST_ANCHOR_ABSENT），`anchorAbsence` 显式声明（init 通道）
 * 才放行并记台账；valid 锚且 trust=false/指纹≠批准指纹→拒 + 撤销受信位 + ESCALATE
 * （RELOAD_TRUST_DRIFT），等显式 re-approve 后经手动 reload 应用。.studio-next/ 被监听排除表
 * 隔离（approve/revoke 不触发重装载——批准动作不自扰）。
 *
 * 事件名选型【拟稿待批，cutover.ts 同款上报式】：'RELOAD' 不在冻结 25 类事件枚举内，contract
 * 不可碰——成功落 **SCHEMA_EVOLVE**（note 前缀 `RELOAD;`：进化链切权后的生效环，docs/38-§3 ★）；
 * 拒载/失败/安全面落 **ESCALATE**（面板事件流可见）。正式事件名归契约批示。
 *
 * 控制面文件通道：请求 <rootDir>/control/reload.request.json（CLI 原子写 tmp+rename：
 * {id, company|null, requestedAt}）；回执 reload.result.json（{id, ok, applied, reason?, detail?}）。
 * 每拍读请求：id 前进即处理（同 id 幂等）；company 不符→回执 company-mismatch 不重装载不落账。
 *
 * 指纹口径：per-file sha256(content)（hex）；总指纹=sorted(`path:hash`) 行串再 sha256（`sha256:`
 * 前缀形，与 cutover diffHash 同形）。轻量 stat（size+mtimeMs，每拍）→ 内容指纹（重装载时才算）。
 * v0 边界：只热更公司目录装载面；daemon.yaml 与框架代码不在 L1 面（重启生效/归 R-C 进程交接）；
 * 岗移除＝快照消失的岗 removeJob；不用 fs.watch（watch-file 盲窗教训见 sources.ts 头注）；
 * 稳定窗 minStableMs（缺省 500）＝首见记 pending，连续两拍不变且距首见≥窗才动手（半写防护）。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  SCAN_EXCLUDED_NAMES,
  TRUST_DIR,
  excludeAnchorFiles,
  inspectTrustAnchor,
  loadCompanyDirectory,
  readDirectoryFiles,
  revokeTrust,
  type TrustAnchor,
} from '@studio-next/company'
import type { CompanySnapshot, DirectoryIssue, EventRecord } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'

/** 监听排除表（单源扩展：company 基表 + 信任锚目录 .studio-next/——锚自指隔离，docs/43-附录A-3）；
 *  statDirectory 与基线 walk 同消费本表，一处改两处不漂移。 */
const WATCH_EXCLUDED_NAMES: readonly string[] = [...SCAN_EXCLUDED_NAMES, TRUST_DIR]

// ————————————————————————— 指纹面（纯函数，单测直接打） —————————————————————————

/** 单文件轻量 stat（变更检测的廉价面——零内容读） */
export interface AssetStat { size: number; mtimeMs: number }

/** 目录 stat 索引：相对根 POSIX 路径 → stat（与 readDirectoryFiles 同走法） */
export type StatIndex = Record<string, AssetStat>

/** 目录内容指纹（重装载确认段与落账 note 的源料；overall=sorted `path:hash` 行串再 sha256） */
export interface DirectoryFingerprint { overall: string; files: Record<string, string> }

/** stat 层变更清单（added/removed/modified 三桶） */
export interface StatDiff { added: string[]; removed: string[]; modified: string[] }

/** 与 readDirectoryFiles 同规则走目录（排除面=WATCH_EXCLUDED_NAMES；目录序确定）——只 stat 不读内容。 */
export function statDirectory(root: string): StatIndex {
  const out: StatIndex = {}
  const walk = (dir: string, prefix: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (WATCH_EXCLUDED_NAMES.includes(entry.name)) continue
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs, rel)
      else if (entry.isFile()) {
        const st = statSync(abs)
        out[rel] = { size: st.size, mtimeMs: st.mtimeMs }
      }
    }
  }
  walk(root, '')
  return out
}

/** stat 索引 diff（三桶；同键 size/mtimeMs 任一变即 modified——mtime 触发内容复核） */
export function diffStatIndex(prev: StatIndex, next: StatIndex): StatDiff {
  const added: string[] = []
  const removed: string[] = []
  const modified: string[] = []
  for (const key of Object.keys(next)) {
    const before = prev[key]
    const after = next[key]
    if (before === undefined) added.push(key)
    else if (after === undefined || before.size !== after.size || before.mtimeMs !== after.mtimeMs) modified.push(key)
  }
  for (const key of Object.keys(prev)) {
    if (next[key] === undefined) removed.push(key)
  }
  return { added, removed, modified }
}

/** stat diff 是否空桶（三桶全空=无变更） */
export function statDiffEmpty(diff: StatDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0
}

/** 内容指纹（per-file sha256 + 总指纹；输入=readDirectoryFiles 产物） */
export function fingerprintDirectory(files: Record<string, string>): DirectoryFingerprint {
  const perFile: Record<string, string> = {}
  const lines: string[] = []
  for (const rel of Object.keys(files).sort()) {
    const hash = createHash('sha256').update(files[rel] ?? '', 'utf8').digest('hex')
    perFile[rel] = hash
    lines.push(`${rel}:${hash}`)
  }
  return { overall: `sha256:${createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex')}`, files: perFile }
}

/** 变更清单渲染（note 用：`+a、+b、-c、~d`——RELOAD note 的资产清单段） */
export function renderStatDiff(diff: StatDiff): string {
  return [
    ...diff.added.map((f) => `+${f}`),
    ...diff.removed.map((f) => `-${f}`),
    ...diff.modified.map((f) => `~${f}`),
  ].join('、')
}

// ————————————————————————— 控制面文件通道（reload 子命令 ↔ daemon） —————————————————————————

/** 控制面目录段（<rootDir>/control——workspace/tmp 同级，rootDir 旗下） */
export const CONTROL_DIR = 'control'
export const RELOAD_REQUEST_FILE = 'reload.request.json'
export const RELOAD_RESULT_FILE = 'reload.result.json'

/** reload 请求（CLI 写；company 缺省 null=不限家——daemon 侧比对） */
export interface ReloadRequest { id: string; company: string | null; requestedAt: number }

/** reload 回执（daemon 写；CLI 轮询至 id 匹配；applied=false=未动：unchanged/错家/失败面） */
export interface ReloadResult { id: string; ok: boolean; applied: boolean; reason?: string; detail?: string }

/** 控制面目录绝对路径（<rootDir>/control） */
export function controlDirOf(rootDir: string): string {
  return path.join(rootDir, CONTROL_DIR)
}

/** CLI 侧：原子写请求（tmp+rename——daemon 读到的恒是完整 JSON） */
export function writeReloadRequest(rootDir: string, request: ReloadRequest): void {
  const dir = controlDirOf(rootDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = path.join(dir, RELOAD_REQUEST_FILE)
  const tmp = `${target}.tmp-${request.id}`
  writeFileSync(tmp, `${JSON.stringify(request, null, 2)}\n`, 'utf8')
  renameSync(tmp, target)
}

/** daemon 侧：读请求（无文件/坏 JSON → undefined——控制面文件坏不当唤起，下拍再看） */
export function readReloadRequest(rootDir: string): ReloadRequest | undefined {
  const target = path.join(controlDirOf(rootDir), RELOAD_REQUEST_FILE)
  if (!existsSync(target)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as Partial<ReloadRequest>
    if (typeof parsed.id !== 'string' || parsed.id === '') return undefined
    return { id: parsed.id, company: typeof parsed.company === 'string' && parsed.company !== '' ? parsed.company : null, requestedAt: typeof parsed.requestedAt === 'number' ? parsed.requestedAt : 0 }
  } catch {
    return undefined
  }
}

/** daemon 侧：写回执（原子写；CLI 按 id 匹配消费） */
export function writeReloadResult(rootDir: string, result: ReloadResult): void {
  const dir = controlDirOf(rootDir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const target = path.join(dir, RELOAD_RESULT_FILE)
  const tmp = `${target}.tmp-${result.id}`
  writeFileSync(tmp, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  renameSync(tmp, target)
}

/** CLI 侧：轮询回执至 id 匹配（超时 undefined——daemon 不在跑或拍太慢） */
export async function awaitReloadResult(rootDir: string, id: string, timeoutMs: number, pollMs = 100): Promise<ReloadResult | undefined> {
  const target = path.join(controlDirOf(rootDir), RELOAD_RESULT_FILE)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (existsSync(target)) {
      try {
        const parsed = JSON.parse(readFileSync(target, 'utf8')) as Partial<ReloadResult>
        if (parsed.id === id) {
          return { id: parsed.id as string, ok: parsed.ok === true, applied: parsed.applied === true, ...(parsed.reason !== undefined ? { reason: String(parsed.reason) } : {}), ...(parsed.detail !== undefined ? { detail: String(parsed.detail) } : {}) }
        }
      } catch {
        // 坏 JSON/读到写一半：下轮再读（daemon 侧原子写使本分支近不可达——兜底不炸）
      }
    }
    if (Date.now() >= deadline) return undefined
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

/** 未挂公司目录 daemon 的控制面应答：回执 no-company-dir（CLI 轮询不悬空），不重装载不落账。 */
export function answerReloadNoCompanyDir(rootDir: string, company: string, lastSeen: string | null): string | null {
  const request = readReloadRequest(rootDir)
  if (request === undefined || request.id === lastSeen) return lastSeen
  writeReloadResult(rootDir, { id: request.id, ok: false, applied: false, reason: 'no-company-dir', detail: `daemon 未挂公司目录（daemon.yaml companyDir 未配）——L1 配置热重载不适用；本 daemon company=${company}` })
  return request.id
}

// ————————————————————————— 热重载执行体（daemon 侧，拍边界驱动） —————————————————————————

/** apply 回调产物（serve 侧装载面执行汇报——RELOAD note 的岗变动段源料；hr=人事批次，hrSync 关=恒空档） */
export interface HotReloadApplyReport { jobsSeeded: number; jobsKept: number; jobsRemoved: number; hr?: { batchId: string | null; summary: string; enqueued: number } }

/** 无锚装配显式声明（SEC-FC-03：无锚只允许出现在显式声明无锚的装配并记台账） */
export interface AnchorAbsenceDeclaration { declaredBy: string; reason?: string }

/** 应用门拒绝类别（SEC-FC-03 后半；坏锚/缺失/停用三分——坏锚≠无锚） */
export type TrustAnchorReject = 'trust-anchor-absent' | 'trust-anchor-invalid' | 'trust-anchor-disabled'

/** 热重载依赖（serve 装配注入；IO 面全部可注入替身） */
export interface HotReloadDeps {
  /** 公司目录绝对路径（daemon 只读——唯一写入者纪律不改） */
  companyDir: string
  /** daemon 工位根（控制面文件通道落点 <rootDir>/control/） */
  rootDir: string
  ledger: Ledger
  /** daemon 配置 company（events.company 路由键 + 控制面请求比对位） */
  company: string
  clock: () => number
  makeId: (ts: number) => string
  log: (line: string) => void
  /** 装载面应用（校验绿后调用；**抛错=按 apply-failed 处置**——实现内部先做幂等台账段，后做纯赋值段） */
  apply: (snapshot: CompanySnapshot) => HotReloadApplyReport
  /** events.dept 兜底（快照无部门时——serve 同源注入） */
  deptFallback: string
  /** 自动指纹监听开关（daemon.yaml reloadWatch；false=只剩手动通道） */
  watch: boolean
  /** 稳定窗 ms（缺省 500——半写防护，头注） */
  minStableMs?: number
  /** 目录读取面（测试注入替身；缺省 readDirectoryFiles） */
  readFiles?: (dir: string) => Promise<Record<string, string>>
  /** stat 扫描面（测试注入替身；缺省 statDirectory） */
  scanStats?: (dir: string) => StatIndex
  /** 装配显式声明无锚（init 通道；缺省＝未声明→无锚拒自动应用）；声明即台账留痕，不静默放行 */
  anchorAbsence?: AnchorAbsenceDeclaration
}

/** 一次 check() 的结论（null=本拍无事；serve 只做日志/观测） */
export interface HotReloadReport {
  kind: 'reloaded' | 'invalid' | 'apply-failed' | 'unchanged' | 'company-mismatch' | 'trust-drift' | TrustAnchorReject
  changes: string // 变更资产清单（+/-/~ 渲染；manual-unchanged/company-mismatch 为空串）
  fingerprint?: string // 新总指纹（reloaded/manual-unchanged 时有）
  event: EventRecord | null // reloaded=SCHEMA_EVOLVE；拒载/失败/安全面=ESCALATE；其余 null
  detail?: string
}

/** 热重载句柄（serve 主循环拍边界调 check；stats 供测试/面板观测） */
export interface HotReload {
  /** 恒不抛（内部全捕获、如实落账/回执）——serve 拍边界直调 */
  check(): Promise<HotReloadReport | null>
  readonly stats: {
    checks: number
    reloads: number
    invalids: number // 拒载次数（invalid+apply-failed+应用门拒绝——每条对应一条 ESCALATE）
    manualRequests: number
    lastFingerprint: string
    anchorRejects: number // 信任锚应用门拒绝次数（absent/invalid/disabled）
    autoDisabled: boolean // 坏锚重复出现→自动面停用（不静默重试；修复锚后手动 reload 或重启）
  }
}

/** createHotReload —— L1 热重载执行体。构造期同步建指纹基线（失败抛 CONFIG_INVALID——宁拒起不半装）；事件 issue 哨兵 '-'、tokens 零值桶。 */
export function createHotReload(deps: HotReloadDeps): HotReload {
  const minStableMs = deps.minStableMs ?? 500
  const readFiles = deps.readFiles ?? ((dir: string): Promise<Record<string, string>> => readDirectoryFiles(dir))
  const scanStats = deps.scanStats ?? statDirectory

  // 应用门前置（SEC-FC-03）：坏锚在场＝拒启（不许「先起来后补证明」）；无锚留给应用门按声明处置。
  const startupAnchor = inspectTrustAnchor(deps.companyDir)
  if (startupAnchor.kind === 'invalid') {
    throw new Error(`CONFIG_INVALID：信任锚坏锚，拒绝启动（${startupAnchor.error.reason}）：${startupAnchor.error.message}`)
  }
  if (startupAnchor.kind === 'absent') {
    deps.log(`[hot-reload] 信任锚不在场（${deps.companyDir}）：${deps.anchorAbsence !== undefined ? `装配已显式声明无锚（${deps.anchorAbsence.declaredBy}）` : '装配未声明无锚——自动应用将被拒绝（SEC-FC-03）'}`)
  }

  // —— 基线（启动期一次性；readFiles 替身面只影响 check 段，基线恒走真盘） ——
  let baselineStats: StatIndex
  let baselineFingerprint: DirectoryFingerprint
  try {
    baselineStats = scanStats(deps.companyDir)
    const files: Record<string, string> = {}
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        // 排除面=WATCH_EXCLUDED_NAMES 单源表（同 statDirectory——.AIWS=员工工作区 docs/43-§五；.studio-next=锚自指隔离 docs/43-附录A-3）
        if (WATCH_EXCLUDED_NAMES.includes(entry.name)) continue
        const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(abs, rel)
        else if (entry.isFile()) files[rel] = readFileSync(abs, 'utf8')
      }
    }
    walk(deps.companyDir, '')
    baselineFingerprint = fingerprintDirectory(files)
    deps.log(`[hot-reload] 公司目录指纹基线：${baselineFingerprint.overall.slice(0, 19)}…（${Object.keys(baselineFingerprint.files).length} 文件）——变更自动重装载已接（docs/38-§2 L1；稳定窗 ${minStableMs}ms；手动通道 <rootDir>/control/）`)
  } catch (err) {
    throw new Error(`CONFIG_INVALID：热重载指纹基线建立失败（${deps.companyDir}）：${err instanceof Error ? err.message : String(err)}`)
  }

  let lastRejectedStats: StatIndex | null = null // 拒载在册的 stat 形态（防刷屏比对位）
  let pending: { stats: StatIndex; since: number } | null = null // 自动面待稳定变更（首见 stats + 时刻）
  let lastRequestId: string | null = null // 已处置的控制面请求 id（同 id 幂等）
  let anchorStrikes = 0 // 坏锚观测计数（>1＝重复出现→停用自动面，不静默重试）
  let autoDisabled = false // 自动面停用位（手动通道仍可修复锚后应用）

  const stats = { checks: 0, reloads: 0, invalids: 0, manualRequests: 0, lastFingerprint: baselineFingerprint.overall, anchorRejects: 0, autoDisabled: false }

  function makeEvent(
    event: 'SCHEMA_EVOLVE' | 'ESCALATE',
    note: string,
    level: number,
    dept: string,
    size?: number,
    payloadHash?: string,
  ): EventRecord {
    const ts = deps.clock()
    return {
      id: deps.makeId(ts),
      ts,
      company: deps.company,
      issue: '-',
      event,
      actor: 'daemon',
      attempt: 1,
      level,
      dept,
      tokens: { input: 0 },
      ...(size !== undefined ? { size } : {}),
      ...(payloadHash !== undefined ? { payload_hash: payloadHash } : {}),
      note,
    }
  }

  function appendEvent(evt: EventRecord): EventRecord {
    deps.ledger.appendEvent(evt)
    return evt
  }

  /** 校验问题渲染（ESCALATE note 用——文件:行 [规则] 修法，与 serve 启动拒绝同形） */
  function renderIssues(issues: readonly DirectoryIssue[]): string {
    return issues.map((i) => `${i.file}:${i.line} [${i.rule}] ${i.fix}`).join('；')
  }

  /** 拒载统一收口：ESCALATE 留痕 + 拒载在册（防刷屏）+ 回执 + 旧态不动。 */
  function refuse(
    kind: 'invalid' | 'trust-drift' | TrustAnchorReject,
    reason: string,
    note: string,
    detail: string,
    diff: StatDiff,
    requestId: string | null,
  ): HotReloadReport {
    const evt = appendEvent(makeEvent('ESCALATE', note, 1, deps.deptFallback))
    stats.invalids += 1
    if (kind.startsWith('trust-anchor-')) {
      stats.anchorRejects += 1
      stats.autoDisabled = autoDisabled
    }
    lastRejectedStats = scanStats(deps.companyDir)
    pending = null
    deps.log(`[hot-reload] 拒载（保持旧态，trigger=${requestId === null ? 'auto' : 'manual'}）：${note}——ESCALATE ${evt.id} 已落账`)
    if (requestId !== null) writeReloadResult(deps.rootDir, { id: requestId, ok: false, applied: false, reason, detail })
    return { kind, changes: renderStatDiff(diff), event: evt, detail }
  }

  /**
   * 应用门前置：锚在场且校验过（SEC-FC-03 后半）。valid→ok；absent 未声明→拒（≠坏锚，不计停用）；
   * absent 已声明→ok（台账留痕）；invalid→拒并计次，重复出现→停用自动面。
   */
  function anchorGate(): { ok: true; anchor: TrustAnchor | null } | { ok: false; kind: TrustAnchorReject; note: string; detail: string } {
    const seen = inspectTrustAnchor(deps.companyDir)
    if (seen.kind === 'valid') return { ok: true, anchor: seen.anchor }
    if (seen.kind === 'absent') {
      if (deps.anchorAbsence !== undefined) return { ok: true, anchor: null }
      return {
        ok: false,
        kind: 'trust-anchor-absent',
        note: 'RELOAD_TRUST_ANCHOR_ABSENT：锚不在场且装配未显式声明无锚——拒绝自动应用（接收者=制作人；无锚≠坏锚，不按坏锚计停用）',
        detail: '锚不在场：.studio-next/trust.json 不存在，装配未声明无锚（SEC-FC-03）',
      }
    }
    anchorStrikes += 1
    const why = `reason=${seen.error.reason}；${seen.error.message}`
    if (anchorStrikes > 1) {
      autoDisabled = true
      return {
        ok: false,
        kind: 'trust-anchor-disabled',
        note: `RELOAD_TRUST_ANCHOR_DISABLED：坏锚重复出现（第 ${anchorStrikes} 次）——自动热重载已停用，不静默重试；修复锚后手动 reload 或重启（接收者=制作人）；${why}`,
        detail: why,
      }
    }
    return {
      ok: false,
      kind: 'trust-anchor-invalid',
      note: `RELOAD_TRUST_ANCHOR_INVALID：坏锚（不可读/坏 JSON/形状不符）——拒绝自动应用，保持旧配置（接收者=制作人）；${why}`,
      detail: why,
    }
  }

  /**
   * 重装载执行（读 → 校验 → 锚应用门 → 指纹 → 幂等闸 → apply → 落账 → 基线前移）。
   * 校验红/锚门红/trust 漂移走 refuse（ESCALATE，旧态不动）；内容指纹与基线相同＝无变更
   * （基线 stats 刷新、拒载在册复位，零事件）；读/apply 抛错由调用方分类。手动触发带
   * requestId：各结局都回执（auto 段 null 不回执）。
   */
  async function reloadNow(
    trigger: 'auto' | 'manual',
    requestId: string | null,
    diff: StatDiff,
  ): Promise<HotReloadReport> {
    const files = await readFiles(deps.companyDir)
    const mounted = loadCompanyDirectory(files)
    if (!mounted.ok) {
      const detail = renderIssues(mounted.issues)
      const note = `RELOAD_CONFIG_INVALID：公司目录校验不通过，保持旧配置继续跑（trigger=${trigger}）：${detail}`
      return refuse('invalid', 'config-invalid', note, detail, diff, requestId)
    }

    // —— 信任锚应用门（SEC-FC-03 后半）：坏锚/未声明缺失不得进入 apply ——
    const gate = anchorGate()
    if (!gate.ok) return refuse(gate.kind, gate.kind, gate.note, gate.detail, diff, requestId)
    anchorStrikes = 0
    autoDisabled = false
    stats.autoDisabled = false
    const anchor = gate.anchor
    // valid 锚：批准指纹面（docs/43-附录A-3）——trust=false 或内容指纹漂移 → 拒 + 撤销受信位
    if (anchor !== null) {
      const contentFp = fingerprintDirectory(excludeAnchorFiles(files)).overall
      if (!anchor.trust || anchor.fingerprint !== contentFp) {
        const reason = !anchor.trust
          ? '锚 trust=false（import 后未经制作人 approve——变更不可自动应用）'
          : `内容指纹漂移（批准=${(anchor.fingerprint ?? '').slice(0, 19)}… 实测=${contentFp.slice(0, 19)}…）`
        // fail-closed 降级：漂移即撤销受信位（回 untrusted 渲染），等显式 re-approve
        revokeTrust(deps.companyDir, { by: 'daemon/hot-reload', at: new Date(deps.clock()).toISOString(), note: `RELOAD_TRUST_DRIFT（trigger=${trigger}）` })
        const detail = `公司目录${reason}——拒自动应用+受信位已撤销，等待显式 re-approve（docs/43-附录A-3；slug=${anchor.slug}）`
        return refuse('trust-drift', 'trust-drift', `RELOAD_TRUST_DRIFT：${detail}`, detail, diff, requestId)
      }
    }

    const snapshot = mounted.snapshot
    // 指纹面与基线同集（排除锚文件——基线 walk 已排除 .studio-next/，此处同口径，幂等闸才可比）
    const next = fingerprintDirectory(excludeAnchorFiles(files))
    if (next.overall === baselineFingerprint.overall) {
      // 幂等闸：内容未变（stat 变而指纹同）——基线 stats 归位、拒载在册复位，零事件零应用
      baselineStats = scanStats(deps.companyDir)
      lastRejectedStats = null
      pending = null
      deps.log(`[hot-reload] 内容指纹未变（trigger=${trigger}）——无动作（基线 stats 归位；配置原样在跑）`)
      if (requestId !== null) {
        writeReloadResult(deps.rootDir, {
          id: requestId,
          ok: true,
          applied: false,
          reason: 'unchanged',
          detail: `指纹 ${next.overall.slice(0, 19)}… 未变——配置原样在跑（幂等无动作）`,
        })
      }
      return { kind: 'unchanged', changes: renderStatDiff(diff), fingerprint: next.overall, event: null }
    }
    const applyReport = deps.apply(snapshot)
    const oldFp = baselineFingerprint.overall
    // bytes 同指纹口径（排除锚文件——账目 size 与指纹面同集，可对账）
    const bytes = Object.values(excludeAnchorFiles(files)).reduce((s, t) => s + Buffer.byteLength(t, 'utf8'), 0)
    const evt = appendEvent(
      makeEvent(
        'SCHEMA_EVOLVE',
        `RELOAD;trigger=${trigger};company=${snapshot.slug};变更=[${renderStatDiff(diff)}];指纹=${oldFp.slice(0, 19)}→${next.overall.slice(0, 19)};jobs=+${applyReport.jobsSeeded}/-${applyReport.jobsRemoved}(keep ${applyReport.jobsKept})${(applyReport.hr?.enqueued ?? 0) > 0 ? `;HRSYNC;batch=${applyReport.hr?.batchId ?? '-'};${applyReport.hr?.summary ?? ''}（任务+${String(applyReport.hr?.enqueued ?? 0)} 入队——相位尾消化）` : ''};people=${snapshot.people.length};depts=${snapshot.departments.length};anchor=${anchor === null ? `absent-declared:${deps.anchorAbsence?.declaredBy ?? '-'}` : `valid:${anchor.slug}`};零进程重启（docs/38-§2 L1）`,
        Math.min(9, Math.max(1, snapshot.level)),
        snapshot.departments[0]?.path ?? deps.deptFallback,
        bytes,
        next.overall,
      ),
    )
    // 基线前移（成功面；stats 重扫=落账后目录形态）
    baselineStats = scanStats(deps.companyDir)
    baselineFingerprint = next
    lastRejectedStats = null
    pending = null
    stats.reloads += 1
    stats.lastFingerprint = next.overall
    deps.log(
      `[hot-reload] 已重装载（trigger=${trigger}）：指纹 ${oldFp.slice(0, 19)}…→${next.overall.slice(0, 19)}…；变更 ${diff.added.length + diff.removed.length + diff.modified.length} 项；jobs +${applyReport.jobsSeeded}/-${applyReport.jobsRemoved}；台账 SCHEMA_EVOLVE ${evt.id}`,
    )
    if (requestId !== null) {
      writeReloadResult(deps.rootDir, {
        id: requestId,
        ok: true,
        applied: true,
        detail: `指纹→${next.overall.slice(0, 19)}…；jobs +${applyReport.jobsSeeded}/-${applyReport.jobsRemoved}；people=${snapshot.people.length}`,
      })
    }
    return { kind: 'reloaded', changes: renderStatDiff(diff), fingerprint: next.overall, event: evt }
  }

  async function check(): Promise<HotReloadReport | null> {
    stats.checks += 1

    // —— 控制面请求（手动触发；id 前进才处理——同 id 幂等） ——
    const request = readReloadRequest(deps.rootDir)
    if (request !== undefined && request.id !== lastRequestId) {
      lastRequestId = request.id
      stats.manualRequests += 1
      if (request.company !== null && request.company !== deps.company) {
        writeReloadResult(deps.rootDir, {
          id: request.id,
          ok: false,
          applied: false,
          reason: 'company-mismatch',
          detail: `请求 company=${request.company}，本 daemon company=${deps.company}——错家探活，不重装载`,
        })
        deps.log(`[hot-reload] 手动 reload（${request.id}）company 不符（${request.company}≠${deps.company}）——已回执拒绝`)
        return { kind: 'company-mismatch', changes: '', event: null, detail: `company=${request.company}` }
      }
      try {
        // 手动触发恒重读（幂等闸在 reloadNow：内容未变回执 unchanged 不落事件）
        const diff = diffStatIndex(baselineStats, scanStats(deps.companyDir))
        return await reloadNow('manual', request.id, diff)
      } catch (err) {
        // 手动面失败：回执 + ESCALATE（手动触发一请求一回执一事件，不适用防刷屏）
        const msg = err instanceof Error ? err.message : String(err)
        writeReloadResult(deps.rootDir, { id: request.id, ok: false, applied: false, reason: 'apply-failed', detail: msg })
        const evt = appendEvent(
          makeEvent('ESCALATE', `RELOAD_APPLY_FAILED：重装载应用失败，保持旧配置继续跑（trigger=manual）：${msg}`, 1, deps.deptFallback),
        )
        stats.invalids += 1
        lastRejectedStats = scanStats(deps.companyDir)
        pending = null
        deps.log(`[hot-reload] 手动 reload（${request.id}）应用失败（保持旧态）：${msg}——ESCALATE ${evt.id}`)
        return { kind: 'apply-failed', changes: '', event: evt, detail: msg }
      }
    }

    // —— 自动指纹监听（reloadWatch: true；缺省开） ——
    if (!deps.watch || autoDisabled) return null
    const next = scanStats(deps.companyDir)
    // 防刷屏：拒载在册时比对 lastRejectedStats——stat 未再变不重试不重报
    const compareBase = lastRejectedStats ?? baselineStats
    const diff = diffStatIndex(compareBase, next)
    if (statDiffEmpty(diff)) {
      pending = null
      return null
    }
    if (lastRejectedStats !== null) lastRejectedStats = null // stat 再变=新形态：重置拒载在册（修复重试路径）
    const now = deps.clock()
    const stillChanging = pending !== null && !statDiffEmpty(diffStatIndex(pending.stats, next))
    if (pending === null || stillChanging) {
      pending = { stats: next, since: now } // 首见/仍在变：记 pending 等稳定
      return null
    }
    if (now - pending.since < minStableMs) return null // 稳定窗未满
    try {
      return await reloadNow('auto', null, diff)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const evt = appendEvent(
        makeEvent('ESCALATE', `RELOAD_APPLY_FAILED：重装载应用失败，保持旧配置继续跑（trigger=auto）：${msg}`, 1, deps.deptFallback),
      )
      stats.invalids += 1
      lastRejectedStats = next
      pending = null
      deps.log(`[hot-reload] 自动重装载应用失败（保持旧态）：${msg}——ESCALATE ${evt.id}`)
      return { kind: 'apply-failed', changes: renderStatDiff(diff), event: evt, detail: msg }
    }
  }

  return {
    check,
    get stats(): HotReload['stats'] {
      return { ...stats }
    },
  }
}
