/**
 * 784 —— hr-sync 公司角色/职级 → Taiga 项目角色映射（config 解析 + 注入 + 消化器集成）
 *
 * 事故链：775 修好 membership shape 后，hr-sync 仍失败于「角色不存在」——旧缺省角色 'member'
 * 不是 Taiga 项目角色（项目角色=ux/design/front/back/product-owner/stakeholder）→
 * roleIdOf 抛 CONFIG_INVALID/unknown-role → 批次达限 ESCALATE（REL-1 入项目失败）。
 *
 * 本用例钉死：映射优先级 role:>level:>fallback(stakeholder)；装配注入 taigaRoleOf；
 * 消化器以解析后的 slug 调 ensureMember（不再出现 'member'）；未知角色走 fallback 不失败。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CompanySnapshot, IssueRecord, PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  HR_SERVE_DEFAULTS,
  HR_SERVE_KEYS,
  TAIGA_PROJECT_ROLE_SLUGS,
  assertDockerContainerName,
  assertTaigaEmailDomain,
  assertTaigaProjectRole,
  parseHrTaigaAccountPool,
  parseHrTaigaRoleMap,
  resolveHrTaigaRole,
  validateHrServeCross,
} from '../../../src/assembly/hrsync/config.ts'
import { parseDaemonConfig } from '../../../src/assembly/serve/config.ts'
import {
  createHrSyncDigester,
  enqueueHrBatch,
  type HrSyncDeps,
  type MatrixHrFace,
  type TaigaHrFace,
} from '../../../src/engine/hrsync/hrsync.ts'

let root = ''
const ledgers: Ledger[] = []

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-hr784-'))
})
afterAll(async () => {
  for (const ledger of ledgers.splice(0)) ledger.close()
  await rm(root, { recursive: true, force: true })
})

function person(id: string, level: number, role: string): PersonRef {
  return { id, name: id, login: id.toLowerCase(), level, dept: 'departments/工程部', role }
}

function snapshotOf(people: PersonRef[]): CompanySnapshot {
  return {
    slug: 'demo',
    name: '演示公司',
    level: 5,
    charter: 'charter.md',
    platform: { platform: 'taiga' },
    departments: [
      { name: '工程部', path: 'departments/工程部', parent: null, leader: 'REL-1', level: 3, lanes: ['core'], functions: ['交付'], relations: [] },
    ],
    people,
    jobs: [],
  }
}

describe('parseHrTaigaRoleMap / resolveHrTaigaRole（784 纯面）', () => {
  it('缺省/空串=空映射（全部走 fallback），fallback 默认 stakeholder（不再是 member）', () => {
    expect(parseHrTaigaRoleMap(undefined)).toEqual({ byRole: new Map(), byLevel: new Map() })
    expect(parseHrTaigaRoleMap('')).toEqual({ byRole: new Map(), byLevel: new Map() })
    expect(HR_SERVE_DEFAULTS.hrTaigaRoleFallback).toBe('stakeholder')
    expect(HR_SERVE_KEYS).toContain('hrTaigaRoleMap')
    expect(HR_SERVE_KEYS).toContain('hrTaigaRoleFallback')
    // 未命中 → stakeholder（旧实现会得到不存在的 'member'）
    expect(resolveHrTaigaRole(parseHrTaigaRoleMap(''), 'stakeholder', 2, '发布岗')).toBe('stakeholder')
    expect(resolveHrTaigaRole(parseHrTaigaRoleMap(''), 'stakeholder', 2, '发布岗')).not.toBe('member')
  })

  it('优先级：role: 命中 > level: 命中 > fallback', () => {
    const map = parseHrTaigaRoleMap('role:发布岗=stakeholder;level:3=product-owner;level:2=back;level:1=back')
    expect(map.byRole.get('发布岗')).toBe('stakeholder')
    expect(map.byLevel.get(2)).toBe('back')
    // role 优先（即使 level 命中）
    expect(resolveHrTaigaRole(map, 'stakeholder', 2, '发布岗')).toBe('stakeholder')
    // 角色未映射 → level
    expect(resolveHrTaigaRole(map, 'stakeholder', 2, '程序工程师')).toBe('back')
    // 角色/职级都未命中 → fallback
    expect(resolveHrTaigaRole(map, 'stakeholder', 9, '未知岗')).toBe('stakeholder')
    // 无 role 入参（老调用面）→ level
    expect(resolveHrTaigaRole(map, 'stakeholder', 3)).toBe('product-owner')
  })

  it('非法配置 fail-closed（坏 slug/未知前缀/重复键/坏 level）', () => {
    expect(() => parseHrTaigaRoleMap('role:发布岗==stakeholder')).toThrow(/slug|allowlist|角色/)
    expect(() => parseHrTaigaRoleMap('发布岗=stakeholder')).toThrow(/role:|level:/)
    expect(() => parseHrTaigaRoleMap('level:0=back')).toThrow(/1-9/)
    expect(() => parseHrTaigaRoleMap('level:2=back;level:2=front')).toThrow(/重复/)
    expect(() => parseHrTaigaRoleMap('role:发布岗')).toThrow(/<key>=<slug>/)
  })

  it('F1 allowlist：member/未知角色作 map 目标或 fallback 一律 CONFIG_INVALID；全部合法角色可过（大小写/空白归一）', () => {
    // 允许的角色集=真机项目角色（ux/design/front/back/product-owner/stakeholder）
    expect([...TAIGA_PROJECT_ROLE_SLUGS]).toEqual(['ux', 'design', 'front', 'back', 'product-owner', 'stakeholder'])
    for (const slug of TAIGA_PROJECT_ROLE_SLUGS) {
      expect(parseHrTaigaRoleMap(`role:发布岗=${slug}`).byRole.get('发布岗')).toBe(slug)
      expect(assertTaigaProjectRole(slug, 'test')).toBe(slug)
    }
    // member（旧缺省）不是项目角色 → 拒
    expect(() => parseHrTaigaRoleMap('role:发布岗=member')).toThrow(/allowlist/)
    expect(() => assertTaigaProjectRole('member', 'test')).toThrow(/allowlist/)
    // 未知角色 → 拒
    expect(() => parseHrTaigaRoleMap('role:发布岗=not-a-real-role')).toThrow(/allowlist/)
    // 大小写/首尾空白归一后合法
    expect(parseHrTaigaRoleMap('role:发布岗= Stakeholder ').byRole.get('发布岗')).toBe('stakeholder')
    // fallback 同源校验：member/未知→CONFIG_INVALID；合法→过
    expect(() => assertTaigaProjectRole('member', 'fallback')).toThrow(/allowlist/)
    const base = { hrSync: true, platform: 'taiga', hrTaigaInviteLog: '/tmp/invite.log', hrMatrix: false, hrPeopleWatch: false }
    expect(() => validateHrServeCross({ ...base, hrTaigaRoleFallback: 'member' })).toThrow(/allowlist/)
    expect(() => validateHrServeCross({ ...base, hrTaigaRoleFallback: 'not-a-real-role' })).toThrow(/allowlist/)
    expect(() => validateHrServeCross({ ...base, hrTaigaRoleFallback: 'stakeholder', hrTaigaRoleMap: 'role:发布岗=member' })).toThrow(/allowlist/)
    expect(() => validateHrServeCross({ ...base, hrTaigaRoleFallback: 'stakeholder' })).not.toThrow()
  })
})

/** 跑一轮消化器（真 ledger；假三面），返回 taiga ensureMember 观测 */
async function drainWith(options: {
  prev: PersonRef[]
  next: PersonRef[]
  roleMapSpec?: string
  fallback?: string
  injectRoleOf?: boolean
}): Promise<{ roleSlugs: string[]; report: Awaited<ReturnType<ReturnType<typeof createHrSyncDigester>['drain']>> }> {
  const ledger = openLedger(path.join(root, `ledger-${String(ledgers.length)}.sqlite`))
  ledgers.push(ledger)
  enqueueHrBatch(ledger, { prev: snapshotOf(options.prev), next: snapshotOf(options.next), company: 'demo', batchId: `b784-${String(ledgers.length)}`, ts: 1_700_000_000_000 })
  const roleSlugs: string[] = []
  const map = parseHrTaigaRoleMap(options.roleMapSpec)
  const fallback = options.fallback ?? 'stakeholder'
  const taiga: TaigaHrFace = {
    async ensureMember(args) {
      // 模拟真机 roleIdOf：'member' 不存在 → 旧行为会在这里 unknown-role 抛错
      if (args.roleSlug === 'member') throw new Error('CONFIG_INVALID/unknown-role: member 不在项目角色集')
      roleSlugs.push(args.roleSlug)
      return { membershipId: 1, created: true }
    },
    async ensureRole(args) {
      if (args.roleSlug === 'member') throw new Error('CONFIG_INVALID/unknown-role: member 不在项目角色集')
      roleSlugs.push(args.roleSlug)
    },
    async removeMember() {},
  }
  const matrix: MatrixHrFace = {
    async ensureAccount() {
      return { userId: '@demo:localhost', created: true }
    },
    async ensureMembership() {},
    async ensurePowerLevel() {},
    async kickFromRoom() {},
  }
  let idSeq = 0
  const deps: HrSyncDeps = {
    ledger,
    platform: {
      issues: {
        async create(input: { title: string }) {
          return { id: `T-${String(++idSeq)}`, title: input.title, state: 'New', updated: new Date(0).toISOString() } as IssueRecord
        },
      } as unknown as HrSyncDeps['platform']['issues'],
    },
    clock: () => 1_700_000_000_000 + ++idSeq,
    makeId: (ts) => `E-${String(ts)}-${String(++idSeq)}`,
    log: () => {},
    config: { company: 'demo', deptFallback: 'departments/工程部', maxPerTick: 20, retryLimit: 3, approver: 'daemon/hr-sync' },
    faces: {
      taiga,
      matrix,
      rooms: { company: '#co:localhost', aliasForDept: () => undefined },
      ...(options.injectRoleOf === false ? {} : { taigaRoleOf: (level: number, roleName?: string) => resolveHrTaigaRole(map, fallback, level, roleName) }),
    },
    redact: (text) => text,
  }
  const report = await createHrSyncDigester(deps).drain()
  return { roleSlugs, report }
}

