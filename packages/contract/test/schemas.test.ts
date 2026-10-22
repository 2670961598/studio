/**
 * 三格式 schema 测试（v0.1-M1.2/M1.4/M4）
 *  - 契约面：cases.json 新增 evt/rpt 域全绿 + 防恒反证（改坏期望必红）
 *  - 单测面：前缀族双通道命中/拒收、ULID canonical、四桶互斥、两级分类、REPORT 骨架
 * 依据：docs/17-§3（冻结枚举+前缀族+列集）、docs/02 F2-02/F2-04、docs/25-§二 kernel.ClassifiedError、
 *       复查报告 B4（summary sidecar）。
 */
import { describe, expect, it } from 'vitest'
import {
  ClassifiedErrorSchema,
  ERROR_CATEGORIES,
  ERROR_CATEGORIES_COMPLETE,
  EVENT_NAMES,
  EVENT_PREFIX_FAMILIES,
  EXECUTOR_ERROR_CODES,
  EventRecordSchema,
  PLATFORM_ACTIVITY_KINDS,
  SummarySidecarSchema,
  UlidSchema,
  evtSubject,
  extractReportSkeleton,
  isEventName,
  isExecutorErrorCode,
  isPlatformActivityKind,
  rptSubject,
  runCases,
  validateEventRecord,
  validateReportDocument,
  validateSummarySidecar,
} from '../src/index.ts'
import manifest from '../cases.json'

// —— 公共语料 ——————————————————————————————————————————————

const VALID_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

function baseRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: VALID_ULID,
    ts: 1790000000000,
    company: 'demo-corp',
    issue: 'DEMO-42',
    event: 'DISPATCH',
    actor: 'AGENT-1:agent-1',
    attempt: 1,
    level: 2,
    dept: 'departments/工程部',
    tokens: { input: 10, output: 5 },
    ...overrides,
  }
}

const VALID_REPORT = '# 标题\n\n## 结论\n做了什么。\n\n## 改动\n- a.ts\n\n## 验证\n- 闸门 exit=0'
const VALID_SUMMARY = { schema: 'summary/v1', conclusion: '完成', changed_files: ['a.ts'] }

// —— 契约面：evt/rpt 域 ——————————————————————————————————————

describe('契约语料（evt/rpt 域）', () => {
  it('evt 6 条 + rpt 3 条全绿（P6 增补 JUDGE_ 前缀族正例 C-evt-006，studio-dev-160 §6.5）', async () => {
    const r = await runCases(manifest, { evt: evtSubject, rpt: rptSubject }, { domains: ['evt', 'rpt'] })
    expect(r.failed).toEqual([])
    expect(r.total).toBe(9)
    expect(r.passed).toBe(9)
  })

  it('防恒反证：改坏 C-evt-003 期望的错误类别必红', async () => {
    const bad = structuredClone(manifest) as { version: number; cases: { id: string; expected: { err: { category: string } } }[] }
    const target = bad.cases.find((c) => c.id === 'C-evt-003')!
    target.expected.err.category = 'LLM_FAIL'
    const r = await runCases(bad, { evt: evtSubject, rpt: rptSubject }, { domains: ['evt', 'rpt'] })
    expect(r.passed).toBe(8)
    expect(r.failed[0]?.id).toBe('C-evt-003')
  })
})

// —— 事件名：冻结枚举 + 前缀族双通道（17-§3）——————————————————

