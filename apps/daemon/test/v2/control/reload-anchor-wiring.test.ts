/**
 * reload-anchor-wiring.test.ts —— serve 装配「显式声明无锚」接线 + reports/ 产出排除（studio-dev-508）
 *
 * 依据：
 *   - docs/44-§2.3 条款4：「init 通道目录无锚＝闸不适用（存量行为不变）」——本单把该存量行为
 *     显式化：装配在 daemon.yaml 两键声明无锚（reloadAnchorAbsenceDeclaredBy/Reason）才放行；
 *   - docs/v2/15 §一 SEC-FC-03：「无锚」只允许出现在显式声明无锚的装配并记台账；坏锚仍
 *     fail-closed（负向行 N-d：坏锚自动应用必须被拒）；
 *   - docs/38-§2 L1（配置级热重载边界）/ docs/17-§6（收割产物面）。
 *
 * 断言口径（本单冻结验收 2/3/4 的机检等价面）：
 *   1. 装配声明接线：serve runtime 收到两键→自动重载应用 RELOAD，台账 note 含
 *      `anchor=absent-declared:<declaredBy>`（declaredBy/reason 可见）；
 *   2. 缺键＝未声明→同一变更被拒（trust-anchor-absent + ESCALATE，零 apply）——fail-closed 保持；
 *   3. `company/reports/` 写入不再触发热载检查（无 ABSENT/无 RELOAD）；
 *   4. reports/ 不进批准指纹：批准后仅写 reports → 手动 reload 幂等 unchanged（不转 TRUST_DRIFT）；
 *   5. 坏锚 + 声明：构造即拒启（声明不是放行开关）；合法锚 + 声明：锚优先（漂移仍拒）。
 *
 * 夹具：模板直接落盘（不经 initCompany 的 git 首提——本测试不依赖 git，沙箱/CI 同绿）。
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  REPORTS_DIR,
  TRUST_DIR,
  approveCompanyDirectory,
  contentFingerprint,
  excludeNonContentFiles,
  inspectTrustAnchor,
  loadCompanyDirectory,
  readDirectoryFiles,
  seedTrustAnchor,
} from '@studio-next/company'
import type { CompanySnapshot } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { DEFAULT_SERVE_CONFIG, buildServeRuntime, parseDaemonConfig, type ServeConfig } from '../../../src/assembly/serve.ts'
import { createHotReload, writeReloadRequest, type HotReload } from '../../../src/control/hot-reload.ts'

const TEMPLATE = fileURLToPath(new URL('../../../../../templates/company-2-level', import.meta.url))
const T0 = Date.parse('2026-11-03T00:00:00.000Z')
const DEPT = 'departments/工程部'

let root = ''
const ledgers: Ledger[] = []
/** 网关签根（SEC-FC-02：有公司目录＝必须由部署秘密源注入；测试进程内注入，值非真实凭据） */
const prevGatewaySecret = process.env.STUDIO_GATEWAY_SECRET

beforeAll(() => {
  process.env.STUDIO_GATEWAY_SECRET = 'test-gateway-secret-studio-dev-508'
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-reload-anchor-wiring-'))
})

afterAll(() => {
  for (const ledger of ledgers) {
    try {
      ledger.close()
    } catch {
      // runtime.stop() 已关（重复 close 非失败面）
    }
  }
  rmSync(root, { recursive: true, force: true })
  if (prevGatewaySecret === undefined) delete process.env.STUDIO_GATEWAY_SECRET
  else process.env.STUDIO_GATEWAY_SECRET = prevGatewaySecret
})

/** 模板 → 公司目录（init 通道同形：占位替换；不跑 git 首提——本测试不依赖 git） */
function makeCompany(slug: string): string {
  const dir = path.join(root, slug)
  cpSync(TEMPLATE, dir, { recursive: true })
  const orgPath = path.join(dir, 'org-config.yaml')
  const org = readFileSync(orgPath, 'utf8')
    .replace('slug: example-corp', `slug: ${slug}`)
    .replace('name: 示例公司', `name: ${slug}`)
    // SEC-WD-02 绑定：模板未声明 platform（装载缺省 youtrack）——本套用 fake 平台，显式绑定
    .replace('  mission:', '  platform: fake # 测试绑定（SEC-WD-02）\n  mission:')
  writeFileSync(orgPath, org, 'utf8')
  const metaPath = path.join(dir, '.studio-next.yaml')
  const meta = readFileSync(metaPath, 'utf8').replace('created_at: null', `created_at: ${new Date(T0).toISOString()}`)
  writeFileSync(metaPath, meta, 'utf8')
  return dir
}