describe('hr-sync 消化器集成（784：不再因角色不存在失败）', () => {
  it('REL-1（level2/发布岗）未配 map → fallback=stakeholder；旧 member 抛错路径不再触发', async () => {
    const { roleSlugs, report } = await drainWith({ prev: [], next: [person('REL-1', 2, '发布岗')] })
    expect(roleSlugs).toContain('stakeholder')
    expect(roleSlugs).not.toContain('member')
    expect(report.done).toBeGreaterThan(0)
    expect(report.failed).toBe(0)
  })

  it('显式 role: 映射优先（发布岗=stakeholder；程序工程师=back）', async () => {
    const { roleSlugs, report } = await drainWith({
      prev: [],
      next: [person('REL-1', 2, '发布岗'), person('ENG-1', 1, '程序工程师')],
      roleMapSpec: 'role:发布岗=stakeholder;role:程序工程师=back;level:2=back;level:1=back',
    })
    expect(roleSlugs).toContain('stakeholder')
    expect(roleSlugs).toContain('back')
    expect(roleSlugs).not.toContain('member')
    expect(report.failed).toBe(0)
  })

  it('level: 兜底（角色未映射时按职级）；都未命中才 fallback', async () => {
    const { roleSlugs } = await drainWith({
      prev: [],
      next: [person('X-1', 3, '未知岗')],
      roleMapSpec: 'level:3=product-owner',
    })
    expect(roleSlugs).toContain('product-owner')
  })

  it("装配未注入 taigaRoleOf（旧调用面）→ 仍退到 stakeholder，不再 'member' 失败", async () => {
    const { roleSlugs, report } = await drainWith({ prev: [], next: [person('REL-1', 2, '发布岗')], injectRoleOf: false })
    expect(roleSlugs).toContain('stakeholder')
    expect(report.failed).toBe(0)
  })
})

