/**
 * prompt-redact —— IMPL-06-12「prompt 出口义务·daemon 侧 redactKnown」出口扫描注入测试
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/plan/05 IMPL-06-12（领土 `apps/daemon/src/engine/prompt-assembly.ts` 成品
 *     brief.text 出口过 redactKnown；`apps/daemon/src/assembly/hrsync/assemble.ts`
 *     redactOutbound 注入点扩展；冻结验收「bun run test:v2 -- apps/daemon/test/v2 绿；
 *     出口扫描注入测试（探针秘密→全部导出物检索不到）；无扫描通道出口登记缺口不静默」）；
 *   - docs/v2/15 §4.5（三不入·机器强制点：提示词——「组装器对成品简报跑出站闸同款扫描」；
 *     无扫描通道的出口登记缺口不得静默放行）；
 *   - docs/v2/16 §三 prompt 行（成品 brief.text 由 daemon 过 redactKnown——治 L3N-01）；
 *   - docs/80-§11.2.1「内部供给」面调用边界（提示词、任务书 → `redactKnown`：只换已知值、
 *     不做形状兜底；示例/夹具文本必须原样可见）与 `KnownSecretSet` 的 `redactKnown`/
 *     `redact` 分工表；
 *   - docs/audit-DSF/L3-N-细节层-逐文件B-DSF.md L3N-01（daemon 追加的读面节不在 prompt
 *     包任何秘密闸内——本测试的四条断言逐项覆盖该泄漏面与缺口登记面）。
 *
 * 断言纪律（plan/04 §1.9.4）：真装配器 `createDefaultAssembler`＋core 真脱敏纯函数，
 * **不 mock LLM、不 mock 脱敏算法、不重试**；探针值只作注入的已知秘密（假 token/key，
 * 不涉任何真实凭据）。四条用例分别钉：①成品出口替换＋全导出物检索不到；②不同出口
 * 同标记＋两档分工不混用；③无扫描通道=显式缺口（不静默放行、不冒充已扫描）；④两版
 * 任务书（首版/续跑版）同出口。
 */
import { describe, expect, it } from 'vitest'
import type {
  CompanySnapshot,
  ExecutorCapabilities,
  IssueRecord,
  PersonRef,
} from '@studio-next/contract'
import { createRedactors } from '../../src/assembly/hrsync/assemble.ts'
import {
  createDefaultAssembler,
  type AssembleDispatchInput,
  type AssemblerContext,
} from '../../src/engine/prompt-assembly.ts'
import type { TicketReadView } from '../../src/engine/read-tiers.ts'

// ————————————————————— 探针夹具（假值，非真实凭据） —————————————————————

/** 探针 token（≥6 才会被 redactKnown 登记值替换；不命中出站形状正则的字面量） */
const PROBE_TOKEN = 'tok_probe_7f3c9a1e5b2d4c6f'
/** 探针 key（第二个已知值——多值同源验证） */
const PROBE_KEY = 'key-probe-b4e1d9c7'

/** 与 core `REDACT_MARK` 同形（N=原值长度；本测试只断言标记形，不复制算法） */
function redactedMark(value: string): string {
  return `<redacted:${String(value.length)}>`
}

const person: PersonRef = {
  id: 'p-001',
  name: '探针员工',
  login: 'probe.worker',
  level: 3,
  dept: '研发部',
}

const snapshot: CompanySnapshot = {
  slug: 'probe-co',
  name: '探针公司',
  level: 1,
  charter: 'docs/51 公司仓库规范正文（夹具）',
  platform: { platform: 'localfile' },
  departments: [
    {
      name: '研发部',
      path: '研发部',
      parent: null,
      leader: 'p-001',
      level: 1,
      lanes: ['dev'],
      functions: ['研发'],
      relations: [],
    },
  ],
  people: [person],
  jobs: [],
}

const issue: IssueRecord = {
  id: 'T-1001',
  title: '实现提示词出口脱敏（夹具）',
  state: '已派发',
  description: '单据正文——组装器只经读面视图消费本单叙事（夹具）',
  type: 'devtask',
  dept: '研发部',
  level: 3,
  assignee: 'p-001',
  updated: '2026-10-28T00:00:00.000Z',
}