async function snapshotOf(dir: string): Promise<CompanySnapshot> {
  const mounted = loadCompanyDirectory(await readDirectoryFiles(dir))
  if (!mounted.ok) throw new Error(`夹具破坏：公司目录非法 ${mounted.issues.map((i) => `${i.file}:${i.line}`).join('；')}`)
  return mounted.snapshot
}

/** 最小 serve 配置（fake 平台；api 只装配不监听——buildServeRuntime 不 await start） */
function serveConfig(id: string, companyDir: string, over?: Partial<ServeConfig>): ServeConfig {
  return {
    ...DEFAULT_SERVE_CONFIG, // 必填面单一源（tsconfig.v2 全严格：不手抄缺省）
    db: path.join(root, `${id}.sqlite`),
    platform: 'fake',
    company: path.basename(companyDir),
    rootDir: path.join(root, 'roots', id), // 控制面/工作根与公司目录分离（control/ 不得落公司目录内）
    aiwsRoot: path.join(root, 'roots', id, '.AIWS'), // per-company 不并树（docs/43-§十9）：每例独立根
    tickMs: 10,
    stallKillAfterAlarms: 0,
    autoApprove: false,
    jobs: false,
    jobPollMs: 15_000,
    matrix: false,
    fileWatch: false,
    cadence: false,
    sla: false,
    reloadWatch: true,
    companyDir,
    ...over,
  }
}

function openTestLedger(id: string): Ledger {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  ledgers.push(ledger)
  return ledger
}

/** 可推进时钟（稳定窗 minStableMs=500 需两拍间隔≥窗——缺省 serve 不注入 minStableMs） */
function makeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = T0
  return { now: (): number => t, advance: (ms: number): void => { t += ms } }
}

/** serve 工作根（控制面 control/ 落此，与公司目录分离） */
function serveRoot(id: string): string {
  return path.join(root, 'roots', id)
}

/** 改配置面 + 显式推 mtime（stat 变更确定触发） */
let bumpSeq = 0
function bumpOrgConfig(dir: string): void {
  bumpSeq += 1
  const target = path.join(dir, 'org-config.yaml')
  writeFileSync(target, `${readFileSync(target, 'utf8')}\n# reload-anchor-wiring 变更 ${bumpSeq}\n`, 'utf8')
  const at = new Date(T0 + bumpSeq * 10_000)
  utimesSync(target, at, at)
}

/** 写产出落点（reports/）——按 17-§6 报表文件名约定 */
function writeReport(dir: string, name: string): void {
  bumpSeq += 1
  const target = path.join(dir, REPORTS_DIR, '工程部', name)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, '# 报表（产出面，不是配置资产）\n', 'utf8')
  const at = new Date(T0 + bumpSeq * 10_000)
  utimesSync(target, at, at)
}

function reloadEvents(ledger: Ledger, prefix = 'RELOAD;') {
  return ledger.queryEvents().filter((e) => e.event === 'SCHEMA_EVOLVE' && (e.note ?? '').startsWith(prefix))
}

function escalates(ledger: Ledger, prefix: string) {
  return ledger.queryEvents().filter((e) => e.event === 'ESCALATE' && (e.note ?? '').startsWith(prefix))
}

describe('daemon.yaml 两键解析：显式声明无锚（SEC-FC-03 / docs/44-§2.3-4）', () => {
  it('成对键→声明对象（declaredBy/reason 可见）；缺省不写＝未声明', () => {
    const text = [
      'db: ./x.sqlite',
      'companyDir: ./my-corp',
      'reloadAnchorAbsenceDeclaredBy: init-channel:company-2-level',
      'reloadAnchorAbsenceReason: init 模板目录不落锚',
      '',
    ].join('\n')
    const cfg = parseDaemonConfig(text)
    expect(cfg.reloadAnchorAbsence).toEqual({ declaredBy: 'init-channel:company-2-level', reason: 'init 模板目录不落锚' })
    expect(parseDaemonConfig('db: ./x.sqlite\ncompanyDir: ./my-corp\n').reloadAnchorAbsence).toBeUndefined()
  })

  it('只给 reason 不给 declaredBy＝CONFIG_INVALID（只给理由≠声明，不得静默放行）', () => {
    expect(() => parseDaemonConfig('db: ./x.sqlite\ncompanyDir: ./my-corp\nreloadAnchorAbsenceReason: 因为无锚\n')).toThrow(
      /reloadAnchorAbsenceReason 必须与 reloadAnchorAbsenceDeclaredBy 同时出现/,
    )
  })

  it('无 companyDir 却声明＝CONFIG_INVALID（热重载不装配，声明无消费面）', () => {
    expect(() => parseDaemonConfig('db: ./x.sqlite\nreloadAnchorAbsenceDeclaredBy: init-channel\n')).toThrow(
      /只在 companyDir 给定时生效/,
    )
  })

  it('空白 declaredBy 视为未声明（reason 在场即拒——trim 后空=无声明）', () => {
    expect(() => parseDaemonConfig('db: ./x.sqlite\ncompanyDir: ./my-corp\nreloadAnchorAbsenceDeclaredBy: "  "\nreloadAnchorAbsenceReason: r\n')).toThrow(
      /必须与 reloadAnchorAbsenceDeclaredBy 同时出现/,
    )
  })
})