describe('事件名双通道（17-§3 冻结清单）', () => {
  it('冻结清单计数互证：25 具体名 + 3 前缀族 = 28 类（P3 增补两具体名；P6 增补 JUDGE_ 前缀族——studio-dev-160 §6.5，2026-10-22 全批）', () => {
    expect(EVENT_NAMES).toHaveLength(25)
    expect(EVENT_PREFIX_FAMILIES).toEqual(['GW_', 'REPORT_', 'JUDGE_'])
  })

  it('23 个具体事件名全部命中枚举通道', () => {
    for (const name of EVENT_NAMES) expect(isEventName(name)).toBe(true)
  })

  it('前缀族正则通道：GW_/REPORT_/JUDGE_ 后接大写段放行（含多段下划线）', () => {
    for (const name of ['GW_COMMENT', 'GW_KB_SEARCH', 'REPORT_DAILY', 'REPORT_MONTHLY_2026_10', 'JUDGE_OK', 'JUDGE_FALLBACK', 'JUDGE_SITE_BREAKER_OPEN']) {
      expect(isEventName(name)).toBe(true)
    }
  })

  it('拒收：裸前缀、小写、无下划线续接、拼错的具体名、空串', () => {
    for (const name of ['GW_', 'REPORT_', 'JUDGE_', 'judge_ok', 'Judge_Fallback', 'REPORTX', 'DISPATCHED', '']) {
      expect(isEventName(name)).toBe(false)
    }
  })
})

// —— PlatformActivity.kind 冻结词表（25-§3.2 v1.6 修订刀第 3 条）——————————

describe('PlatformActivity.kind 冻结词表（三实现实际产出归并）', () => {
  it('六词冻结：created/commented/transitioned/field-set/change/unknown，序即成员序', () => {
    expect([...PLATFORM_ACTIVITY_KINDS]).toEqual([
      'created',
      'commented',
      'transitioned',
      'field-set',
      'change',
      'unknown',
    ])
  })

  it('六词全部命中词表判定', () => {
    for (const kind of PLATFORM_ACTIVITY_KINDS) expect(isPlatformActivityKind(kind)).toBe(true)
  })

  it('越界负测：yt 旧透传串（ArticlesCategory/IssueLinksCategory）、拼错形、大小写变体、空串一律拒收', () => {
    for (const bad of [
      'ArticlesCategory',
      'IssueLinksCategory',
      'IssueCreatedCategory',
      'created2',
      'fieldset',
      'field_set',
      'Created',
      'FIELD-SET',
      'TRANSITIONED',
      '',
    ]) {
      expect(isPlatformActivityKind(bad)).toBe(false)
    }
  })
})

// —— StreamEvent.turn_end.errorCode 冻结词表（25-§3.1 末 v1.7 裁决，102-P2-③）—————

describe('executor errorCode 冻结词表（102-P2：已产码收编）', () => {
  it('三词冻结：AUTH/MISSING_CREDENTIAL/EXTERNAL_RATE_LIMIT，序即成员序', () => {
    expect([...EXECUTOR_ERROR_CODES]).toEqual(['AUTH', 'MISSING_CREDENTIAL', 'EXTERNAL_RATE_LIMIT'])
  })

  it('三词全部命中词表判定（红向）', () => {
    for (const code of EXECUTOR_ERROR_CODES) expect(isExecutorErrorCode(code)).toBe(true)
  })

  it('收编账：dsh 两码（v1.5 先行）+ daemon fake 既成值（102 E7 漂移）在册——词表冻结如实反映已产码', () => {
    // E7：apps/daemon/src/engine/fakes.ts 已产 EXTERNAL_RATE_LIMIT（收编不改其义）；
    // v1.5 dsh 先行两码（docs/31-§7 P-04/A4）——三词全部来自「已产」而非臆造
    expect(isExecutorErrorCode('AUTH')).toBe(true)
    expect(isExecutorErrorCode('MISSING_CREDENTIAL')).toBe(true)
    expect(isExecutorErrorCode('EXTERNAL_RATE_LIMIT')).toBe(true)
  })

  it('越界负测：缺前缀变体、复数形漂移、小写、多词拼接、空串一律拒收（绿向防漂移）', () => {
    for (const bad of [
      'RATE_LIMIT', // 缺 EXTERNAL_ 前缀的缩写漂移
      'MISSING_CREDENTIALS', // 复数形漂移
      'auth', // 小写变体
      'AUTH_RATE_LIMIT', // 两码误拼
      'EXTERNAL_RATE_LIMITED', // 时态漂移
      '',
    ]) {
      expect(isExecutorErrorCode(bad)).toBe(false)
    }
  })
})