describe('784 v3/F1：parseDaemonConfig 真路径接线（hrTaigaRoleMap/Fallback 两键）', () => {
  const BASE_YAML = [
    'db: ./x.sqlite',
    'company: demo',
    'platform: taiga',
    'taigaUrl: http://127.0.0.1:9000',
    'taigaProject: demo',
    'taigaAuth: password',
    'hrSync: true',
    'hrTaigaInviteLog: /tmp/invite.log',
  ].join('\n')

  it('合法六角色/fallback 解析成功（含大小写/空白归一）', () => {
    const cfg = parseDaemonConfig(
      `${BASE_YAML}\nhrTaigaRoleMap: role:发布岗=stakeholder;role:程序工程师=back;role:策划=product-owner;role:前端=front;role:设计=design;role:UX=ux\nhrTaigaRoleFallback: Stakeholder`,
    )
    expect(cfg.hrTaigaRoleFallback).toBe('stakeholder')
    expect(cfg.hrTaigaRoleMap).toContain('role:发布岗=stakeholder')
    // 真路径应把六个角色都收下（通过 parse 即证明 allowlist 校验被真实调用）
    const parsed = parseHrTaigaRoleMap(cfg.hrTaigaRoleMap)
    expect(parsed.byRole.size).toBe(6)
    expect(parsed.byRole.get('发布岗')).toBe('stakeholder')
    expect(parsed.byRole.get('UX')).toBe('ux')
  })

  it('member 作 map/fallback → CONFIG_INVALID 且含 allowlist 诊断（不再是「未知配置键」）', () => {
    for (const yaml of [
      `${BASE_YAML}\nhrTaigaRoleMap: role:发布岗=member`,
      `${BASE_YAML}\nhrTaigaRoleFallback: member`,
      `${BASE_YAML}\nhrTaigaRoleMap: role:发布岗=not-a-real-role`,
    ]) {
      let message = ''
      try {
        parseDaemonConfig(yaml)
      } catch (err) {
        message = err instanceof Error ? err.message : String(err)
      }
      expect(message).toContain('allowlist')
      expect(message).not.toContain('未知配置键')
    }
  })

  it('无这两键的旧配置：默认 fallback=stakeholder（不强制配 map）', () => {
    const cfg = parseDaemonConfig(BASE_YAML)
    expect(cfg.hrTaigaRoleFallback).toBe('stakeholder')
    expect(cfg.hrTaigaRoleMap).toBeUndefined()
  })
})

