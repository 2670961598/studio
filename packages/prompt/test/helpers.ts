/**
 * 测试夹具 —— 标准六源样例（贴近 templates/company-2-level 与 contract 端口形状）。
 * 一切内容参数注入（本包零盘 IO）；改字段即得「改一层只动一段」的对照面。
 */
import type {
  CompanySnapshot,
  ExecutorCapabilities,
  PersonRef,
} from '@studio-next/contract'
import {
  buildLayers,
  type L1CompanySource,
  type L3PersonSource,
  type L4TaskSource,
  type LayerSource,
} from '../src/layers.ts'

export const FWK_VERSION = '0.1.0'

export const SNAPSHOT: CompanySnapshot = {
  slug: 'studio-next',
  name: 'Studio Next',
  level: 2,
  charter: 'docs/00-总览.md',
  platform: { platform: 'youtrack' },
  departments: [],
  people: [],
  jobs: [],
}

export const PERSON: PersonRef = { id: 'E001', name: '张三', login: 'zhangsan', level: 3, dept: '工程部' }

export const CAPS: ExecutorCapabilities = {
  budget_cap: true,
  cancel_turn: true,
  session_resume: false,
  agents_md: 'user_level',
  cost_native: false,
}

/** 标准六源（work_history 6 单、lessons 4 票、campaign 3 句——足够走完裁剪阶梯） */
export function standardSources(): LayerSource[] {
  const l1: L1CompanySource = {
    kind: 'L1-company',
    snapshot: SNAPSHOT,
    sections: [
      { kind: 'mission', lines: ['用一条可验证的交付链，把需求变成有证据的产出。'] },
      { kind: 'direction', lines: ['把第一条端到端交付链跑通：需求→拆单→派发→干活→证据→关单。'] },
      {
        kind: 'campaign',
        lines: ['交付链打通：一张真实单据走完全程并留下证据。', '台账可用：面板能回答在干什么/谁干的/花了多少。', '质量战役：验收口径全部冻结可回放。'],
      },
      { kind: 'identity', lines: ['署名由框架网关注入，worker 不自拼署名前缀。'] },
    ],
  }
  const l3: L3PersonSource = {
    kind: 'L3-person',
    person: PERSON,
    sections: [
      { kind: 'position', lines: ['工程部主干 worker，承接实现单。'] },
      { kind: 'duties', lines: ['- 实现单落地（引用文档章节号）', '- 证据落盘（终态事件+REPORT+闸门）'] },
      {
        kind: 'work_history',
        // 旧→新（拟稿行序）：6 单
        lines: [
          'STUDIO-100：契约包 cases.json 骨架',
          'STUDIO-101：events 台账 schema',
          'STUDIO-102：断路器纯逻辑',
          'STUDIO-103：golden trace 格式',
          'STUDIO-104：dsh 适配器四原语',
          'STUDIO-105：kimi 适配器四原语',
        ],
      },
      { kind: 'skills', lines: ['TypeScript(strict)', 'vitest', 'Node 24 原生 type-stripping'] },
      { kind: 'profile', lines: ['交付 6 单', '打回率 0.17', '闸门一次通过 5/6'] },
      { kind: 'self_narrative', lines: ['喜欢先读文档再动手。'] },
    ],
  }
  const l4: L4TaskSource = {
    kind: 'L4-task',
    ticket: 'STUDIO-110',
    attempt: 1,
    objective: 'prompt 包 L0-L5 装配器首刀',
    acceptance: ['bun run typecheck', 'bun run test'],
    docRefs: ['docs/17-§5（装配管线全图）', 'docs/01-需求-公司面.md C2 节'],
    lessons: [
      '教训1：验收命令冻结后禁改（STUDIO-95）',
      '教训2：import 显用 .ts（STUDIO-96）',
      '教训3：不伪造证据（STUDIO-97）',
      '教训4：测试不对实现细节负责（STUDIO-98）',
    ],
  }
  return [
    { kind: 'L0-framework', fwkVersion: FWK_VERSION, frameworkPrompts: '# 基本法\n- 无证据=无完成\n- 不伪造、不隐瞒\n- 密钥永不入库' },
    l1,
    { kind: 'L2-org', deptConfig: '部门：工程部\n主管：E009\n职能：实现/测试\n泳道：lane/main', signature: '[Studio Next·工程部·worker·L3]' },
    l3,
    l4,
    { kind: 'L5-tool', adapter: 'dsh', version: '1.4.0', capabilities: CAPS, plugins: ['panel-probe@0.2'] },
  ]
}

/** 便捷：标准六源直接构建六层（buildLayers 纯函数，同输入同输出） */
export function standardLayers() {
  return buildLayers(standardSources())
}
