/**
 * test/v2/prm —— PRM 生成器（九段/digest/unsupportedSegments）与 PRM-G1..PRM-G8
 *
 * 依据：docs/plan/05 IMPL-07-04（验收：PRM-G1..G8 八律全绿＋zero-IO/可复算＋只收紧/
 *       不猜不填负例＝NEG-RUN-01 前腿）；v2/12 §1.6（九段语义与生成八律 PRM-G1..G8，
 *       正式号 v2/09 §一-61）；v2/14 §六（compileProjection 输入输出与八律验收口径）；
 *       v2/09 ENU-108（段名值集）；v1 78-§3.2/§3.3（字段级硬规则与 G1–G8 细目）；
 *       81-files/12（八段必填＋persona 可选不计损；authority/tools 未承载＝拒载）；
 *       v2/15 §二 SEC-SIG-04 / v2/17 NEG-RUN-01（摘要不符/缺段不启动；签名通道未建，
 *       本件只证生成期 fail-closed 前腿，不宣称验签已成立）。
 *
 * 本件只测纯函数面：生成、复算、门禁前腿。零 IO 静态面用读文件断言（测试侧 IO 不算
 * 被断言面）；生产模块自身不 touch 文件/网络/时钟/随机。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ExecutionPort, PolicyProjection, ProjectionInput, ProjectionSegment } from '@studio-next/contract'
import type { CompileProjectionInput, ProjectionDeployment } from '../../src/prm/compile-projection.ts'
import * as prm from '../../src/prm/compile-projection.ts'
import { GATING_SEGMENTS, PRM_CANONICALIZATION, PRM_DIGEST_PREFIX, PROJECTION_SEGMENTS, compileProjection, projectionDigest, projectionGate } from '../../src/prm/compile-projection.ts'

const PRM_DIR = fileURLToPath(new URL('../../src/prm/', import.meta.url))
const PRM_FILES = readdirSync(PRM_DIR).filter((entry) => entry.endsWith('.ts')).sort()

const readSource = (file: string): string => readFileSync(`${PRM_DIR}${file}`, 'utf8')

// ── 夹具（最小输入面；不是记录形状） ──

const FULL_CARRIERS: readonly ProjectionSegment[] = [...PROJECTION_SEGMENTS]

function fullDeployment(overrides: Partial<ProjectionDeployment> = {}): ProjectionDeployment {
  return {
    carriedSegments: FULL_CARRIERS,
    sandbox: { mode: 'workspace-write', rootRef: 'sandbox-root-1' },
    approvalTemplateRef: 'approval-template-1',
    evidenceSinkRef: 'evidence-sink-1',
    personaRefs: ['persona-1'],
    ...overrides,
  }
}

function baseInput(overrides: Partial<CompileProjectionInput> = {}): CompileProjectionInput {
  return {
    companyId: 'company-1',
    workRef: 'work-1',
    planRef: 'plan-1',
    grantRefs: ['grant-1', 'grant-2'],
    capabilityRefs: ['cap-1', 'cap-2'],
    host: { hostKind: 'dsh', version: '0.2.0-rc.2', bindingRef: 'BIND-DSH-01' },
    secretTypes: ['per_task_shortlived'],
    validityFrom: '2026-11-01T00:00:00Z',
    validityUntil: '2026-12-01T00:00:00Z',
    deployment: fullDeployment(),
    ...overrides,
  }
}

/** 无 position 插件形态 / 纯 CLI shell-out：只有数据段被声明承载 */
function dataOnlyInput(overrides: Partial<CompileProjectionInput> = {}): CompileProjectionInput {
  return baseInput({ deployment: { carriedSegments: ['identity', 'plan', 'validity'] }, ...overrides })
}

function okProjection(input: CompileProjectionInput): PolicyProjection {
  const result = compileProjection(input)
  if (result.kind !== 'ok') {
    throw new Error(`期望生成成功，实际拒绝：${result.error.subcause} / ${result.error.detail ?? ''}`)
  }
  return result.value
}

