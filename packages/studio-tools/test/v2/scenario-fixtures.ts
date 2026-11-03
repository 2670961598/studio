/**
 * studio-dev-548 场景工具测试夹具：11 工具最小合法入参（与 v2/14 §三「入参」列同形）
 * 供 scenario-tools.test.ts / scenario-schemas.test.ts 共用（非测试件，不进 v2 清单计数）。
 */
import { HANDOVER_ITEM_KINDS } from '../../src/scenario-schemas.ts'
import type { ScenarioToolName } from '../../src/scenario-tools.ts'

export const HANDOVER_ITEMS = HANDOVER_ITEM_KINDS.map((item) => ({ item, presence: 'included' as const }))

export const GOOD_ARGS: Record<ScenarioToolName, Record<string, unknown>> = {
  'hr.profileAmend': {
    company: '演示公司',
    subjectRef: 'P-3',
    patch: { title: '技术策划' },
    reason: '笔误更正',
    basis: 'REC-LIFE-04#e1',
  },
  'hr.appointmentPropose': {
    company: '演示公司',
    positionRef: 'POS-DEV-01',
    holderRef: 'P-2',
    nominationRef: 'NOM-1',
    termStart: '2026-11-04',
    draftVersion: 1,
    appointmentType: 'appointment',
    scope: '平台工程',
  },
  'hr.transitionRequest': {
    company: '演示公司',
    employmentRef: 'EMP-P-2',
    from: 'active',
    to: 'handover',
    trigger: { producer: 'initiator', recordRef: 'REC-EVD-03#1' },
    basis: '交接启动',
  },
  'hr.interestDeclare': {
    company: '演示公司',
    subjectRef: 'P-3',
    holdings: [{ ref: 'ASSET-1', kind: 'equity', relation: '本人持股' }],
    relations: ['与供应商 A 存在亲属关系'],
    reviewPeriod: '2026Q4',
  },
  'fin.ledgerRead': {
    company: '演示公司',
    window: { from: '2026-11-01', to: '2026-11-30' },
    segments: ['budget', 'events'],
    readScope: '本部门',
  },
  'fin.costguardStatus': { company: '演示公司', issue: 'T-1' },
  'dev.permissionRequest': {
    company: '演示公司',
    purpose: '读取证据目录',
    scope: ['evidence:read'],
    term: '30d',
    reason: '收割对账',
  },
  'dev.capabilityDeclare': {
    company: '演示公司',
    claimant: 'P-3',
    dimensions: {
      neutral_capability_type: '工具/知识',
      implementation_source: 'dsh-mid@0.2.1-rc.5',
      host_binding: 'stdio MCP',
      dependencies_conflicts: '无冲突',
      io_known_limits: '单次 4MB',
      side_effect_requests: '写证据目录（请求）',
      lifecycle: '不支持热插拔',
      observation_cost: 'tokens 有、成本无价目表',
      evidence_known_incapability: '会话证据归档未证',
    },
    version: 1,
  },
  'dev.assetRegister': {
    company: '演示公司',
    asset: { type: 'tool', sourceSummary: '内部 MCP 扩展', compatibility: 'dsh>=0.2', exclusive: false },
  },
  'work.intake': { company: '演示公司', rawContent: '补齐场景工具', source: 'lead-brief' },
  'work.handoverSubmit': {
    company: '演示公司',
    context: '换班次交接',
    items: HANDOVER_ITEMS,
    continuityAnswers: { why: '补齐工具面', where: '已注册', remaining: '契约 scope', nextCriteria: 'verify:v2 绿' },
    derivedFace: '无派生执行体',
    submission: 'P-3 提交',
  },
}

