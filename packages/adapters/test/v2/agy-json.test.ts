/**
 * agy-json.test.ts —— agy 终稿解析/失败分类/脱敏纯函数直证（team task-140；LANE-X）
 *
 * 冻结验收口径（task-140 交付物③的失败分类面；docs/quality/agy-adapter.md §五）：
 *   ① classifyAgyError：实测样本（auth / eligibility / region）各归其类；auth→AUTH、
 *      quota→EXTERNAL_RATE_LIMIT（EXECUTOR_ERROR_CODES 冻结词表成员）；词表外无码（文本承载）；
 *      专项优先次序——auth 文案含 "timed out" 仍归 auth、"i/o timeout" 归 network、
 *      资格样本含 "Verify your account" 不被 auth 抢走；未知文本落 other 不猜
 *   ② sanitizeAgyText：凭据形态（Bearer / JWT / AIza / ya29. / JSON token 值 / URL 口令 /
 *      长 hex / 长 base64）一律打码，ANSI 剥除、空白折叠、截断——凭据永不入事件
 *   ③ agyErrorSummary：stderr 末行 `AGY_ERROR: {…}` 摘要（标量拼 key=value、嵌套只留键、
 *      值过脱敏）；非 JSON 原文脱敏；无行 undefined
 *   ④ parseAgyJson：成功面只认 status=SUCCESS＋response 非空＋finished_reason 不在场；
 *      finished_reason 在场（print_timeout/interrupted/error/未知/形状坏）＝残稿不计完成且
 *      CLI 上报 usage 照记；status=ERROR 按 error 文本分类并并入 stderr 结构化行；
 *      stdout 空＋AGY_ERROR 行＝失败面；坏 JSON / 非对象 / status 未知如实落 bad-*（不猜）
 *   ⑤ task-149 真机回放：ERROR＋finished_reason=print_timeout＋残稿＋usage 全 0 → timeout 面
 *      partial=true、usage 按未上报不落键（usageUnreported）；agyOutcomeHasModelTurn＝有效模型
 *      回合证据判据（turns 记账）；decodeAgyStdout＝多字节 UTF-8 跨分片统一解码
 *
 * 依据：docs/17-§6（收割口径：不伪造成功）、docs/25-§二（凭据不入日志）、contract
 *   schemas/errors.ts EXECUTOR_ERROR_CODES；样本＝task-140/149 实测事实单的结构回放（非保证面）。
 *   夹具凭据一律 fake- 前缀低熵值（无真实凭证）。本文件 <600 行阈内。
 */
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  agyErrorSummary,
  agyOutcomeHasModelTurn,
  classifyAgyError,
  decodeAgyStdout,
  parseAgyJson,
  sanitizeAgyText,
} from '../../src/agy-json.ts'

const AUTH_SAMPLE = 'authentication failed or timed out'
const ELIGIBILITY_SAMPLE =
  'Eligibility check failed: Your current account is not eligible for Antigravity. Verify your account to continue.'
const REGION_SAMPLE = 'location not supported'

/** 实测成功终稿形态（usage 四桶：thinking 已含在 output——total=12297+121） */
const SUCCESS_OBJ = {
  conversation_id: 'conv-abc-123',
  status: 'SUCCESS',
  response: '演练完成：产出一行结论。',
  duration_seconds: 5.18,
  num_turns: 1,
  usage: { input_tokens: 12297, output_tokens: 121, thinking_tokens: 119, cache_read_tokens: 0, total_tokens: 12418 },
}
const USAGE = { input: 12297, output: 121, cache_read: 0 } // cache_read 上报即落键（含 0——streams.ts 同口径）