function errorOf(input: CompileProjectionInput): {
  category: string; subcause: string; retryable: boolean; sideEffectPossible: boolean; reconcileRequired: boolean
} {
  const result = compileProjection(input)
  expect(result.kind).toBe('err')
  if (result.kind !== 'err') throw new Error('unreachable')
  return {
    category: result.error.category,
    subcause: result.error.subcause,
    retryable: result.error.retryable,
    sideEffectPossible: result.error.sideEffectPossible,
    reconcileRequired: result.error.reconcile.required,
  }
}

function mutate(input: CompileProjectionInput, patch: Readonly<Record<string, unknown>>): CompileProjectionInput {
  return { ...input, ...patch } as unknown as CompileProjectionInput
}
function withoutValidityUntil(input: CompileProjectionInput = baseInput()): CompileProjectionInput {
  const raw: Record<string, unknown> = { ...input }
  delete raw['validityUntil']
  return raw as unknown as CompileProjectionInput
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}
function importSpecifiers(text: string): string[] {
  const specifiers: string[] = []
  for (const match of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    if (match[1] !== undefined) specifiers.push(match[1])
  }
  for (const match of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
    if (match[1] !== undefined) specifiers.push(match[1])
  }
  return specifiers
}

// ── 一、零 IO 静态面（机器可判） ──