describe('serve 装配接线：声明无锚→RELOAD_APPLIED；缺键→拒载（红/绿对照）', () => {
  it('绿：声明在场→自动重载应用，台账 note 含 anchor=absent-declared:<declaredBy>', async () => {
    const dir = makeCompany('wiring-green')
    const ledger = openTestLedger('wiring-green')
    const logs: string[] = []
    const clock = makeClock()
    const runtime = buildServeRuntime(
      serveConfig('wiring-green', dir, { reloadAnchorAbsence: { declaredBy: 'init-channel:company-2-level', reason: 'init 通道不落锚' } }),
      ledger,
      await snapshotOf(dir),
      { log: (l) => logs.push(l), clock: clock.now },
    )
    try {
      const hot = runtime.hotReload as HotReload
      expect(hot).toBeDefined()
      expect(logs.some((l) => l.includes('装配已显式声明无锚（init-channel:company-2-level）'))).toBe(true)
      expect(inspectTrustAnchor(dir).kind).toBe('absent') // 前置：init 通道目录确实无锚
      expect(await hot.check()).toBeNull() // 基线=当前盘面
      bumpOrgConfig(dir)
      expect(await hot.check()).toBeNull() // 首见 pending（稳定窗）
      clock.advance(1000)
      const report = await hot.check()
      expect(report?.kind).toBe('reloaded')
      const evt = reloadEvents(ledger)[0]
      expect(evt?.note).toContain('anchor=absent-declared:init-channel:company-2-level')
      expect(evt?.note).toContain('~org-config.yaml')
      expect(escalates(ledger, 'RELOAD_TRUST_ANCHOR_ABSENT')).toHaveLength(0)
    } finally {
      await runtime.stop()
    }
  })

  it('红（fail-closed 保持）：缺声明键→同一变更拒载 ESCALATE，零 apply', async () => {
    const dir = makeCompany('wiring-red')
    const ledger = openTestLedger('wiring-red')
    const clock = makeClock()
    const runtime = buildServeRuntime(serveConfig('wiring-red', dir), ledger, await snapshotOf(dir), {
      log: (): void => undefined,
      clock: clock.now,
    })
    try {
      const hot = runtime.hotReload as HotReload
      expect(hot).toBeDefined()
      expect(await hot.check()).toBeNull()
      bumpOrgConfig(dir)
      expect(await hot.check()).toBeNull()
      clock.advance(1000)
      const report = await hot.check()
      expect(report?.kind).toBe('trust-anchor-absent')
      expect(reloadEvents(ledger)).toHaveLength(0) // 零应用
      const absent = escalates(ledger, 'RELOAD_TRUST_ANCHOR_ABSENT')
      expect(absent).toHaveLength(1)
      expect(absent[0]?.note).toContain('接收者=制作人')
    } finally {
      await runtime.stop()
    }
  })
})