describe('classifyAgyError（实测样本归纳＋专项优先次序）', () => {
  it('实测样本：auth→AUTH 码；eligibility / region→词表外无码，detail＝提示＋脱敏原文', () => {
    const auth = classifyAgyError(AUTH_SAMPLE)
    expect(auth.kind).toBe('auth')
    expect(auth.code).toBe('AUTH')
    expect(auth.detail).toMatch(/^agy 鉴权失败/)
    expect(auth.detail).toContain(`（原文：${AUTH_SAMPLE}）`)

    const elig = classifyAgyError(ELIGIBILITY_SAMPLE)
    expect(elig.kind).toBe('eligibility')
    expect(elig).not.toHaveProperty('code')
    expect(elig.detail).toMatch(/^agy 资格检查未过/)

    const region = classifyAgyError(REGION_SAMPLE)
    expect(region.kind).toBe('region')
    expect(region).not.toHaveProperty('code')
    expect(region.detail).toContain('地区限制')
  })

  it('quota→EXTERNAL_RATE_LIMIT 码（额度/429/限速样本）；network / timeout / other 无码', () => {
    for (const text of ['Resource has been exhausted (e.g. check quota).', 'HTTP 429 Too Many Requests', 'rate limit exceeded']) {
      const cls = classifyAgyError(text)
      expect(cls.kind).toBe('quota')
      expect(cls.code).toBe('EXTERNAL_RATE_LIMIT')
    }
    const cases: readonly [string, string][] = [
      ['dial tcp proxy.invalid:7897: connect: connection refused', 'network'],
      ['read tcp: i/o timeout', 'network'],
      ['Get "https://example.invalid/v1": service_unavailable', 'network'],
      ['context deadline exceeded', 'timeout'],
      ['upstream request timeout', 'timeout'],
      ['This client is no longer supported.', 'other'],
      ['', 'other'],
    ]
    for (const [text, kind] of cases) {
      const cls = classifyAgyError(text)
      expect(cls.kind, text).toBe(kind)
      expect(cls).not.toHaveProperty('code')
    }
    expect(classifyAgyError('').detail).toBe('agy 失败（未分类样本）') // 空文＝只留提示，不拼「原文：」
  })

  it('专项优先次序：auth 含 "timed out" 仍归 auth；"i/o timeout" 归 network；资格样本不被 auth 抢走', () => {
    expect(classifyAgyError(AUTH_SAMPLE).kind).toBe('auth') // 非 timeout
    expect(classifyAgyError('read tcp: i/o timeout').kind).toBe('network') // 非 timeout
    expect(classifyAgyError(ELIGIBILITY_SAMPLE).kind).toBe('eligibility') // 非 auth（含 "Verify your account"）
    expect(classifyAgyError(`${REGION_SAMPLE}: eligibility check skipped`).kind).toBe('region') // region 先于 eligibility
  })

  it('分类前脱敏：凭据形态不进 detail', () => {
    // 夹具值 10 字符：满足脱敏正则（≥8），低于仓面扫描 bearer 阈值（显式头 12 / 裸 20）——夹具不仿真凭据形态
    const cls = classifyAgyError('authentication failed; Authorization: Bearer fake-tok-9')
    expect(cls.kind).toBe('auth')
    expect(cls.detail).not.toContain('fake-tok-9')
    expect(cls.detail).toContain('Bearer [REDACTED]')
  })
})

describe('sanitizeAgyText（凭据永不入事件）', () => {
  it('Bearer / JWT / AIza / ya29. / JSON token 值 / URL 口令 / 长 hex / 长 base64 一律打码', () => {
    const cases: readonly [string, string][] = [
      ['Authorization: Bearer fake-tok-9', 'Authorization: Bearer [REDACTED]'],
      [`Authorization: Bearer ${'fake-'.repeat(5)}`, 'Authorization: Bearer [REDACTED]'], // 长值运行期拼接（仓面不留静态形态）
      ['t=eyJaaaaaaaa.bbbbbbbb.cccccccc x', 't=[REDACTED] x'],
      [`key AIza${'a'.repeat(35)} tail`, 'key [REDACTED] tail'],
      ['grant ya29.fake-credential-0000 end', 'grant [REDACTED] end'],
      ['{"access_token":"fake-aaaaaaaaaaaaaaaa","refresh_token":"fake-bbbbbbbbbbbbbbbb"}', '{"access_token":"[REDACTED]","refresh_token":"[REDACTED]"}'],
      ['http://user:fakepass@proxy.invalid:8080/path', 'http://user:[REDACTED]@proxy.invalid:8080/path'],
      [`hex ${'ab'.repeat(20)} tail`, 'hex [REDACTED] tail'],
      ['sk-fake-abcdefghijklmnop', '[REDACTED]'],
    ]
    for (const [input, expected] of cases) {
      expect(sanitizeAgyText(input), input).toBe(expected)
    }
  })

  it('长 base64 打码（含 = 填充）；ANSI 剥除；空白折叠；超长截断', () => {
    expect(sanitizeAgyText(`blob ${'QmFzZTY0'.repeat(6)}== tail`)).toBe('blob [REDACTED] tail')
    expect(sanitizeAgyText('\x1b[31mred\x1b[0m plain')).toBe('red plain')
    expect(sanitizeAgyText('a  b\n\n   c\t')).toBe('a b c')
    expect(sanitizeAgyText('ab-'.repeat(200), 10)).toBe('ab-ab-ab-a')
    expect(sanitizeAgyText('普通错误文本：保持原样。')).toBe('普通错误文本：保持原样。')
  })
})

