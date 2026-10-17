/**
 * v0.10 进化管线·v5 测试（store candidates 表）：迁移（建库即 v5 / 三索引 / v4→v5 升级路径）、
 * insertCandidate 幂等登记（同键非终态命中 / 终态放行新建=换代重提 / 形状闸 / 谱系闸（自引用·
 * 父未知·既有环）/ id 冲突分类 / verification JSON 快照往返与不可序列化拒）、
 * updateVerification 行中写面（sandboxed 写入往返+重复写后值胜 / 窗口语义 sandboxed 外全拒 /
 * 无此行=false 如实 / 序列化与 insert 同源（同证据两写面落列字节一致）/ 不可序列化拒且原值不动 /
 * null 归一清回 / 落证据后 sandboxed→gated 接力）、lineageOf 谱系链
 * （三代取回新→旧 / 断链与环 fail-closed 不死循环 / 无此行 undefined / insert 环检断链容忍）、
 * candidatesByStatus 状态集查询（排序 / 空数组与枚举外拒）、transitionCandidate 乐观锁（合法
 * 迁移落库 / 同连接两次同参恰一次成功 / 双连接竞态恰一次成功 / 过期 from 与无此行如实 false）、
 * core↔store 一致性（值域 deep-equal 漂移即红——沿 STUDIO_TOOLS↔GATEWAY_ACTIONS 先例；
 * 键集 type 级钉；core 纯函数产物直落库往返 + core 迁移函数与 store 乐观锁接力）。
 *
 * 环境：os.tmpdir() 真文件库（沿 v4-debts.test.ts 风格，不用 :memory:）。功能面各套独立库
 * （语料隔离）；环/断链语料经裸 SQL 注入（模拟库侧数据损坏——candidates 无触发器防护，
 * 损坏防御面在读写面 fail-closed）。
 * 依据：docs/17-§3（candidates 列集）、02-F3-01/02/03（统一入口/四元组+谱系/三态闸门）、
 * core evolution.ts（形状与语义之源，「store 建表时以此为准」——头注原文）。
 * core 引入：devDependency 测试专用（store src 零 core 依赖；panel↔company 同先例）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ASSET_KINDS as CORE_ASSET_KINDS,
  AUTHORIZING_STATUSES as CORE_AUTHORIZING_STATUSES,
  BLAST_RADII as CORE_BLAST_RADII,
  CANDIDATE_STATUSES as CORE_CANDIDATE_STATUSES,
  TERMINAL_STATUSES as CORE_TERMINAL_STATUSES,
  lineage as coreLineage,
  proposeCandidate as corePropose,
  transitionCandidate as coreTransition,
} from '@studio-next/core'
import type { CandidateRecord as CoreCandidateRecord } from '@studio-next/core'
import {
  CANDIDATE_ASSET_KINDS,
  CANDIDATE_BLAST_RADII,
  CANDIDATE_STATUS_VALUES,
  CandidateRowSchema,
  TERMINAL_CANDIDATE_STATUS_VALUES,
  migrate,
  openLedger,
  openSqlite,
  type CandidateRow,
  type CandidateStatus,
  type Ledger,
} from '../src/index.ts'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-store-v5-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 断言抛出 ClassifiedError 形状且 category=CONFIG_INVALID、subcause 匹配；可附带 message 子串 */
function expectConfigInvalid(fn: () => unknown, subcausePrefix: string, messageContains?: string): void {
  let caught: unknown
  try {
    fn()
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(Error)
  const err = caught as Error & { category?: string; subcause?: string }
  expect(err.category).toBe('CONFIG_INVALID')
  expect(err.subcause).toMatch(new RegExp(`^${subcausePrefix.replaceAll('/', '\\/')}`))
  if (messageContains !== undefined) expect(err.message).toContain(messageContains)
}

const T0 = 1770000000000

/** 候选工厂：默认最小 draft（初代、无快照）；patch 覆盖任意列 */
function makeCandidate(patch: Record<string, unknown> = {}): CandidateRow {
  return {
    id: `c-${String(makeCandidateSeq++)}`,
    asset_type: 'prompt',
    asset_path: 'prompts/a.md',
    version: 'v1',
    diff_hash: 'h-1',
    blast_radius: 'isolated',
    verification: null,
    parent_id: null,
    status: 'draft',
    created_at: T0 + 100,
    ...patch,
  } as CandidateRow
}
let makeCandidateSeq = 1

describe('v5 迁移（candidates 表）', () => {
  let ledger: Ledger

  beforeAll(() => {
    ledger = openLedger(path.join(root, 'ledger.db'))
  })

  afterAll(() => {
    ledger.close()
  })

  it('建库即到 v5：candidates 表在库、schema_version 恰五行；重开库 migrate 幂等（version 不涨、v5 不重放）', () => {
    expect(ledger.version()).toBe(5)
    const tables = (
      ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: unknown }>
    ).map((r) => String(r.name))
    expect(tables).toContain('candidates')
    const rows = ledger.db.prepare('SELECT version, sha8 FROM schema_version ORDER BY version').all() as Array<{ version: unknown; sha8: unknown }>
    expect(rows.length).toBe(5)
    for (const row of rows) expect(String(row.sha8)).toMatch(/^[0-9a-f]{8}$/)

    const again = openLedger(path.join(root, 'ledger.db'))
    expect(again.version()).toBe(5)
    const count = again.db.prepare('SELECT COUNT(*) AS c FROM schema_version').get() as { c?: unknown }
    expect(Number(count.c)).toBe(5)
    again.close()
  })

  it('三索引在库（三查询面）：(asset_path,diff_hash) 幂等查 / (parent_id) 谱系查 / (status) 判负查 active 集', () => {
    const indexes = (
      ledger.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_candidates%' ORDER BY name").all() as Array<{ name: unknown }>
    ).map((r) => String(r.name))
    expect(indexes).toEqual([
      'idx_candidates_asset_path_diff_hash',
      'idx_candidates_parent_id',
      'idx_candidates_status',
    ])
    // 列形态快照（形状取舍的直证：asset_type / version TEXT / asset_path / verification / parent_id 可空）
    const sql = String(
      (ledger.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='candidates'").get() as { sql?: unknown }).sql,
    )
    expect(sql).toContain('asset_type TEXT NOT NULL')
    expect(sql).toContain('asset_path TEXT NOT NULL')
    expect(sql).toContain('version TEXT NOT NULL')
    expect(sql).toContain('verification TEXT')
    expect(sql).toContain('parent_id TEXT')
  })

  it('v4→v5 升级路径：v4 存量库裸数据无损、candidates 表补齐可用（v4 时代无此表）', () => {
    // ① 构造 v4 库（migrate upTo=4）+ 裸数据；v4 时代无 candidates 表
    const p = path.join(root, 'upgrade-v4.db')
    const v4db = openSqlite(p)
    migrate(v4db, { upTo: 4 })
    const noTable = v4db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='candidates'").get() as { c?: unknown }
    expect(Number(noTable.c)).toBe(0)
    v4db
      .prepare('INSERT INTO events (id, ts, company, issue, event, actor, attempt, level, dept, tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('01ARZ3NDEKTSV4RRFFQ69G5FAV', T0, 'demo', 'STUDIO-9', 'DISPATCH', 'AGENT-9:agent-9', 1, 3, 'departments/工程部', '{"input":100,"output":50}')
    v4db.close()

    // ② 重开（openLedger 全量迁移）→ v5：存量无损、candidates 面可用
    const upgraded = openLedger(p)
    expect(upgraded.version()).toBe(5)
    expect(upgraded.queryEvents().map((e) => e.id)).toEqual(['01ARZ3NDEKTSV4RRFFQ69G5FAV'])
    expect(upgraded.getCandidate('c-up')).toBeUndefined()
    expect(upgraded.insertCandidate(makeCandidate({ id: 'c-up', asset_path: 'prompts/upgrade.md', diff_hash: 'h-up' }))).toEqual({ id: 'c-up', inserted: true })
    expect(upgraded.getCandidate('c-up')?.status).toBe('draft')
    upgraded.close()
  })
})

describe('insertCandidate（幂等登记 + 谱系闸）——独立库', () => {
  let ins: Ledger

  beforeAll(() => {
    ins = openLedger(path.join(root, 'insert.db'))
  })

  afterAll(() => {
    ins.close()
  })

  it('draft 登记往返全字段：回读 deep-equal（verification null / parent_id null=初代 / created_at 落列）', () => {
    const row = makeCandidate({
      id: 'c-full', asset_type: 'criterion', asset_path: 'criteria/acceptance.yaml',
      version: 'v0.3.1', diff_hash: 'sha256:ab12', blast_radius: 'framework',
      created_at: T0 + 500,
    })
    expect(ins.insertCandidate(row)).toEqual({ id: 'c-full', inserted: true })
    expect(ins.getCandidate('c-full')).toEqual(row)
  })

  it('幂等命中：同 (asset_path,diff_hash) 非终态（draft/proposed/approved 各键）→ 返回既有 id 不新建，输入 id 被忽略', () => {
    const rowsOf = (assetPath: string): number =>
      Number((ins.db.prepare('SELECT COUNT(*) AS c FROM candidates WHERE asset_path = ?').get(assetPath) as { c?: unknown }).c)
    // 三条非终态候选（不同资产），各自同键再登记（换 id）均命中既有 id
    for (const [i, status] of ['draft', 'proposed', 'approved'].entries()) {
      const key = `prompts/idem-${String(i)}.md`
      const first = makeCandidate({ id: `c-idem-${String(i)}`, asset_path: key, diff_hash: `h-idem-${String(i)}`, status, created_at: T0 + 1000 + i })
      expect(ins.insertCandidate(first)).toEqual({ id: first.id, inserted: true })
      const hit = ins.insertCandidate(makeCandidate({ id: 'c-ignored-id', asset_path: key, diff_hash: `h-idem-${String(i)}` }))
      expect(hit).toEqual({ id: first.id, inserted: false })
      expect(rowsOf(key)).toBe(1)
    }
    // escalated 非终态同理命中（人裁位仍占键）
    const esc = makeCandidate({ id: 'c-esc', asset_path: 'prompts/esc.md', diff_hash: 'h-esc', status: 'escalated' })
    ins.insertCandidate(esc)
    expect(ins.insertCandidate(makeCandidate({ id: 'c-esc-2', asset_path: 'prompts/esc.md', diff_hash: 'h-esc' }))).toEqual({ id: 'c-esc', inserted: false })
    // 异键不误伤：同资产不同内容 = 新谱系
    expect(ins.insertCandidate(makeCandidate({ id: 'c-esc-b', asset_path: 'prompts/esc.md', diff_hash: 'h-esc-b' }))).toEqual({ id: 'c-esc-b', inserted: true })
  })

  it('终态放行新建=换代重提：rejected / retired 同键 → 新行（新 id），两代并存可查', () => {
    const rejected = makeCandidate({ id: 'c-rej', asset_path: 'prompts/gen.md', diff_hash: 'h-gen', status: 'rejected', created_at: T0 + 2000 })
    expect(ins.insertCandidate(rejected).inserted).toBe(true)
    const gen2 = makeCandidate({ id: 'c-gen2', asset_path: 'prompts/gen.md', diff_hash: 'h-gen', parent_id: 'c-rej', created_at: T0 + 2100 })
    expect(ins.insertCandidate(gen2)).toEqual({ id: 'c-gen2', inserted: true }) // 终态键放行（fork 新子代）
    const retired = makeCandidate({ id: 'c-ret', asset_path: 'prompts/ret.md', diff_hash: 'h-ret', status: 'retired', created_at: T0 + 2200 })
    ins.insertCandidate(retired)
    expect(ins.insertCandidate(makeCandidate({ id: 'c-ret2', asset_path: 'prompts/ret.md', diff_hash: 'h-ret', created_at: T0 + 2300 }))).toEqual({ id: 'c-ret2', inserted: true })
    // 两代并存：同键两行，终态与在途各一
    const gens = ins.db.prepare('SELECT id FROM candidates WHERE asset_path = ? ORDER BY created_at').all('prompts/gen.md') as Array<{ id: unknown }>
    expect(gens.map((r) => String(r.id))).toEqual(['c-rej', 'c-gen2'])
  })

  it('形状闸（zod strict）：空串列 / 枚举外值 / 负 created_at / 未知列 → CONFIG_INVALID，不入库', () => {
    const before = countAll(ins)
    expectConfigInvalid(() => ins.insertCandidate(makeCandidate({ id: '' })), 'store/candidates:invalid:id')
    expectConfigInvalid(() => ins.insertCandidate(makeCandidate({ asset_path: '' })), 'store/candidates:invalid:asset_path')
    expectConfigInvalid(() => ins.insertCandidate(makeCandidate({ version: '' })), 'store/candidates:invalid:version')
    expectConfigInvalid(() => ins.insertCandidate(makeCandidate({ diff_hash: '' })), 'store/candidates:invalid:diff_hash')
    expectConfigInvalid(() => ins.insertCandidate(makeCandidate({ asset_type: 'no-such-kind' })), 'store/candidates:invalid:asset_type')
    expectConfigInvalid(() => ins.insertCandidate(makeCandidate({ blast_radius: 'galaxy' })), 'store/candidates:invalid:blast_radius')
    expectConfigInvalid(() => ins.insertCandidate(makeCandidate({ status: 'zombie' })), 'store/candidates:invalid:status')
    expectConfigInvalid(() => ins.insertCandidate(makeCandidate({ created_at: -1 })), 'store/candidates:invalid:created_at')
    expectConfigInvalid(() => ins.insertCandidate(makeCandidate({ bogus: 1 })), 'store/candidates:invalid:', 'bogus')
    expect(countAll(ins)).toBe(before)
  })

  it('谱系闸：自引用 / 父不在库 / 挂接遇既有环 → CONFIG_INVALID；父在库且不成环放行', () => {
    ins.insertCandidate(makeCandidate({ id: 'c-root', asset_path: 'prompts/root.md', diff_hash: 'h-root' }))
    ins.insertCandidate(makeCandidate({ id: 'c-kid', asset_path: 'prompts/kid.md', diff_hash: 'h-kid', parent_id: 'c-root' }))
    // 自引用
    expectConfigInvalid(() => ins.insertCandidate(makeCandidate({ id: 'c-self', asset_path: 'prompts/self.md', diff_hash: 'h-self', parent_id: 'c-self' })), 'store/candidates:self-parent', 'c-self')
    // 父未知（F3-02 谱系可反追）
    expectConfigInvalid(() => ins.insertCandidate(makeCandidate({ id: 'c-orphan', asset_path: 'prompts/orphan.md', diff_hash: 'h-orphan', parent_id: 'c-ghost' })), 'store/candidates:parent-unknown', 'c-ghost')
    // 既有环（裸 SQL 注入坏数据：a→b→a）——挂接其下如实拒，不静默入库悬挂链
    insertRaw(ins, { id: 'c-a', parent_id: 'c-b' })
    insertRaw(ins, { id: 'c-b', parent_id: 'c-a' })
    expectConfigInvalid(() => ins.insertCandidate(makeCandidate({ id: 'c-under-cycle', asset_path: 'prompts/uc.md', diff_hash: 'h-uc', parent_id: 'c-a' })), 'store/candidates:lineage-cycle')
    // 正常挂接放行（三代链成）
    expect(ins.insertCandidate(makeCandidate({ id: 'c-grandkid', asset_path: 'prompts/gk.md', diff_hash: 'h-gk', parent_id: 'c-kid', created_at: T0 + 3000 })).inserted).toBe(true)
  })

  it('id 冲突分类：同 id 全列一致 → 幂等跳过；同 id 内容不一致（异键绕开幂等闸）→ CONFIG_INVALID（PK 裸错前置分类）', () => {
    const row = makeCandidate({ id: 'c-dup', asset_path: 'prompts/dup.md', diff_hash: 'h-dup', created_at: T0 + 3100 })
    expect(ins.insertCandidate(row).inserted).toBe(true)
    expect(ins.insertCandidate(makeCandidate({ ...row, verification: undefined } as unknown as CandidateRow))).toEqual({ id: 'c-dup', inserted: false }) // undefined≡null 归一后全列一致
    // 同 id 异键：键闸不命中（diff_hash 不同），id 闸分类拒——若不前置分类即 PK 裸 UNIQUE 错
    expectConfigInvalid(() => ins.insertCandidate(makeCandidate({ id: 'c-dup', asset_path: 'prompts/dup.md', diff_hash: 'h-dup-2', version: 'v2' })), 'store/candidates:duplicate-id', 'c-dup')
    expect(countByAsset(ins, 'prompts/dup.md')).toBe(1)
    // 对照：同 id 同键异内容命中**键幂等闸**（core 语义优先序：键先于 id——非终态键在，即返既有 id）
    expect(ins.insertCandidate(makeCandidate({ id: 'c-dup', asset_path: 'prompts/dup.md', diff_hash: 'h-dup', version: 'v2' }))).toEqual({ id: 'c-dup', inserted: false })
    expect(countByAsset(ins, 'prompts/dup.md')).toBe(1)
  })

  it('verification JSON 快照：写入往返 deep-equal（含 judges 数组）；draft 缺键≡null 落列；不可序列化值拒', () => {
    const evidence = { sandboxPass: true, blastRadiusOk: false, judges: [{ judge: 'glm-5.3', pass: true }, { judge: 'kimi-k2', pass: false }] }
    ins.insertCandidate(makeCandidate({ id: 'c-ev', asset_path: 'prompts/ev.md', diff_hash: 'h-ev', verification: evidence, status: 'gated', created_at: T0 + 3200 }))
    expect(ins.getCandidate('c-ev')?.verification).toEqual(evidence)
    // 列形态：JSON 文本（同 jobs.payload 口径）
    const raw = ins.db.prepare('SELECT verification FROM candidates WHERE id = ?').get('c-ev') as { verification?: unknown }
    expect(String(raw.verification)).toBe(JSON.stringify(evidence))
    // 缺 verification 键（JS 调用方形态）≡null 落列（core 形状是 GateEvidence|null）
    const { verification: _omit, ...noVer } = makeCandidate({ id: 'c-nover', asset_path: 'prompts/nv.md', diff_hash: 'h-nv', created_at: T0 + 3300 }) as CandidateRow & { verification?: unknown }
    void _omit
    expect(ins.insertCandidate(noVer as unknown as CandidateRow).inserted).toBe(true)
    expect(ins.getCandidate('c-nover')?.verification).toBeNull()
    // 不可 JSON 化（函数）拒收不静默
    expectConfigInvalid(
      () => ins.insertCandidate(makeCandidate({ id: 'c-badfn', asset_path: 'prompts/bf.md', diff_hash: 'h-bf', verification: (() => 1) as unknown })),
      'store/candidates:verification-unserializable',
      'c-badfn',
    )
  })
})

describe('lineageOf（全祖先链，新→旧）——独立库', () => {
  let lin: Ledger

  beforeAll(() => {
    lin = openLedger(path.join(root, 'lineage.db'))
    // 三代谱系：gen1（初代）← gen2 ← gen3（各自不同资产键，created_at 递增）
    lin.insertCandidate(makeCandidate({ id: 'gen1', asset_path: 'prompts/x.md', diff_hash: 'h-1', created_at: T0 + 100 }))
    lin.insertCandidate(makeCandidate({ id: 'gen2', asset_path: 'prompts/x.md', diff_hash: 'h-2', parent_id: 'gen1', created_at: T0 + 200 }))
    lin.insertCandidate(makeCandidate({ id: 'gen3', asset_path: 'prompts/x.md', diff_hash: 'h-3', parent_id: 'gen2', created_at: T0 + 300 }))
  })

  afterAll(() => {
    lin.close()
  })

  it('三代链取回：[自身, 父, 祖父]（新→旧，core lineage 同序）；初代=仅 [自身]；F3-02 反追 3 跳=length 4 的链', () => {
    const chain = lin.lineageOf('gen3')
    expect(chain?.map((r) => r.id)).toEqual(['gen3', 'gen2', 'gen1'])
    expect(chain?.every((r) => typeof r.created_at === 'number')).toBe(true)
    expect(lin.lineageOf('gen1')?.map((r) => r.id)).toEqual(['gen1'])
    // 三跳链：gen4 下挂后 lineageOf('gen4').length === 4
    lin.insertCandidate(makeCandidate({ id: 'gen4', asset_path: 'prompts/x.md', diff_hash: 'h-4', parent_id: 'gen3', status: 'promoted', created_at: T0 + 400 }))
    expect(lin.lineageOf('gen4')?.length).toBe(4)
    expect(lin.lineageOf('no-such')).toBeUndefined()
  })

  it('断链 fail-closed：parent 指向缺失行 → CONFIG_INVALID lineage-broken（不静默截断，core 同语义）；环 → lineage-cycle 不死循环', () => {
    // 裸 SQL 注入断链（模拟库侧数据损坏）
    insertRaw(lin, { id: 'broken', parent_id: 'ghost' })
    expectConfigInvalid(() => lin.lineageOf('broken'), 'store/candidates:lineage-broken', 'ghost')
    // 裸 SQL 注入两节点环：反追不出根，如实抛且不死循环（seen 集保护）
    insertRaw(lin, { id: 'cy1', parent_id: 'cy2' })
    insertRaw(lin, { id: 'cy2', parent_id: 'cy1' })
    expectConfigInvalid(() => lin.lineageOf('cy1'), 'store/candidates:lineage-cycle')
  })

  it('insert 环检断链容忍（core ancestorIds 同口径）：父在库但其祖先缺失 → 挂接放行（环检不要求全链在库，lineage 读面才 fail-closed）', () => {
    insertRaw(lin, { id: 'half-root', parent_id: 'ghost-2' }) // 既有断链行（裸 SQL 注入）
    expect(lin.insertCandidate(makeCandidate({ id: 'under-half', asset_path: 'prompts/uh.md', diff_hash: 'h-uh', parent_id: 'half-root', created_at: T0 + 500 })).inserted).toBe(true)
    expect(lin.getCandidate('under-half')?.parent_id).toBe('half-root')
    // 读面对该链仍 fail-closed（断在 ghost-2 处如实抛，见上一用例语义）——insert 容忍与读面严格分工
    expectConfigInvalid(() => lin.lineageOf('under-half'), 'store/candidates:lineage-broken', 'ghost-2')
  })
})

describe('candidatesByStatus（判负查 active 集消费面）——独立库', () => {
  let st: Ledger

  beforeAll(() => {
    st = openLedger(path.join(root, 'status.db'))
    // 语料：授权态两条（created_at 乱序插入验证排序）+ 各状态一条
    st.insertCandidate(makeCandidate({ id: 'st-b', asset_path: 'prompts/s1.md', diff_hash: 's1', status: 'promoted', created_at: T0 + 200 }))
    st.insertCandidate(makeCandidate({ id: 'st-a', asset_path: 'prompts/s2.md', diff_hash: 's2', status: 'approved', created_at: T0 + 100 }))
    for (const [i, s] of (['draft', 'rejected', 'escalated', 'retired'] as const).entries()) {
      st.insertCandidate(makeCandidate({ id: `st-${s}`, asset_path: `prompts/other-${String(i)}.md`, diff_hash: `oh-${String(i)}`, status: s, created_at: T0 + 300 + i }))
    }
  })

  afterAll(() => {
    st.close()
  })

  it('状态集过滤：授权集 approved|promoted 恰两条且 (created_at,id) 升序；单状态面不含他态', () => {
    const active = st.candidatesByStatus(['approved', 'promoted'])
    expect(active.map((r) => r.id)).toEqual(['st-a', 'st-b'])
    expect(st.candidatesByStatus(['approved']).map((r) => r.id)).toEqual(['st-a'])
    expect(st.candidatesByStatus(['draft', 'escalated']).map((r) => r.id)).toEqual(['st-draft', 'st-escalated'])
    // 终态在授权集查询外（吊销即失效的查询面基础）
    expect(active.some((r) => r.status === 'retired' || r.status === 'rejected')).toBe(false)
  })

  it('空数组与枚举外值拒（fail-closed，空集=调用方 bug）', () => {
    expectConfigInvalid(() => st.candidatesByStatus([]), 'store/candidates:bad-statuses')
    expectConfigInvalid(() => st.candidatesByStatus(['approved', 'zombie' as unknown as CandidateStatus]), 'store/candidates:bad-statuses', 'zombie')
  })
})

describe('transitionCandidate（乐观锁）——独立库', () => {
  let tr: Ledger

  beforeAll(() => {
    tr = openLedger(path.join(root, 'transition.db'))
  })

  afterAll(() => {
    tr.close()
  })

  it('合法迁移落库：draft→proposed→sandboxed→gated 链式全 true，status 逐跳落库', () => {
    tr.insertCandidate(makeCandidate({ id: 't-1', asset_path: 'prompts/t.md', diff_hash: 'h-t', verification: { sandboxPass: true, blastRadiusOk: true } }))
    expect(tr.transitionCandidate('t-1', 'draft', 'proposed')).toBe(true)
    expect(tr.getCandidate('t-1')?.status).toBe('proposed')
    expect(tr.transitionCandidate('t-1', 'proposed', 'sandboxed')).toBe(true)
    expect(tr.transitionCandidate('t-1', 'sandboxed', 'gated')).toBe(true)
    expect(tr.getCandidate('t-1')?.status).toBe('gated')
  })

  it('并发竞态模拟（同连接）：两次同参迁移只一次成功——第二次期望当前值已过期，false 且 status 不动', () => {
    tr.insertCandidate(makeCandidate({ id: 't-race', asset_path: 'prompts/race.md', diff_hash: 'h-race' }))
    const first = tr.transitionCandidate('t-race', 'draft', 'proposed')
    const second = tr.transitionCandidate('t-race', 'draft', 'proposed') // 竞态方持同一期望当前值重放
    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(tr.getCandidate('t-race')?.status).toBe('proposed')
    // 过期 from（已迁走）同 false（如实上报）
    expect(tr.transitionCandidate('t-race', 'draft', 'sandboxed')).toBe(false)
    expect(tr.getCandidate('t-race')?.status).toBe('proposed')
  })

  it('并发竞态模拟（双连接同文件）：两句柄各读到 draft，先后持同期望值迁移——恰一次成功', () => {
    const p = path.join(root, 'race2.db')
    const w1 = openLedger(p)
    w1.insertCandidate(makeCandidate({ id: 't-two', asset_path: 'prompts/two.md', diff_hash: 'h-two' }))
    const w2 = openLedger(p)
    // 两方各自读到同一当前值（draft），随后先后落库——乐观锁保证恰一次
    expect(w1.getCandidate('t-two')?.status).toBe('draft')
    expect(w2.getCandidate('t-two')?.status).toBe('draft')
    const r1 = w1.transitionCandidate('t-two', 'draft', 'proposed')
    const r2 = w2.transitionCandidate('t-two', 'draft', 'proposed')
    expect([r1, r2].filter(Boolean)).toHaveLength(1)
    expect(w2.getCandidate('t-two')?.status).toBe('proposed')
    w1.close()
    w2.close()
  })

  it('无此行 false（如实上报）；枚举外 from/to 拒（运行期闸）', () => {
    expect(tr.transitionCandidate('no-such', 'draft', 'proposed')).toBe(false)
    expectConfigInvalid(() => tr.transitionCandidate('t-1', 'gated', 'zombie' as unknown as CandidateStatus), 'store/candidates:bad-status', 'zombie')
    expectConfigInvalid(() => tr.transitionCandidate('t-1', 'ghost' as unknown as CandidateStatus, 'approved'), 'store/candidates:bad-status', 'ghost')
  })

  it('判负消费面端到端：gated→approved（闸门决策落库）后 active 集可见；approved→retired 后从 active 集消失（吊销即失效）', () => {
    expect(tr.transitionCandidate('t-1', 'gated', 'approved')).toBe(true)
    expect(tr.candidatesByStatus(['approved', 'promoted']).map((r) => r.id)).toContain('t-1')
    expect(tr.transitionCandidate('t-1', 'approved', 'retired')).toBe(true)
    expect(tr.candidatesByStatus(['approved', 'promoted']).map((r) => r.id)).not.toContain('t-1')
  })
})

describe('core↔store 一致性（防漂移——沿 STUDIO_TOOLS↔GATEWAY_ACTIONS 先例）', () => {
  it('值域 deep-equal：core 字面量数组 vs store 复制数组（含序）+ zod 枚举 options + 授权集 ⊆ 值域', () => {
    expect([...CANDIDATE_STATUS_VALUES]).toEqual([...CORE_CANDIDATE_STATUSES])
    expect([...CANDIDATE_ASSET_KINDS]).toEqual([...CORE_ASSET_KINDS])
    expect([...CANDIDATE_BLAST_RADII]).toEqual([...CORE_BLAST_RADII])
    expect([...TERMINAL_CANDIDATE_STATUS_VALUES]).toEqual([...CORE_TERMINAL_STATUSES])
    // zod 枚举同源（schema 面钉死：改 schema 不改数组即红）
    expect([...CandidateRowSchema.shape.status.options]).toEqual([...CORE_CANDIDATE_STATUSES])
    expect([...CandidateRowSchema.shape.asset_type.options]).toEqual([...CORE_ASSET_KINDS])
    expect([...CandidateRowSchema.shape.blast_radius.options]).toEqual([...CORE_BLAST_RADII])
    // 授权态集（assertChangeAuthorized 判负口径）必须在 store 值域内
    expect(CORE_AUTHORIZING_STATUSES.every((s) => (CANDIDATE_STATUS_VALUES as readonly string[]).includes(s))).toBe(true)
  })

  it('键集对齐（type 级钉，编译期红）：core 字段 ⊆ row 字段；row 多余键恰 {created_at}；core 形状可填 row', () => {
    type CoreKey = keyof CoreCandidateRecord
    type RowKey = keyof CandidateRow
    const coreFieldsCovered: Exclude<CoreKey, RowKey> extends never ? true : never = true
    const rowExtraExactlyCreatedAt: Exclude<RowKey, CoreKey> extends 'created_at' ? true : never = true
    const rowAcceptsCoreShape: CoreCandidateRecord extends Pick<CandidateRow, CoreKey> ? true : never = true
    expect([coreFieldsCovered, rowExtraExactlyCreatedAt, rowAcceptsCoreShape]).toEqual([true, true, true])
  })

  it('core 纯函数产物直落库往返：proposeCandidate 产出（含 verification 快照）→ insert → 回读 deep-equal；core 迁移函数与 store 乐观锁接力', () => {
    const cons = openLedger(path.join(root, 'consistency.db'))
    // core 提案 → store 落库：core 形状 + created_at 即 CandidateRow（零改名直落）
    const parent = corePropose(
      { id: 'core-1', asset_type: 'flow', asset_path: 'flows/dispatch.yaml', version: 'v1', diff_hash: 'dh-1', blast_radius: 'company', parent_id: null },
      [],
    )
    expect(cons.insertCandidate({ ...parent.record, created_at: T0 }).inserted).toBe(true)
    const child = corePropose(
      { id: 'core-2', asset_type: 'flow', asset_path: 'flows/dispatch.yaml', version: 'v2', diff_hash: 'dh-2', blast_radius: 'company', parent_id: 'core-1' },
      [parent.record],
    )
    expect(cons.insertCandidate({ ...child.record, created_at: T0 + 1 }).inserted).toBe(true)
    // 幂等语义同源：core 对同键非终态命中 created=false → store insertCandidate 同判 inserted=false
    const coreIdem = corePropose(
      { id: 'core-3', asset_type: 'flow', asset_path: 'flows/dispatch.yaml', version: 'v2', diff_hash: 'dh-2', blast_radius: 'company', parent_id: 'core-1' },
      [parent.record, child.record],
    )
    const storeIdem = cons.insertCandidate({ ...coreIdem.record, id: 'core-3', created_at: T0 + 2 })
    expect(coreIdem.created).toBe(false)
    expect(storeIdem).toEqual({ id: 'core-2', inserted: false })
    // 谱系同源：core lineage 序 = store lineageOf 序
    const byId = new Map([[parent.record.id, parent.record], [child.record.id, child.record]])
    const coreChain = coreLineage(child.record, byId)
    expect(cons.lineageOf('core-2')?.map((r) => r.id)).toEqual([...coreChain.map((r) => r.id)])
    // 迁移接力：daemon 模式 = core 纯函数判定（机器边）→ store 乐观锁落库
    const advanced = coreTransition(child.record, 'proposed')
    expect(cons.transitionCandidate('core-2', child.record.status, advanced.status)).toBe(true)
    expect(cons.getCandidate('core-2')?.status).toBe('proposed')
    cons.close()
  })
})

describe('updateVerification（verification 快照行中写面——沙箱完成点落列）', () => {
  let ledger: Ledger

  beforeAll(() => {
    ledger = openLedger(path.join(root, 'update-verification.db'))
  })

  afterAll(() => {
    ledger.close()
  })

  let uvSeq = 0
  const evidence = { sandboxPass: true, blastRadiusOk: true, judges: [{ judge: 'glm-5.3', pass: true }] }

  /** 语料工厂：建 draft 候选并沿机器边推进到目标态（store 乐观锁逐跳；进 gated 前经本写面落证据——F3-02 时序） */
  function seedAt(target: CandidateStatus): string {
    uvSeq += 1
    const id = `uv-${String(uvSeq).padStart(2, '0')}`
    expect(ledger.insertCandidate(makeCandidate({ id, asset_path: `prompts/uv/${id}.md`, diff_hash: `uv-hash-${id}` })).inserted).toBe(true)
    const step = (from: CandidateStatus, to: CandidateStatus): void => {
      expect(ledger.transitionCandidate(id, from, to)).toBe(true)
    }
    if (target !== 'draft') step('draft', 'proposed')
    if (target !== 'draft' && target !== 'proposed') {
      step('proposed', 'sandboxed')
      if (target !== 'sandboxed') {
        // 进 gated 前落证据（本写面即沙箱完成写点；F3-02「缺一不进闸门」的时序前提）
        expect(ledger.updateVerification(id, { sandboxPass: true, blastRadiusOk: true })).toBe(true)
        step('sandboxed', 'gated')
        if (target === 'approved' || target === 'promoted' || target === 'retired') step('gated', 'approved')
        if (target === 'rejected') step('gated', 'rejected')
        if (target === 'escalated') step('gated', 'escalated')
        if (target === 'promoted') step('approved', 'promoted')
        if (target === 'retired') step('approved', 'retired')
      }
    }
    expect(ledger.getCandidate(id)?.status).toBe(target)
    return id
  }

  it('sandboxed 态写入：true + 读面 deep-equal 往返；重复写后值胜（单写者覆盖语义）', () => {
    const id = seedAt('sandboxed')
    expect(ledger.getCandidate(id)?.verification).toBeNull() // 沙箱未完成=draft 起即 null
    expect(ledger.updateVerification(id, evidence)).toBe(true)
    expect(ledger.getCandidate(id)?.verification).toEqual(evidence)
    const second = { sandboxPass: false, blastRadiusOk: true }
    expect(ledger.updateVerification(id, second)).toBe(true)
    expect(ledger.getCandidate(id)?.verification).toEqual(second)
    // 落证据后 sandboxed→gated 接力成功（core verification 守卫的库侧前提——写面与时序闸衔接）
    expect(ledger.transitionCandidate(id, 'sandboxed', 'gated')).toBe(true)
    expect(ledger.getCandidate(id)?.status).toBe('gated')
  })

  it('窗口语义：sandboxed 外全拒（CONFIG_INVALID/store/candidates:verification-window）且行值不动——证据只进沙箱阶段', () => {
    const outside: readonly CandidateStatus[] = ['draft', 'proposed', 'gated', 'approved', 'rejected', 'escalated', 'promoted', 'retired']
    for (const status of outside) {
      const id = seedAt(status)
      const before = ledger.getCandidate(id)?.verification ?? null
      expectConfigInvalid(
        () => ledger.updateVerification(id, evidence),
        'store/candidates:verification-window',
        '不在 verification 写入窗口',
      )
      expect(ledger.getCandidate(id)?.verification).toEqual(before) // 拒写=原值不动（不静默改列）
      expect(ledger.getCandidate(id)?.status).toBe(status) // 窗口拒不影响状态
    }
  })

  it('无此行=false（markRan 同风格如实上报，不抛不猜）', () => {
    expect(ledger.updateVerification('no-such-candidate', evidence)).toBe(false)
    expect(countAll(ledger)).toBeGreaterThanOrEqual(1) // 库有行但不匹配——false 非「库空」语义
  })

  it('序列化口径与 insert 同源：同证据经两写面落列字节一致（serializeVerification 单一口径源）', () => {
    // A：insert 时即带 verification；B：insert 后经 updateVerification 写同一证据
    const a = makeCandidate({ id: 'uv-ser-a', asset_path: 'prompts/uv/ser-a.md', diff_hash: 'uv-ser-a', verification: evidence })
    expect(ledger.insertCandidate(a).inserted).toBe(true)
    const b = seedAt('sandboxed') // b 已带种子证据（{sandboxPass:true,...}），覆盖为同一 evidence
    expect(ledger.updateVerification(b, evidence)).toBe(true)
    const rawA = String((ledger.db.prepare('SELECT verification FROM candidates WHERE id = ?').get(a.id) as { verification: unknown }).verification)
    const rawB = String((ledger.db.prepare('SELECT verification FROM candidates WHERE id = ?').get(b) as { verification: unknown }).verification)
    expect(rawA).toBe(rawB)
    expect(rawA).toBe(JSON.stringify(evidence)) // 且为原序 JSON.stringify（jobs.payload 同款非 canonical 序）
  })

  it('不可序列化拒（verification-unserializable）：函数（stringify 静默 undefined）与 BigInt（stringify 抛错）双路径，原值不动', () => {
    const id = seedAt('sandboxed')
    expect(ledger.updateVerification(id, evidence)).toBe(true)
    expectConfigInvalid(() => ledger.updateVerification(id, () => 'fn'), 'store/candidates:verification-unserializable')
    expectConfigInvalid(() => ledger.updateVerification(id, 10n), 'store/candidates:verification-unserializable')
    expect(ledger.getCandidate(id)?.verification).toEqual(evidence) // 拒收=原证据不动
    expect(ledger.getCandidate(id)?.status).toBe('sandboxed')
  })

  it('null/undefined 归一清回 null（与 insert 口径同源：undefined≡null）', () => {
    const id = seedAt('sandboxed')
    expect(ledger.updateVerification(id, evidence)).toBe(true)
    expect(ledger.updateVerification(id, null)).toBe(true)
    expect(ledger.getCandidate(id)?.verification).toBeNull()
    expect(ledger.updateVerification(id, undefined)).toBe(true)
    expect(ledger.getCandidate(id)?.verification).toBeNull()
    const before = countAll(ledger)
    expect(ledger.updateVerification('also-missing', undefined)).toBe(false) // null 写也过无此行=false 面
    expect(countAll(ledger)).toBe(before)
  })
})

// —— 测试内小工具 ——

function countAll(db: Ledger): number {
  return Number((db.db.prepare('SELECT COUNT(*) AS c FROM candidates').get() as { c?: unknown }).c)
}

function countByAsset(db: Ledger, assetPath: string): number {
  return Number((db.db.prepare('SELECT COUNT(*) AS c FROM candidates WHERE asset_path = ?').get(assetPath) as { c?: unknown }).c)
}

/** 裸 SQL 插入（模拟库侧数据损坏/历史行——绕过写面闸，仅测试用） */
function insertRaw(db: Ledger, spec: { id: string; parent_id: string | null }): void {
  db.db
    .prepare(
      `INSERT INTO candidates (id, asset_type, asset_path, version, diff_hash, blast_radius, verification, parent_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(spec.id, 'prompt', `prompts/raw-${spec.id}.md`, 'v1', `raw-${spec.id}`, 'isolated', null, spec.parent_id, 'draft', T0 + 9000)
}