describe('reports/ 产出排除（本单冻结验收 3；17-§6 产出面）', () => {
  it('绿：reports/ 写入不触发热载检查（无 ABSENT、无 RELOAD、零 pending）', async () => {
    const dir = makeCompany('reports-noise')
    const ledger = openTestLedger('reports-noise')
    const runtime = buildServeRuntime(
      serveConfig('reports-noise', dir, { reloadAnchorAbsence: { declaredBy: 'init-channel:test' } }),
      ledger,
      await snapshotOf(dir),
      { log: (): void => undefined, clock: () => T0 },
    )
    try {
      const hot = runtime.hotReload as HotReload
      writeReport(dir, '2026-11-03-report-工程部-studio-dev-508.md')
      // 产出落盘后连续三拍：零 pending、零事件（stat 面排除 reports/）
      expect(await hot.check()).toBeNull()
      expect(await hot.check()).toBeNull()
      expect(await hot.check()).toBeNull()
      expect(reloadEvents(ledger)).toHaveLength(0)
      expect(escalates(ledger, 'RELOAD_TRUST_ANCHOR_ABSENT')).toHaveLength(0)
      expect(hot.stats.anchorRejects).toBe(0)
    } finally {
      await runtime.stop()
    }
  })

  it('reports/ 不进批准指纹：批准后仅写 reports→手动 reload 幂等 unchanged（不转 TRUST_DRIFT）', async () => {
    const dir = makeCompany('reports-fingerprint')
    const slug = path.basename(dir)
    const files = await readDirectoryFiles(dir)
    seedTrustAnchor(dir, slug, files, { by: 'daemon/git-import', at: new Date(T0).toISOString(), note: '测试落锚' })
    const approved = approveCompanyDirectory(dir, files, { by: '制作人-甲', at: new Date(T0 + 1000).toISOString(), note: '测试批准' })
    // 指纹口径=内容面（锚 + reports/ 均排除）——直证批准指纹与产出无关
    expect(approved.fingerprint).toBe(contentFingerprint(excludeNonContentFiles(files)))
    expect(approved.fingerprint).not.toBe(contentFingerprint(files))

    const ledger = openTestLedger('reports-fingerprint')
    const runtime = buildServeRuntime(serveConfig('reports-fingerprint', dir), ledger, await snapshotOf(dir), {
      log: (): void => undefined,
      clock: () => T0,
    })
    try {
      const hot = runtime.hotReload as HotReload
      writeReport(dir, '2026-11-03-report-工程部-指纹排除.md')
      writeReloadRequest(serveRoot('reports-fingerprint'), { id: 'rf-1', company: slug, requestedAt: T0 + 2000 })
      const report = await hot.check()
      expect(report?.kind).toBe('unchanged') // 产出写入不改内容指纹→幂等闸；若含 reports 则会是 trust-drift
      expect(escalates(ledger, 'RELOAD_TRUST_DRIFT')).toHaveLength(0)
      expect(reloadEvents(ledger)).toHaveLength(0)
    } finally {
      await runtime.stop()
    }
  })
})

describe('安全面：声明不是放行开关（坏锚/合法锚优先）', () => {
  it('坏锚 + 声明：构造即拒启 CONFIG_INVALID（不得为降噪放宽）', async () => {
    const dir = makeCompany('bad-anchor')
    mkdirSync(path.join(dir, TRUST_DIR), { recursive: true })
    writeFileSync(path.join(dir, TRUST_DIR, 'trust.json'), '{"schema": "studio-next/trust@1",', 'utf8')
    const ledger = openTestLedger('bad-anchor')
    expect(() =>
      createHotReload({
        companyDir: dir,
        rootDir: path.join(root, 'bad-anchor-root'),
        ledger,
        company: 'bad-anchor',
        clock: () => T0,
        makeId: (ts: number): string => `0${String(ts).padStart(25, '0')}`,
        log: (): void => undefined,
        deptFallback: DEPT,
        watch: false,
        anchorAbsence: { declaredBy: 'init-channel:test' },
        apply: () => ({ jobsSeeded: 0, jobsKept: 0, jobsRemoved: 0 }),
      }),
    ).toThrow(/CONFIG_INVALID：信任锚坏锚，拒绝启动/)
  })

  it('合法锚 + 声明：锚优先——批准后配置变更仍拒（TRUST_DRIFT），声明不越过批准指纹', async () => {
    const dir = makeCompany('valid-anchor')
    const slug = path.basename(dir)
    const files = await readDirectoryFiles(dir)
    seedTrustAnchor(dir, slug, files, { by: 'daemon/git-import', at: new Date(T0).toISOString() })
    approveCompanyDirectory(dir, files, { by: '制作人-甲', at: new Date(T0 + 1000).toISOString() })

    const ledger = openTestLedger('valid-anchor')
    const clock = makeClock()
    const runtime = buildServeRuntime(
      serveConfig('valid-anchor', dir, { reloadAnchorAbsence: { declaredBy: 'init-channel:test' } }),
      ledger,
      await snapshotOf(dir),
      { log: (): void => undefined, clock: clock.now },
    )
    try {
      const hot = runtime.hotReload as HotReload
      bumpOrgConfig(dir)
      expect(await hot.check()).toBeNull()
      clock.advance(1000)
      const report = await hot.check()
      expect(report?.kind).toBe('trust-drift')
      expect(reloadEvents(ledger)).toHaveLength(0)
      expect(escalates(ledger, 'RELOAD_TRUST_DRIFT')).toHaveLength(1)
      expect(inspectTrustAnchor(dir).kind).toBe('valid')
      // fail-closed 降级：漂移即撤销受信位（trust=false 回 untrusted）
      const anchor = inspectTrustAnchor(dir)
      expect(anchor.kind === 'valid' && anchor.anchor.trust).toBe(false)
    } finally {
      await runtime.stop()
    }
  })
})