describe('agyErrorSummary（stderr 结构化错误行）', () => {
  it('取最后一行 AGY_ERROR：JSON 只拼标量 key=value（前 8 个），嵌套只留键名，值过脱敏', () => {
    const summary = agyErrorSummary(
      [
        'warning: something before',
        'AGY_ERROR: {"status":"UNAUTHENTICATED","code":16,"retryable":false,"error_id":"req-abc","details":{"tasks":["t1"]},"access_token":"fake-secret-token-000000"}',
      ].join('\n'),
    )
    expect(summary).toBe(
      'AGY_ERROR status=UNAUTHENTICATED code=16 retryable=false error_id=req-abc details={…} access_token=[REDACTED]',
    )
  })

  it('非 JSON 原文脱敏；无 AGY_ERROR 行或空载荷 → undefined；多行取末行', () => {
    expect(agyErrorSummary('AGY_ERROR: boom Bearer fake-tok-9')).toBe('boom Bearer [REDACTED]')
    expect(agyErrorSummary('just a warning')).toBeUndefined()
    expect(agyErrorSummary('AGY_ERROR: ')).toBeUndefined()
    expect(agyErrorSummary('')).toBeUndefined()
    expect(agyErrorSummary('AGY_ERROR: {"status":"FIRST"}\nAGY_ERROR: {"status":"SECOND"}')).toBe('AGY_ERROR status=SECOND')
    expect(agyErrorSummary('  AGY_ERROR: [1,2]')).toBe('[1,2]') // 非对象 JSON＝原文脱敏
  })
})