describe('零 IO · src/prm/** 静态面', () => {
  it('三件齐备且只含相对 .ts import；@studio-next/contract 只作 import type（运行时零依赖）', () => {
    expect(PRM_FILES.length).toBeGreaterThanOrEqual(3)
    expect(PRM_FILES).toContain('compile-projection.ts')
    for (const file of PRM_FILES) {
      const text = readSource(file)
      const specifiers = importSpecifiers(text)
      expect(specifiers.length, file).toBeGreaterThan(0)
      for (const specifier of specifiers) {
        if (specifier === '@studio-next/contract') {
          const typeOnly = [...text.matchAll(/import\s+type\s+[^;]*?from\s+'@studio-next\/contract'/gs)]
          expect(typeOnly.length, `${file} 的契约 import 必须是 import type`).toBeGreaterThan(0)
          continue
        }
        expect(specifier, `${file} → ${specifier}`).toMatch(/^\.\.?\//)
        expect(specifier, `${file} → ${specifier}`).toMatch(/\.ts$/)
        expect(specifier, `${file} → ${specifier}`).not.toContain('node:')
      }
    }
  })

  it('无文件/网络/子进程/时钟/随机/控制台/动态 import', () => {
    const forbidden = [
      'node:',
      'readFileSync',
      'writeFileSync',
      'fetch(',
      'process.',
      'Date.now(',
      'new Date(',
      'Math.random(',
      'setTimeout(',
      'setInterval(',
      'console.',
      'require(',
      'import(',
    ]
    for (const file of PRM_FILES) {
      const text = readSource(file)
      for (const token of forbidden) {
        expect(text.includes(token), `${file} 含禁止 token：${token}`).toBe(false)
      }
    }
  })

  it('导出面只含生成/复算/门禁/常量（无「更新投影」一类内存改写口：G1/G5）', () => {
    const exported = Object.keys(prm).sort()
    expect(exported).toEqual([
      'GATING_SEGMENTS',
      'PRM_CANONICALIZATION',
      'PRM_DIGEST_PREFIX',
      'PROJECTION_SEGMENTS',
      'compileProjection',
      'projectionDigest',
      'projectionGate',
    ])
    for (const name of exported) {
      expect(name, name).not.toMatch(/update|mutate|apply|withdraw|patch|sign/i)
    }
  })

  it('头注可判：实现单号/八律号/缺口号/零 IO 声明在文', () => {
    const head = readSource('compile-projection.ts')
    for (const marker of ['IMPL-07-04', 'PRM-G1', 'PRM-G8', 'GAP-V2-02', '零 IO']) {
      expect(head).toContain(marker)
    }
    expect(PRM_CANONICALIZATION).toBe('studio-next.jcs@1')
    expect(PRM_DIGEST_PREFIX).toBe('sha256:')
  })
})

// ── 二、PRM-G1 单向编译不回写 ──

describe('PRM-G1 单向编译：不回写、不持有输入句柄', () => {
  it('冻结输入可跑：生成器不写输入（写即抛），前后 JSON 逐字不变', () => {
    const input = deepFreeze(baseInput())
    const before = JSON.stringify(input)
    expect(() => compileProjection(input)).not.toThrow()
    compileProjection(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('输出递归冻结：九段/数组/有效期均不可改（内存改写路径不存在）', () => {
    const projection = okProjection(baseInput())
    const segment = projection.segments.tools as unknown as { enabled: boolean }
    const refs = projection.authorityRefs as unknown as string[]
    const validity = projection.validity as unknown as { from: string }
    expect(() => {
      segment.enabled = false
    }).toThrow(TypeError)
    expect(() => {
      refs.push('grant-x')
    }).toThrow(TypeError)
    expect(() => {
      validity.from = '2027-01-01T00:00:00Z'
    }).toThrow(TypeError)
  })

  it('输出对输入数组做快照：调用后再改输入容器不影响已生成投影', () => {
    const grants = ['grant-1', 'grant-2']
    const projection = okProjection(baseInput({ grantRefs: grants }))
    grants.push('grant-3')
    expect(projection.authorityRefs).toEqual(['grant-1', 'grant-2'])
    expect(projection.segments.authority.sourceRefs).toEqual(['grant-1', 'grant-2'])
  })

  it('冻结签名兼容 PORT-EXEC.compileProjection（ProjectionInput 可直传）', () => {
    const portMethod: ExecutionPort['compileProjection'] = compileProjection
    expect(typeof portMethod).toBe('function')
    const plain: ProjectionInput = baseInput()
    const result = compileProjection(plain)
    expect(result.kind).toBe('ok')
  })
})

// ── 三、PRM-G2 幂等（同输入同摘要） ──

describe('PRM-G2 幂等：同输入同清单同 digest', () => {
  it('两次调用深相等且 digest 相同', () => {
    const input = baseInput()
    const first = okProjection(input)
    const second = okProjection(input)
    expect(second).toEqual(first)
    expect(second.digest).toBe(first.digest)
  })

  it('引用集合顺序不影响结果（集合语义规范化；同集合恒同 digest）', () => {
    const forward = okProjection(baseInput())
    const reversed = okProjection(
      baseInput({
        grantRefs: ['grant-2', 'grant-1'],
        capabilityRefs: ['cap-2', 'cap-1'],
        secretTypes: ['per_task_shortlived'],
      }),
    )
    expect(reversed).toEqual(forward)
    expect(reversed.digest).toBe(forward.digest)
  })

  it('JSON 往返后复算 digest 不变（输出可序列化且摘要对键序不敏感）', () => {
    const projection = okProjection(baseInput())
    const roundTripped = JSON.parse(JSON.stringify(projection)) as PolicyProjection
    const recomputed = projectionDigest(roundTripped)
    expect(recomputed.kind).toBe('ok')
    if (recomputed.kind === 'ok') expect(recomputed.value).toBe(projection.digest)
  })

  it('清单输入任一维度变化 → digest 变化（含部署面；不可复用旧摘要）', () => {
    const baseline = okProjection(baseInput()).digest
    const variants: CompileProjectionInput[] = [
      baseInput({ companyId: 'company-2' }),
      baseInput({ workRef: 'work-2' }),
      baseInput({ planRef: 'plan-2' }),
      baseInput({ grantRefs: ['grant-1'] }),
      baseInput({ capabilityRefs: ['cap-1'] }),
      baseInput({ secretTypes: ['long_lived'] }),
      baseInput({ host: { hostKind: 'dsh', version: '0.2.0-rc.2', bindingRef: 'BIND-DSH-02' } }),
      baseInput({ validityFrom: '2026-11-02T00:00:00Z' }),
      withoutValidityUntil(),
      baseInput({ deployment: fullDeployment({ personaRefs: ['persona-2'] }) }),
    ]
    for (const variant of variants) {
      expect(okProjection(variant).digest, JSON.stringify(variant)).not.toBe(baseline)
    }
  })
})

// ── 四、PRM-G3 只收紧（清单×部署可比较字段取交集；空集拒启；网络不参与） ──

describe('PRM-G3 只收紧：交集而非并集，部署不能放大', () => {
  it('tools = 能力声明集 ∩ 部署允许集（收窄生效，plan 仍载完整能力描述）', () => {
    const projection = okProjection(baseInput({ deployment: fullDeployment({ allowedCapabilityRefs: ['cap-2', 'cap-9'] }) }))
    expect(projection.segments.tools.sourceRefs).toEqual(['cap-2'])
    expect(projection.segments.plan.sourceRefs).toEqual(['cap-1', 'cap-2', 'plan-1'])
  })

  it('部署允许集是超集时也不得新增（cap-9 永不出现在清单）', () => {
    const projection = okProjection(baseInput({ deployment: fullDeployment({ allowedCapabilityRefs: ['cap-1', 'cap-2', 'cap-9'] }) }))
    expect(projection.segments.tools.sourceRefs).toEqual(['cap-1', 'cap-2'])
    expect(JSON.stringify(projection)).not.toContain('cap-9')
  })

  it('空交集＝拒绝生成（不取并集、不降级宽权限）', () => {
    const error = errorOf(baseInput({ deployment: fullDeployment({ allowedCapabilityRefs: ['cap-9'] }) }))
    expect(error.subcause).toBe('projection-intersection-empty')
    expect(error.category).toBe('rejected_precondition')
  })

  it('空能力声明集＝无工具（不是「全部」）：tools 启用但白名单为空', () => {
    const projection = okProjection(baseInput({ capabilityRefs: [] }))
    expect(projection.segments.tools.enabled).toBe(true)
    expect(projection.segments.tools.sourceRefs).toEqual([])
    expect(projection.segments.tools.note).toContain('allowlist:empty')
    expect(projection.unsupportedSegments).not.toContain('tools')
  })

  it('生效窗只能收窄：部署更早者胜出并留注记，部署更晚者不得延长输入窗', () => {
    const narrowed = okProjection(baseInput({ deployment: fullDeployment({ validityUntil: '2026-11-15T00:00:00Z' }) }))
    expect(narrowed.validity.until).toBe('2026-11-15T00:00:00Z')
    expect(narrowed.segments.validity.note).toBe('window:narrowed-by-deployment')

    const wider = okProjection(baseInput({ deployment: fullDeployment({ validityUntil: '2027-01-01T00:00:00Z' }) }))
    expect(wider.validity.until).toBe('2026-12-01T00:00:00Z')
    expect(wider.segments.validity.note).toBeUndefined()
  })

  it('部署上界早于输入起点 → 交集为空＝拒绝生成', () => {
    const empty = errorOf(baseInput({ deployment: fullDeployment({ validityUntil: '2026-10-01T00:00:00Z' }) }))
    expect(empty.subcause).toBe('projection-validity-empty')
  })

  it('网络字段不参与交集：部署无法声明网络放行（未知键拒绝），沙箱恒声明外置', () => {
    const error = errorOf({
      ...baseInput(),
      deployment: fullDeployment({ network: 'proxied' } as unknown as Partial<ProjectionDeployment>),
    })
    expect(error.subcause).toBe('projection-input-incomplete')
    const projection = okProjection(baseInput())
    expect(projection.segments.sandbox.note).toContain('network:external-only')
  })
})

// ── 五、PRM-G4 段绑定（一段一清单，引用不跨段） ──

describe('PRM-G4 段绑定：九段全键、一段一来源集、不跨段借引', () => {
  it('九段全键恰一次；unsupportedSegments 去重且按 ENU-108 序', () => {
    const projection = okProjection(dataOnlyInput())
    expect(Object.keys(projection.segments)).toEqual([...PROJECTION_SEGMENTS])
    expect(new Set(projection.unsupportedSegments).size).toBe(projection.unsupportedSegments.length)
    const ordered = PROJECTION_SEGMENTS.filter((segment) => projection.unsupportedSegments.includes(segment))
    expect(projection.unsupportedSegments).toEqual(ordered)
  })

  it('各段只引用自己的来源（authority⊆grant、tools⊆capability、plan=plan+capability…）', () => {
    const projection = okProjection(baseInput())
    const grantSet = new Set(['grant-1', 'grant-2'])
    const capSet = new Set(['cap-1', 'cap-2'])
    expect(projection.segments.identity.sourceRefs).toEqual(['company-1', 'work-1'])
    expect(projection.segments.authority.sourceRefs.every((ref) => grantSet.has(ref))).toBe(true)
    expect(projection.segments.tools.sourceRefs.every((ref) => capSet.has(ref))).toBe(true)
    expect(projection.segments.plan.sourceRefs).toEqual(['cap-1', 'cap-2', 'plan-1'])
    expect(projection.segments.sandbox.sourceRefs).toEqual(['per_task_shortlived', 'sandbox-root-1'])
    expect(projection.segments.approval.sourceRefs).toEqual(['approval-template-1'])
    expect(projection.segments.evidence.sourceRefs).toEqual(['evidence-sink-1'])
    expect(projection.segments.persona.sourceRefs).toEqual(['persona-1'])
    expect(projection.segments.validity.sourceRefs).toEqual([
      '2026-11-01T00:00:00Z',
      '2026-12-01T00:00:00Z',
    ])
    expect(projection.authorityRefs).toEqual(['grant-1', 'grant-2'])
  })

  it('换段（workRef）必换清单：身份段与 digest 变，其他段引用不动', () => {
    const first = okProjection(baseInput())
    const second = okProjection(baseInput({ workRef: 'work-2' }))
    expect(second.segments.identity.sourceRefs).toEqual(['company-1', 'work-2'])
    expect(second.segments.tools.sourceRefs).toEqual(first.segments.tools.sourceRefs)
    expect(second.segments.authority.sourceRefs).toEqual(first.segments.authority.sourceRefs)
    expect(second.digest).not.toBe(first.digest)
  })

  it('清单与目标宿主/绑定档案绑定（身份段注记），换宿主即不可复用摘要', () => {
    const projection = okProjection(baseInput())
    expect(projection.segments.identity.note).toBe('host:dsh@0.2.0-rc.2;binding:BIND-DSH-01')
    const other = okProjection(
      baseInput({ host: { hostKind: 'claude', version: '1.0.0', bindingRef: 'BIND-CLI-CLAUDE-01' } }),
    )
    expect(other.digest).not.toBe(projection.digest)
  })
})

// ── 六、PRM-G5 撤回可传（重新生成，不得只改内存） ──

describe('PRM-G5 撤回可传：旧清单不被内存改写，须重生成', () => {
  it('授予撤回（从清单输入移除）→ 新投影摘要变化，旧投影逐字不变', () => {
    const before = okProjection(baseInput())
    const after = okProjection(baseInput({ grantRefs: ['grant-1'] }))
    expect(before.authorityRefs).toEqual(['grant-1', 'grant-2'])
    expect(after.authorityRefs).toEqual(['grant-1'])
    expect(after.segments.authority.sourceRefs).toEqual(['grant-1'])
    expect(after.digest).not.toBe(before.digest)
    expect(before.segments.authority.sourceRefs).toEqual(['grant-1', 'grant-2'])
  })

  it('生效窗变化 → 摘要变化（陈旧清单可被判出，不能靠改内存续命）', () => {
    const before = okProjection(baseInput())
    const after = okProjection(baseInput({ validityUntil: '2026-11-20T00:00:00Z' }))
    expect(after.validity.until).toBe('2026-11-20T00:00:00Z')
    expect(after.digest).not.toBe(before.digest)
  })

  it('摘要不符可判（NEG-RUN-01 摘要腿前腿）：篡改投影体后复算值不等', () => {
    const projection = okProjection(baseInput())
    const tampered: PolicyProjection = {
      ...projection,
      segments: {
        ...projection.segments,
        tools: { enabled: false, sourceRefs: [] },
      },
    }
    const recomputed = projectionDigest(tampered)
    expect(recomputed.kind).toBe('ok')
    if (recomputed.kind === 'ok') expect(recomputed.value).not.toBe(projection.digest)
  })
})

// ── 七、PRM-G6 不猜不填（缺字段/未定版/非法时刻/未知键＝拒绝生成） ──

describe('PRM-G6 不猜不填：输入缺字段拒绝生成，不补默认值', () => {
  it('缺字段/未定版引用/非法时刻/未知键一律拒绝，且不产出投影', () => {
    const cases: ReadonlyArray<readonly [string, CompileProjectionInput, string]> = [
      ['缺 companyId', mutate(baseInput(), { companyId: undefined }), 'projection-input-incomplete'],
      ['workRef 为空串', mutate(baseInput(), { workRef: '' }), 'projection-input-incomplete'],
      ['planRef 写 latest', mutate(baseInput(), { planRef: 'latest' }), 'projection-input-incomplete'],
      ['grantRefs 为空（authority 无来源）', mutate(baseInput(), { grantRefs: [] }), 'projection-input-incomplete'],
      ['capabilityRefs 缺失', mutate(baseInput(), { capabilityRefs: undefined }), 'projection-input-incomplete'],
      ['secretTypes 含空串', mutate(baseInput(), { secretTypes: [''] }), 'projection-input-incomplete'],
      ['host 缺 bindingRef', mutate(baseInput(), { host: { hostKind: 'dsh', version: '0.2.0-rc.2' } }), 'projection-input-incomplete'],
      ['host.version 写 current', mutate(baseInput(), { host: { hostKind: 'dsh', version: 'current', bindingRef: 'BIND-DSH-01' } }), 'projection-input-incomplete'],
      ['validityFrom 非瞬时', mutate(baseInput(), { validityFrom: '2026-11-01' }), 'projection-input-incomplete'],
      ['validityUntil 早于 from', mutate(baseInput(), { validityUntil: '2026-10-01T00:00:00Z' }), 'projection-validity-empty'],
      ['deployment 未知段名', baseInput({ deployment: { carriedSegments: ['bogus' as ProjectionSegment] } }), 'projection-input-incomplete'],
      ['deployment 未知键', baseInput({ deployment: { allowedSegments: ['tools'] } as unknown as ProjectionDeployment }), 'projection-input-incomplete'],
      ['sandbox.mode 非法', baseInput({ deployment: fullDeployment({ sandbox: { mode: 'write-anywhere' as 'read-only', rootRef: 'root-1' } }) }), 'projection-input-incomplete'],
      ['allowedCapabilityRefs 含空串', baseInput({ deployment: fullDeployment({ allowedCapabilityRefs: [''] }) }), 'projection-input-incomplete'],
      ['deployment.validityUntil 非法', baseInput({ deployment: fullDeployment({ validityUntil: '2026-13-01T00:00:00Z' }) }), 'projection-input-incomplete'],
      ['personaRefs 含 latest', baseInput({ deployment: fullDeployment({ personaRefs: ['latest'] }) }), 'projection-input-incomplete'],
      ['approvalTemplateRef 为空', baseInput({ deployment: fullDeployment({ approvalTemplateRef: '' }) }), 'projection-input-incomplete'],
      ['evidenceSinkRef 为空', baseInput({ deployment: fullDeployment({ evidenceSinkRef: '' }) }), 'projection-input-incomplete'],
    ]
    for (const [name, input, subcause] of cases) {
      const error = errorOf(input)
      expect(error.subcause, name).toBe(subcause)
      expect(error.category, name).toBe('rejected_precondition')
    }
    const nullInput = compileProjection(null as unknown as CompileProjectionInput)
    expect(nullInput.kind).toBe('err')
    if (nullInput.kind === 'err') expect(nullInput.error.subcause).toBe('projection-input-incomplete')
    // 失败封套可判：无副作用、不可重试、无需对账（fail-closed 而非降级）
    const envelope = errorOf(mutate(baseInput(), { companyId: undefined }))
    expect([envelope.retryable, envelope.sideEffectPossible, envelope.reconcileRequired]).toEqual([false, false, false])
  })

  it('不填缺省：承载了 sandbox/approval/evidence 但无来源声明 → 逐段损失而非默认值', () => {
    const projection = okProjection(baseInput({ deployment: { carriedSegments: FULL_CARRIERS } }))
    for (const segment of ['sandbox', 'approval', 'evidence'] as const) {
      expect(projection.segments[segment].enabled, segment).toBe(false)
      expect(projection.segments[segment].note, segment).toContain('input-lacks-source')
      expect(projection.unsupportedSegments, segment).toContain(segment)
    }
    expect(JSON.stringify(projection)).not.toMatch(/workspace-write|read-only|"ask"|"never"/)
  })

  it('persona 恒 soft 且可选：无引用＝不出现、不计损失；不填默认人设', () => {
    const projection = okProjection(baseInput({ deployment: fullDeployment({ personaRefs: [] }) }))
    expect(projection.segments.persona.enabled).toBe(false)
    expect(projection.segments.persona.sourceRefs).toEqual([])
    expect(projection.segments.persona.note).toBe('absent:optional-soft-segment')
    expect(projection.unsupportedSegments).not.toContain('persona')
  })
})

// ── 八、PRM-G7 可复算（纯函数＋显式输入＋摘要可重算） ──

describe('PRM-G7 可复算：digest 形式封闭、可由投影体独立重算', () => {
  it('digest 形如 sha256:<64 hex>，并由投影体复算一致', () => {
    const projection = okProjection(baseInput())
    expect(projection.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    const recomputed = projectionDigest(projection)
    expect(recomputed.kind).toBe('ok')
    if (recomputed.kind === 'ok') expect(recomputed.value).toBe(projection.digest)
  })

  it('摘要覆盖 unsupportedSegments（同一批段不同损失形态不得同摘要）', () => {
    const full = okProjection(baseInput())
    const partial = okProjection(dataOnlyInput())
    expect(full.digest).not.toBe(partial.digest)
    expect(partial.unsupportedSegments.length).toBeGreaterThan(0)
  })

  it('有效期窗口显式可判：过期由调用方按 atMs 判定，生成器不读时钟', () => {
    const projection = okProjection(baseInput())
    const until = projection.validity.until
    expect(until).toBeDefined()
    if (until !== undefined) expect(Date.parse(until)).toBeGreaterThan(Date.parse(projection.validity.from))
  })

  it('输出 JSON 可序列化（无函数/循环/undefined 值）', () => {
    const projection = okProjection(baseInput())
    const text = JSON.stringify(projection)
    expect(text.length).toBeGreaterThan(0)
    expect(text).not.toContain('undefined')
    expect(JSON.parse(text)).toEqual(projection)
  })
})

// ── 九、PRM-G8 宿主子集显式降级（逐段损失，不静默丢弃；NEG-RUN-01 前腿） ──

describe('PRM-G8 宿主子集显式降级：未承载段进损失面并逐段可读', () => {
  it('只承载 identity/plan/validity：四个策略面＋evidence 进损失面，数据段照常编译', () => {
    const projection = okProjection(dataOnlyInput())
    expect(projection.unsupportedSegments).toEqual(['authority', 'tools', 'sandbox', 'approval', 'evidence'])
    for (const segment of ['identity', 'plan', 'validity'] as const) {
      expect(projection.segments[segment].enabled, segment).toBe(true)
    }
    for (const segment of projection.unsupportedSegments) {
      expect(projection.segments[segment].enabled, segment).toBe(false)
      expect(projection.segments[segment].note, segment).toContain('unsupported:host-lacks-carrier')
    }
  })

  it('不静默丢弃：未启用段（persona 除外）必在损失面，损失面段必未启用且保留来源引用', () => {
    const projection = okProjection(dataOnlyInput())
    for (const segment of PROJECTION_SEGMENTS) {
      if (segment === 'persona') continue
      const enabled = projection.segments[segment].enabled
      const listed = projection.unsupportedSegments.includes(segment)
      expect(enabled === listed, segment).toBe(false)
    }
    expect(projection.segments.authority.sourceRefs).toEqual(['grant-1', 'grant-2'])
    expect(projection.segments.tools.sourceRefs).toEqual(['cap-1', 'cap-2'])
    expect(projection.segments.sandbox.sourceRefs).toEqual(['per_task_shortlived'])
  })

  it('承载但无来源＝本部署不可支持（input-lacks-source），不是宿主缺失', () => {
    const projection = okProjection(baseInput({ deployment: { carriedSegments: FULL_CARRIERS } }))
    for (const segment of ['sandbox', 'approval', 'evidence'] as const) {
      expect(projection.segments[segment].note, segment).toContain('unsupported:input-lacks-source')
    }
  })

  it('声明了 persona 引用却无承载 → 进损失面（不得静默丢引用）', () => {
    const projection = okProjection(baseInput({ deployment: { carriedSegments: ['identity', 'plan', 'validity'], personaRefs: ['persona-1'] } }))
    expect(projection.segments.persona.enabled).toBe(false)
    expect(projection.segments.persona.sourceRefs).toEqual(['persona-1'])
    expect(projection.unsupportedSegments).toContain('persona')
  })

  it('全承载＋全来源 → 无损失面、九段全启用、门禁通过', () => {
    const projection = okProjection(baseInput())
    expect(projection.unsupportedSegments).toEqual([])
    for (const segment of PROJECTION_SEGMENTS) {
      expect(projection.segments[segment].enabled, segment).toBe(true)
    }
    const gate = projectionGate(projection)
    expect(gate).toEqual({ launchable: true, blockingSegments: [] })
    // 门禁不冒充授权：只回答段面，不含授权/验签字段
    expect(JSON.stringify(gate)).not.toMatch(/authorized|verified|signed/i)
  })

  it('无部署声明（纯契约 ProjectionInput）＝无承载：生成成功但策略面全损失（fail-closed）', () => {
    const plain: ProjectionInput = {
      companyId: 'company-1',
      workRef: 'work-1',
      planRef: 'plan-1',
      grantRefs: ['grant-1'],
      capabilityRefs: ['cap-1'],
      host: { hostKind: 'claude', version: '1.0.0', bindingRef: 'BIND-CLI-CLAUDE-01' },
      secretTypes: ['per_task_shortlived'],
      validityFrom: '2026-11-01T00:00:00Z',
    }
    const result = compileProjection(plain)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.value.unsupportedSegments).toEqual(['authority', 'tools', 'sandbox', 'approval', 'evidence'])
    expect(projectionGate(result.value).launchable).toBe(false)
  })

  it('NEG-RUN-01 前腿：门禁段缺失 → 不可启动、阻断段逐段可读，且不降级宽权限', () => {
    const projection = okProjection(dataOnlyInput())
    const gate = projectionGate(projection)
    expect(gate.launchable).toBe(false)
    expect(gate.blockingSegments).toEqual([...GATING_SEGMENTS])
    expect(Object.keys(gate).sort()).toEqual(['blockingSegments', 'launchable'])
    // 未承载＝不执行：损失段明确 enabled:false（不是「按缺省宽权限跑」）
    for (const segment of gate.blockingSegments) {
      expect(projection.segments[segment].enabled, segment).toBe(false)
    }
  })
})