// —— ULID canonical ——————————————————————————————————————————

describe('ULID 格式（canonical）', () => {
  it('26 字符 Crockford 大写且首字符 ≤7 放行（含首字符边界 7）', () => {
    expect(UlidSchema.safeParse(VALID_ULID).success).toBe(true)
    expect(UlidSchema.safeParse('7ZZZZZZZZZZZZZZZZZZZZZZZZZ').success).toBe(true)
  })

  it('拒收：长度错、小写、含歧义字符 I/L/O/U、首字符越界 8', () => {
    for (const bad of [
      '01ARZ3NDEKTSV4RRFFQ69G5FA', // 25 位
      '01ARZ3NDEKTSV4RRFFQ69G5FAVZ', // 27 位
      '01arz3ndektsv4rrffq69g5fav', // 小写
      '01ARZ3NDEKTSV4RRFFQ69G5FAI', // 含 I
      '8ZZZZZZZZZZZZZZZZZZZZZZZZZ', // 首字符 8（>48bit 时间戳上限）
    ]) {
      expect(UlidSchema.safeParse(bad).success).toBe(false)
    }
  })
})

// —— tokens 四桶（F2-04）——————————————————————————————————————

describe('tokens 四桶互斥（F2-04 列名）', () => {
  it('四桶任一（含零值桶）放行', () => {
    for (const tokens of [{ input: 0 }, { output: 120 }, { cache_read: 8 }, { cache_creation: 3 }, { input: 1, output: 2, cache_read: 3, cache_creation: 4 }]) {
      expect(validateEventRecord(baseRecord({ tokens })).ok).toBe(true)
    }
  })

  it('拒收：空对象（无任何桶）、未知桶名、负值、非整数', () => {
    for (const tokens of [{}, { reasoning: 5 }, { input: -1 }, { input: 1.5 }]) {
      const r = validateEventRecord(baseRecord({ tokens }))
      expect(r.ok).toBe(false)
    }
  })
})

// —— events 记录：列集与边界 ——————————————————————————————————

describe('events 记录（17-§3 列集）', () => {
  it('最小必填（可选计量字段全省）放行', () => {
    expect(validateEventRecord(baseRecord()).ok).toBe(true)
  })

  it('拒收：未知列（strict）、attempt=0、level 越界、空 actor', () => {
    expect(validateEventRecord(baseRecord({ extra_col: 1 })).ok).toBe(false)
    expect(validateEventRecord(baseRecord({ attempt: 0 })).ok).toBe(false)
    expect(validateEventRecord(baseRecord({ level: 10 })).ok).toBe(false)
    expect(validateEventRecord(baseRecord({ level: 0 })).ok).toBe(false)
    expect(validateEventRecord(baseRecord({ actor: '' })).ok).toBe(false)
  })

  it('level=1 放行（agent 等级 1-9，04-§四）；EventRecordSchema.parse 产出同名类型', () => {
    expect(validateEventRecord(baseRecord({ level: 1 })).ok).toBe(true)
    expect(EventRecordSchema.safeParse(baseRecord()).success).toBe(true)
  })
})

// —— 两级错误分类（17-§9 / kernel.ErrorCategory）———————————————

describe('两级错误分类（kernel 枚举本体投影）', () => {
  it('ERROR_CATEGORIES 11 类且穷尽护栏为真', () => {
    expect(ERROR_CATEGORIES).toHaveLength(11)
    expect(ERROR_CATEGORIES_COMPLETE).toBe(true)
  })

  it('合法 ClassifiedError 放行（detail 可选）', () => {
    expect(ClassifiedErrorSchema.safeParse({ category: 'STALL', subcause: 'wall' }).success).toBe(true)
    expect(ClassifiedErrorSchema.safeParse({ category: 'GATE_FAIL', subcause: 'timeout', detail: 'exit=124' }).success).toBe(true)
  })

  it('拒收：未知 category、空 subcause、缺 subcause、未知键', () => {
    expect(ClassifiedErrorSchema.safeParse({ category: 'BOOM', subcause: 'x' }).success).toBe(false)
    expect(ClassifiedErrorSchema.safeParse({ category: 'STALL', subcause: '' }).success).toBe(false)
    expect(ClassifiedErrorSchema.safeParse({ category: 'STALL' }).success).toBe(false)
    expect(ClassifiedErrorSchema.safeParse({ category: 'STALL', subcause: 'x', retry: true }).success).toBe(false)
  })
})