describe('parseAgyJson（终稿解析：成功只认 SUCCESS＋非空 response＋无 finished_reason）', () => {
  it('成功面：response / usage 三新键 / num_turns / conversation_id；cache_read 上报即落键（含 0），未上报不落键', () => {
    expect(parseAgyJson(JSON.stringify(SUCCESS_OBJ))).toEqual({
      kind: 'success',
      response: SUCCESS_OBJ.response,
      conversationId: 'conv-abc-123',
      numTurns: 1,
      usage: USAGE,
    })
    expect(parseAgyJson(JSON.stringify({ ...SUCCESS_OBJ, usage: { input_tokens: 10, output_tokens: 5 } }))).toMatchObject({
      usage: { input: 10, output: 5 },
    })
    expect(parseAgyJson(JSON.stringify({ ...SUCCESS_OBJ, usage: { input_tokens: 10, output_tokens: 5 } }))).not.toHaveProperty('usage.cache_read')
    const noUsage = parseAgyJson(JSON.stringify({ status: 'SUCCESS', response: 'ok' }))
    expect(noUsage).toEqual({ kind: 'success', response: 'ok' }) // 未上报＝不编造
    const badUsage = parseAgyJson(JSON.stringify({ status: 'SUCCESS', response: 'ok', usage: { input_tokens: 'many', output_tokens: 5 } }))
    expect(badUsage).not.toHaveProperty('usage') // 形状坏不猜
  })

  it('finished_reason 在场＝残稿不计完成：print_timeout→timeout（usage 照记）；interrupted / 未知→other', () => {
    const cut = parseAgyJson(JSON.stringify({ ...SUCCESS_OBJ, response: '残稿首段', finished_reason: 'print_timeout' }), 'AGY_ERROR: {"status":"DEADLINE_EXCEEDED"}')
    expect(cut.kind).toBe('error')
    expect(cut).toMatchObject({ kind: 'error', errorClass: { kind: 'timeout' }, conversationId: 'conv-abc-123', numTurns: 1, usage: USAGE })
    if (cut.kind !== 'error') throw new Error('期望 error 面')
    expect(cut.errorClass).not.toHaveProperty('code')
    expect(cut.errorClass.detail).toContain('残稿 4 字符不作输出')
    expect(cut.errorClass.detail).toContain('残稿首段')
    expect(cut.errorClass.detail).toContain('AGY_ERROR status=DEADLINE_EXCEEDED')

    const interrupted = parseAgyJson(JSON.stringify({ status: 'SUCCESS', response: '写到一半', finished_reason: 'interrupted' }))
    expect(interrupted).toMatchObject({ kind: 'error', errorClass: { kind: 'other' } })
    const unknown = parseAgyJson(JSON.stringify({ status: 'SUCCESS', response: 'x', finished_reason: 'teleported' }))
    expect(unknown).toMatchObject({ kind: 'error', errorClass: { kind: 'other' } })
    if (unknown.kind === 'error') expect(unknown.errorClass.detail).toContain('teleported')
    const shaped = parseAgyJson(JSON.stringify({ status: 'SUCCESS', response: 'x', finished_reason: 7 }))
    expect(shaped).toMatchObject({ kind: 'error', errorClass: { kind: 'other' } })
    if (shaped.kind === 'error') expect(shaped.errorClass.detail).toContain('形状坏')
  })

  it('finished_reason=error：按 error 文本分类（stderr 行并入）；无文本→other；null＝不在场', () => {
    const failed = parseAgyJson(
      JSON.stringify({ status: 'SUCCESS', response: '残', finished_reason: 'error', error: { message: 'Quota exceeded', code: 8 } }),
    )
    expect(failed).toMatchObject({ kind: 'error', errorClass: { kind: 'quota', code: 'EXTERNAL_RATE_LIMIT' } })
    expect(parseAgyJson(JSON.stringify({ status: 'SUCCESS', response: '残', finished_reason: 'error' }))).toMatchObject({
      kind: 'error',
      errorClass: { kind: 'other' },
    })
    expect(parseAgyJson(JSON.stringify({ ...SUCCESS_OBJ, finished_reason: null }))).toMatchObject({ kind: 'success' })
  })

  it('status=ERROR：按 error 文本分类并并入 stderr AGY_ERROR 行；usage / conversation_id 照记', () => {
    const out = parseAgyJson(
      JSON.stringify({ status: 'ERROR', error: AUTH_SAMPLE, conversation_id: 'conv-err-1', num_turns: 0, usage: { input_tokens: 7, output_tokens: 0 } }),
      'noise\nAGY_ERROR: {"status":"UNAUTHENTICATED","code":16}',
    )
    expect(out).toMatchObject({
      kind: 'error',
      errorClass: { kind: 'auth', code: 'AUTH' },
      conversationId: 'conv-err-1',
      numTurns: 0,
      usage: { input: 7, output: 0 },
    })
    if (out.kind === 'error') expect(out.errorClass.detail).toContain('AGY_ERROR status=UNAUTHENTICATED code=16')
    expect(parseAgyJson(JSON.stringify({ status: 'ERROR', error: { message: REGION_SAMPLE } }))).toMatchObject({
      kind: 'error',
      errorClass: { kind: 'region' },
    })
  })

  it('stdout 空而 stderr 有 AGY_ERROR 行＝失败面；SUCCESS 空输出不伪造成功；坏稿如实落 bad-*（不猜）', () => {
    const empty = parseAgyJson('', 'AGY_ERROR: {"status":"UNAUTHENTICATED"}')
    expect(empty).toMatchObject({ kind: 'error', errorClass: { kind: 'auth', code: 'AUTH' } })
    expect(parseAgyJson('', 'just a warning')).toEqual({ kind: 'bad-json', reason: 'stdout 为空' })
    expect(parseAgyJson('   ')).toEqual({ kind: 'bad-json', reason: 'stdout 为空' })

    const blank = parseAgyJson(JSON.stringify({ ...SUCCESS_OBJ, response: '   ' }))
    expect(blank).toMatchObject({ kind: 'error', errorClass: { kind: 'other' }, usage: USAGE })

    const bad = parseAgyJson('not-json-at-all')
    expect(bad.kind).toBe('bad-json')
    if (bad.kind === 'bad-json') expect(bad.reason).toContain('not-json-at-all')
    expect(parseAgyJson('[1,2]')).toEqual({ kind: 'bad-shape', reason: 'JSON 非 object（收到 array）' })
    expect(parseAgyJson('42')).toEqual({ kind: 'bad-shape', reason: 'JSON 非 object（收到 number）' })
    expect(parseAgyJson('{"response":"x"}')).toEqual({ kind: 'bad-shape', reason: 'status 缺失/未知（收到 undefined）' })
    expect(parseAgyJson(JSON.stringify({ status: 'MAYBE', response: 'x' }))).toEqual({
      kind: 'bad-shape',
      reason: 'status 缺失/未知（收到 "MAYBE"）',
    })
    expect(parseAgyJson(JSON.stringify({ status: 'SUCCESS', response: 42 }))).toEqual({
      kind: 'bad-shape',
      reason: 'status=SUCCESS 但 response 非 string',
    })
  })
})