const capabilities: ExecutorCapabilities = {
  budget_cap: true,
  cancel_turn: true,
  session_resume: true,
  agents_md: 'native',
  cost_native: true,
}

const READ_VIEW_TARGET = '/tmp/studio-next/prompt-redact/att1'

/** Full 档读面（正文/评论=daemon 追加段的最高频凭据误贴面——L3N-01） */
function fullReadView(description: string, commentBody: string): TicketReadView {
  return {
    tier: 'full',
    issue: issue.id,
    title: issue.title,
    state: issue.state,
    fields: {
      type: 'devtask',
      dept: '研发部',
      level: 3,
      assignee: 'p-001',
      updated: issue.updated,
    },
    description,
    comments: [
      { id: 'c-1', issue: issue.id, author: 'p-001', body: commentBody, created: issue.updated },
    ],
  }
}

/** 装配入参（形状同 engine 派发相位；一切内容参数注入） */
function dispatchInput(
  view: TicketReadView,
  resume?: AssembleDispatchInput['resume'],
): AssembleDispatchInput {
  return {
    issue,
    attempt: 1,
    person,
    adapterName: 'dsh',
    adapterVersion: '0.1.0-probe',
    capabilities,
    workspace: READ_VIEW_TARGET,
    briefPath: `${READ_VIEW_TARGET}/brief.md`,
    agentsTarget: `${READ_VIEW_TARGET}/AGENTS.md`,
    agentsChannel: { channel: 'native', target: `${READ_VIEW_TARGET}/AGENTS.md` },
    readView: view,
    ...(resume !== undefined ? { resume } : {}),
  }
}

/** 装配器上下文（公司级静态内容源；扫描通道/日志面可选注入） */
function assemblerContext(extras: {
  redactKnown?: (text: string) => string
  log?: (line: string) => void
} = {}): AssemblerContext {
  return {
    fwkVersion: 'v0.5-probe',
    frameworkPrompts: '框架提示词（夹具——非真实配置）',
    snapshot,
    acceptance: ['bun run verify:v2'],
    docRefs: ['docs/plan/05 IMPL-06-12'],
    ...(extras.redactKnown !== undefined ? { redactKnown: extras.redactKnown } : {}),
    ...(extras.log !== undefined ? { log: extras.log } : {}),
  }
}

// ————————————————————— ① 成品 brief.text 出口 —————————————————————

describe('出口义务：成品 brief.text 过 redactKnown（全导出物检索不到探针秘密）', () => {
  it('读面追加段的假 token 被替换为 <redacted:N>；brief/AGENTS/taskBrief/日志面检索不到；AGENTS 缺口显式', () => {
    const { redactKnown } = createRedactors([PROBE_TOKEN])
    const logs: string[] = []
    const assembler = createDefaultAssembler(
      assemblerContext({ redactKnown, log: (line) => logs.push(line) }),
    )
    const out = assembler(
      dispatchInput(
        fullReadView(
          // 已知值（须替换）＋非已知形状示例（内部供给面必须原样可见——不得走 redactOutbound）
          `凭据误贴：${PROBE_TOKEN}；示例（非秘密）：password=hunter2-example`,
          `评论回显 ${PROBE_TOKEN}`,
        ),
      ),
    )

    // ① 成品 brief.text（含 daemon 追加的读面节）已过已知值脱敏
    expect(out.brief.text).not.toContain(PROBE_TOKEN)
    expect(out.brief.text).toContain(redactedMark(PROBE_TOKEN))
    // 内部供给面口径：形状示例原样可见（用 redactOutbound 会把它一并改写——判负）
    expect(out.brief.text).toContain('password=hunter2-example')

    // ② AGENTS.md / TaskBrief / 日志面同样检索不到探针值
    expect(out.agentsMd.text).not.toContain(PROBE_TOKEN)
    expect(JSON.stringify(out.brief.taskBrief)).not.toContain(PROBE_TOKEN)
    expect(logs.length).toBeGreaterThan(0)
    expect(logs.join('\n')).not.toContain(PROBE_TOKEN)

    // ③ 出口台账：brief.text 已扫描；AGENTS 出口无扫描通道→逐条登记缺口（不冒充已扫描）
    expect(out.exitScan.scanned).toEqual(['brief.text'])
    expect(out.exitScan.gaps).toEqual(['agentsMd.text:no-scan-channel'])
  })
})