// —— REPORT 骨架 + summary sidecar（17-§3 末行 / B4）———————————

describe('REPORT 骨架（拟稿节集：结论/改动/验证）', () => {
  it('必填节齐放行；额外节（风险等）不拒收', () => {
    expect(validateReportDocument(`${VALID_REPORT}\n\n## 风险\n无`).ok).toBe(true)
  })

  it('拒收：缺任一必填节（issues 指名缺哪个节）、节文空、无标题、非字符串输入', () => {
    const missing = validateReportDocument('# 标题\n\n## 结论\n做了。\n\n## 改动\n- a.ts')
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.issues.some((i) => i.path === 'sections.验证' && i.message.includes('验证'))).toBe(true)
    }
    expect(validateReportDocument('# 标题\n\n## 结论\n\n## 改动\n- a.ts\n\n## 验证\n- x').ok).toBe(false)
    expect(validateReportDocument('## 结论\n做了。\n\n## 改动\n- a.ts\n\n## 验证\n- x').ok).toBe(false)
    expect(validateReportDocument(42).ok).toBe(false)
  })

  it('提取器：### 归上一节正文、\\r\\n 兼容、标题前引导文不进骨架', () => {
    const view = extractReportSkeleton('引导文\n# 标题\n\n## 结论\n一句话\n### 佐证\n细节\n')
    expect(view.title).toBe('标题')
    expect(view.sections['结论']).toContain('### 佐证')
    expect(view.sections['结论']).toContain('细节')
    expect('引导文' in view.sections).toBe(false)
  })
})

describe('summary.json sidecar（B4：结论/改动文件/打回理由）', () => {
  it('合法：rejection_reason 可省；changed_files 可为空数组（纯分析单）', () => {
    expect(validateSummarySidecar(VALID_SUMMARY).ok).toBe(true)
    expect(
      validateSummarySidecar({ ...VALID_SUMMARY, rejection_reason: '闸门红：测试未过' }).ok,
    ).toBe(true)
    expect(validateSummarySidecar({ ...VALID_SUMMARY, changed_files: [] }).ok).toBe(true)
  })

  it('拒收：版本字面量错、conclusion 空、changed_files 含空路径、未知键', () => {
    expect(validateSummarySidecar({ ...VALID_SUMMARY, schema: 'summary/v2' }).ok).toBe(false)
    expect(validateSummarySidecar({ ...VALID_SUMMARY, conclusion: '' }).ok).toBe(false)
    expect(validateSummarySidecar({ ...VALID_SUMMARY, changed_files: [''] }).ok).toBe(false)
    expect(validateSummarySidecar({ ...VALID_SUMMARY, extra: 1 }).ok).toBe(false)
  })

  it('SummarySidecarSchema 与 zod 推断一致（parse 回读）', () => {
    const parsed = SummarySidecarSchema.parse(VALID_SUMMARY)
    expect(parsed.conclusion).toBe('完成')
  })
})

// —— evtSubject 抛错形状（CASES.md err 通道）———————————————————

describe('evtSubject 抛错通道', () => {
  it('合法返回 {ok:true}；坏事件名抛 CONFIG_INVALID/evt/invalid:event', () => {
    expect(evtSubject(baseRecord())).toEqual({ ok: true })
    let thrown: unknown
    try {
      evtSubject(baseRecord({ event: 'DISPATCHED' }))
    } catch (e) {
      thrown = e
    }
    const shape = (thrown ?? {}) as { category?: unknown; subcause?: unknown }
    expect(shape.category).toBe('CONFIG_INVALID')
    expect(shape.subcause).toBe('evt/invalid:event')
  })
})