/** task-149 真机回放（T3 结构样本，文本占位）：超时终稿挂 status=ERROR＋finished_reason，有残稿而 usage 全 0 */
const PRINT_TIMEOUT_OBJ = {
  status: 'ERROR',
  error: 'print timeout after 1m0s with the turn still in progress; the response is partial',
  response: '长文残稿：结论未收尾。',
  duration_seconds: 9,
  num_turns: 1,
  usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 },
  finished_reason: 'print_timeout',
}
const DEADLINE_STDERR = 'noise line\nAGY_ERROR: {"status":"DEADLINE_EXCEEDED","reason":"print_timeout","retryable":false}'
const OTHER = { kind: 'other', detail: 'x' } as const

describe('parseAgyJson · print 超时真机形（task-149②：finished_reason 先于 status 采信；usage 全 0＝未上报）', () => {
  it('ERROR＋print_timeout＋残稿＋usage 全 0 → timeout 面：partial=true、usage 不落键、usageUnreported、文本标注', () => {
    const out = parseAgyJson(JSON.stringify(PRINT_TIMEOUT_OBJ), DEADLINE_STDERR)
    expect(out).toEqual({
      kind: 'error',
      errorClass: { kind: 'timeout', detail: expect.stringContaining('print 超时（--print-timeout 到点') },
      numTurns: 1,
      usageUnreported: true,
      partial: true,
    })
    expect(out).not.toHaveProperty('usage') // 全 0 不是「CLI 上报的用量」：不伪造零账
    if (out.kind !== 'error') throw new Error('期望 error 面')
    expect(out.errorClass).not.toHaveProperty('code') // timeout 在 EXECUTOR_ERROR_CODES 词表外：文本承载
    expect(out.errorClass.detail).toContain(`残稿 ${String(PRINT_TIMEOUT_OBJ.response.length)} 字符不作输出`)
    expect(out.errorClass.detail).toContain('partial=true')
    expect(out.errorClass.detail).toContain('usage 未上报（CLI 未上报（超时）')
    expect(out.errorClass.detail).toContain('AGY_ERROR status=DEADLINE_EXCEEDED reason=print_timeout retryable=false')
  })

  it('print_timeout 面 usage 缺席同样按未上报；无残稿 → partial 不落、文本标注 partial=false＋无残稿', () => {
    const noUsage = { ...PRINT_TIMEOUT_OBJ }
    delete (noUsage as { usage?: unknown }).usage
    const absent = parseAgyJson(JSON.stringify(noUsage))
    expect(absent).toMatchObject({ kind: 'error', numTurns: 1, usageUnreported: true, partial: true })
    expect(absent).not.toHaveProperty('usage')
    const bare = parseAgyJson(JSON.stringify({ ...noUsage, response: '' }))
    expect(bare).toMatchObject({ kind: 'error', usageUnreported: true })
    expect(bare).not.toHaveProperty('partial')
    expect(bare).not.toHaveProperty('usage')
    if (bare.kind === 'error') {
      expect(bare.errorClass.detail).toContain('partial=false；usage 未上报')
      expect(bare.errorClass.detail).toContain('无残稿')
    }
  })

  it('print_timeout 面 CLI 如实上报非零 usage → 照记真账（不按未上报）；非超时面 usage 全 0 口径不变（上报即落键）', () => {
    const reported = parseAgyJson(JSON.stringify({ ...SUCCESS_OBJ, response: '残稿首段', finished_reason: 'print_timeout' }))
    expect(reported).toMatchObject({ kind: 'error', usage: USAGE, numTurns: 1, partial: true })
    expect(reported).not.toHaveProperty('usageUnreported')
    const zeroOnOtherFace = parseAgyJson(JSON.stringify({ status: 'ERROR', error: 'boom', usage: { input_tokens: 0, output_tokens: 0 } }))
    expect(zeroOnOtherFace).toMatchObject({ kind: 'error', usage: { input: 0, output: 0 } })
    expect(zeroOnOtherFace).not.toHaveProperty('usageUnreported')
  })

  it('ERROR＋finished_reason=error/interrupted：先按 finished_reason 分支（残稿标注 partial=true）', () => {
    const failed = parseAgyJson(JSON.stringify({ status: 'ERROR', error: 'Usage limit exceeded', response: '残', finished_reason: 'error' }))
    expect(failed).toMatchObject({ kind: 'error', errorClass: { kind: 'quota', code: 'EXTERNAL_RATE_LIMIT' }, partial: true })
    const interrupted = parseAgyJson(JSON.stringify({ status: 'ERROR', error: 'interrupted', response: '残', finished_reason: 'interrupted' }))
    expect(interrupted).toMatchObject({ kind: 'error', errorClass: { kind: 'other' }, partial: true })
  })
})