// ————————————————————— ② 不同出口一致 —————————————————————

describe('不同出口一致：内部供给面（brief）与出站面（hr-sync）同已知值同标记', () => {
  it('同集合双档：两出口均替换为 <redacted:N>；内部面不做形状兜底、出站面做（分工不混用）', () => {
    const { redact, redactKnown } = createRedactors([PROBE_TOKEN, PROBE_KEY])
    const assembler = createDefaultAssembler(assemblerContext({ redactKnown }))
    const out = assembler(
      dispatchInput(fullReadView(`令牌 ${PROBE_TOKEN}`, `密钥 ${PROBE_KEY}`)),
    )
    // 出站面同源文本（hr-sync note 形态——既有 redactOutbound 接线）
    const hrNote = redact(`[hr-sync] note：token=${PROBE_TOKEN} shared_secret=${PROBE_KEY}`)

    // 同一已知值在两出口 → 同一标记（N=原值长度），且原值零残留
    for (const value of [PROBE_TOKEN, PROBE_KEY]) {
      expect(out.brief.text).toContain(redactedMark(value))
      expect(hrNote).toContain(redactedMark(value))
      expect(out.brief.text).not.toContain(value)
      expect(hrNote).not.toContain(value)
    }

    // 两档分工：内部面（brief 用的 redactKnown）只认已知值；出站面同文本触发形状兜底
    const example = '示例：password=hunter2-example；commit=0123456789abcdef0123456789abcdef01234567'
    expect(redactKnown(example)).toBe(example)
    expect(redact(example)).not.toBe(example)
  })
})

// ————————————————————— ③ 无扫描通道=显式缺口 —————————————————————

describe('无扫描通道=显式缺口（不静默放行、不冒充已扫描）', () => {
  it('未注入 redactKnown：文本保留探针但 exitScan 登记 gap；日志只报缺口码、不回显探针值', () => {
    const logs: string[] = []
    const assembler = createDefaultAssembler(assemblerContext({ log: (line) => logs.push(line) }))
    const out = assembler(dispatchInput(fullReadView(`误贴：${PROBE_TOKEN}`, '无探针评论')))

    // 无通道＝未脱敏（不假装已扫——不得把「没扫」写成「扫过且干净」）
    expect(out.brief.text).toContain(PROBE_TOKEN)
    expect(out.exitScan.scanned).toEqual([])
    expect(out.exitScan.gaps).toEqual(['brief.text:no-scan-channel', 'agentsMd.text:no-scan-channel'])

    // 日志面同样显式报缺口；只报出口名/缺口码，绝不回显秘密值
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('出口扫描')
    expect(logs[0]).toContain('brief.text:no-scan-channel')
    expect(logs.join('\n')).not.toContain(PROBE_TOKEN)
  })
})

// ————————————————————— ④ 两版任务书同出口 —————————————————————

describe('两版任务书（首版/续跑版）同出口', () => {
  it('续跑版前情摘要里的探针值同样在成品 brief.text 出口被替换', () => {
    const { redactKnown } = createRedactors([PROBE_TOKEN, PROBE_KEY])
    const assembler = createDefaultAssembler(assemblerContext({ redactKnown }))
    const out = assembler(
      dispatchInput(fullReadView('读面正文（夹具）', '评论（夹具）'), {
        sessionId: 'sess-probe-1',
        summaryPath: `${READ_VIEW_TARGET}/summary.json`,
        summary: {
          schema: 'summary/v1',
          conclusion: `上次把 ${PROBE_TOKEN} 写进了日志`,
          changed_files: ['src/probe.ts'],
        },
        note: `续跑缘由：回显 ${PROBE_KEY}`,
      }),
    )

    expect(out.brief.kind).toBe('resume')
    expect(out.brief.text).not.toContain(PROBE_TOKEN)
    expect(out.brief.text).not.toContain(PROBE_KEY)
    expect(out.brief.text).toContain(redactedMark(PROBE_TOKEN))
    expect(out.brief.text).toContain(redactedMark(PROBE_KEY))
    // 出口对整份成品文本生效（不只读面节）：续跑缘由段同样被脱敏
    expect(out.exitScan.scanned).toEqual(['brief.text'])
  })
})