describe('793：Taiga 账号面配置（emailDomain/accountPool/docker logs 源）', () => {
  it('emailDomain：缺省 studio.local；trim/lower 归一；非法域名拒', () => {
    expect(HR_SERVE_DEFAULTS.hrTaigaEmailDomain).toBe('studio.local')
    expect(HR_SERVE_KEYS).toContain('hrTaigaEmailDomain')
    expect(HR_SERVE_KEYS).toContain('hrTaigaAccountPool')
    expect(HR_SERVE_KEYS).toContain('hrTaigaInviteLogDocker')
    expect(assertTaigaEmailDomain(' Studio.Local ', 'x')).toBe('studio.local')
    expect(assertTaigaEmailDomain('corp.example.com', 'x')).toBe('corp.example.com')
    expect(() => assertTaigaEmailDomain('bad domain', 'x')).toThrow(/域名/)
    expect(() => assertTaigaEmailDomain('http://x', 'x')).toThrow(/域名/)
  })

  it('accountPool：JSON/紧凑形解析；重复/坏值/坏 email 拒；空合法', () => {
    expect(parseHrTaigaAccountPool(undefined)).toEqual({})
    expect(parseHrTaigaAccountPool('{}')).toEqual({})
    expect(parseHrTaigaAccountPool('{"REL-1":"rel-1@studio.local"}')).toEqual({ 'REL-1': 'rel-1@studio.local' })
    expect(parseHrTaigaAccountPool('REL-1=rel-1@studio.local;ENG-1=eng1')).toEqual({ 'REL-1': 'rel-1@studio.local', 'ENG-1': 'eng1' })
    expect(() => parseHrTaigaAccountPool('REL-1=a@x.local;REL-1=b@x.local')).toThrow(/重复/)
    expect(() => parseHrTaigaAccountPool('REL-1=')).toThrow(/空|login=/)
    expect(() => parseHrTaigaAccountPool('REL-1=bad@')).toThrow(/邮箱/)
  })

  it('docker 容器名：合法/非法（防命令注入）', () => {
    expect(assertDockerContainerName('taiga-docker-taiga-back-1', 'x')).toBe('taiga-docker-taiga-back-1')
    expect(() => assertDockerContainerName('bad name', 'x')).toThrow(/容器名/)
    expect(() => assertDockerContainerName('a;rm -rf /', 'x')).toThrow(/容器名/)
  })

  it('parseDaemonConfig 真路径：三键接线/非法拒；docker-only 可过；无源拒', () => {
    const base = [
      'db: ./x.sqlite', 'company: demo', 'platform: taiga', 'taigaUrl: http://127.0.0.1:9000', 'taigaProject: demo', 'taigaAuth: password',
      'hrSync: true', 'hrTaigaInviteLog: /tmp/invite.log',
    ].join('\n')
    const cfg = parseDaemonConfig(`${base}\nhrTaigaEmailDomain: Studio.Local\nhrTaigaAccountPool: '{"REL-1":"rel-1@studio.local"}'\nhrTaigaInviteLogDocker: taiga-docker-taiga-back-1`)
    expect(cfg.hrTaigaEmailDomain).toBe('studio.local')
    expect(cfg.hrTaigaAccountPool).toContain('REL-1')
    expect(cfg.hrTaigaInviteLogDocker).toBe('taiga-docker-taiga-back-1')
    expect(() => parseDaemonConfig(`${base}\nhrTaigaEmailDomain: bad domain`)).toThrow(/域名/)
    expect(() => parseDaemonConfig(`${base}\nhrTaigaAccountPool: 'not-json'`)).toThrow(/JSON|条目/)
    expect(() => parseDaemonConfig(`${base}\nhrTaigaInviteLogDocker: 'bad name'`)).toThrow(/容器名/)
    // 仅 docker 源（无 hrTaigaInviteLog）也可过；两者都无 → CONFIG_INVALID
    const dockerOnly = ['db: ./x.sqlite', 'company: demo', 'platform: taiga', 'taigaUrl: http://127.0.0.1:9000', 'taigaProject: demo', 'taigaAuth: password', 'hrSync: true', 'hrTaigaInviteLogDocker: taiga-docker-taiga-back-1'].join('\n')
    expect(parseDaemonConfig(dockerOnly).hrTaigaInviteLogDocker).toBe('taiga-docker-taiga-back-1')
    const noSource = ['db: ./x.sqlite', 'company: demo', 'platform: taiga', 'taigaUrl: http://127.0.0.1:9000', 'taigaProject: demo', 'taigaAuth: password', 'hrSync: true'].join('\n')
    expect(() => parseDaemonConfig(noSource)).toThrow(/hrTaigaInviteLog/)
  })
})