describe('agyOutcomeHasModelTurn（task-149③：turns 记账的有效模型回合证据）', () => {
  it('成功恒真；失败面须有残稿或非零 usage（全 0 不是证据）；坏稿面为假', () => {
    expect(agyOutcomeHasModelTurn({ kind: 'success', response: 'ok' })).toBe(true)
    expect(agyOutcomeHasModelTurn({ kind: 'error', errorClass: OTHER, numTurns: 1 })).toBe(false) // 自报 num_turns 不算证据
    expect(agyOutcomeHasModelTurn({ kind: 'error', errorClass: OTHER, numTurns: 1, usage: { input: 0, output: 0 } })).toBe(false)
    expect(agyOutcomeHasModelTurn({ kind: 'error', errorClass: OTHER, numTurns: 0, usage: { input: 31, output: 2 } })).toBe(true)
    expect(agyOutcomeHasModelTurn({ kind: 'error', errorClass: OTHER, partial: true })).toBe(true)
    expect(agyOutcomeHasModelTurn({ kind: 'bad-json', reason: 'stdout 为空' })).toBe(false)
    expect(agyOutcomeHasModelTurn({ kind: 'bad-shape', reason: 'status 缺失' })).toBe(false)
    // 经解析面的三张真机形：超时残稿面＝有回合；旗标拒收（stdout 空）＝无回合；斜杠命令 num_turns=0 如实
    expect(agyOutcomeHasModelTurn(parseAgyJson(JSON.stringify(PRINT_TIMEOUT_OBJ), DEADLINE_STDERR))).toBe(true)
    expect(agyOutcomeHasModelTurn(parseAgyJson('', DEADLINE_STDERR))).toBe(false)
    expect(agyOutcomeHasModelTurn(parseAgyJson(JSON.stringify({ ...SUCCESS_OBJ, num_turns: 0 })))).toBe(true)
  })
})

describe('decodeAgyStdout（task-149④：多字节 UTF-8 跨分片统一解码）', () => {
  it('CJK 3 字节 / emoji 4 字节字符被分片边界拆开 → 逐字还原无 U+FFFD（逐片 String() 则必坏）', () => {
    const text = `{"status":"SUCCESS","response":"可用🎉结论如下：${'长'.repeat(200)}"}`
    const bytes = Buffer.from(text, 'utf8')
    const head = Buffer.byteLength(text.slice(0, text.indexOf('可')), 'utf8')
    const emoji = Buffer.byteLength(text.slice(0, text.indexOf('🎉')), 'utf8')
    const cuts = [head + 1, head + 2, emoji + 1, emoji + 2, emoji + 3] // 全部落在多字节字符内部
    for (const at of cuts) {
      expect(`${String(bytes.subarray(0, at))}${String(bytes.subarray(at))}`, String(at)).not.toBe(text) // 逐片解码的坏法（对照）
      expect(decodeAgyStdout([bytes.subarray(0, at), bytes.subarray(at)]), String(at)).toBe(text)
      expect(decodeAgyStdout([bytes.subarray(0, at), bytes.subarray(at, at + 5), bytes.subarray(at + 5)]), String(at)).toBe(text)
    }
    expect(decodeAgyStdout([bytes])).toBe(text)
    expect(decodeAgyStdout([])).toBe('')
  })

  it('string 片（上游已按边界解码）与 Buffer 片混入原样拼接', () => {
    // 「可」整片；「结」（E7 BB 93）拆成两片夹在 string 片之间
    expect(decodeAgyStdout(['{"response":"', Buffer.from('可', 'utf8'), Buffer.from([0xe7, 0xbb]), Buffer.from([0x93]), '"}'])).toBe('{"response":"可结"}')
  })
})
