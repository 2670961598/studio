/**
 * 内置 demo 公司快照（serve.ts 拆出——20-§十五.三.3 尺寸门「先拆再增」；130-P3
 * 频道供给接线时腾位，逐字搬迁零行为漂移；serve.ts 经 re-export 同源使用）。
 */
import type { CompanySnapshot } from '@studio-next/contract'

/** demo 公司快照（companyDir 未给时的兜底——单部门单人， Lane 通道走 defaultLane） */
export const DEMO_SNAPSHOT: CompanySnapshot = {
  slug: 'demo',
  name: 'Demo 公司',
  level: 2,
  charter: 'charter.md',
  platform: { platform: 'localfile' },
  departments: [
    {
      name: '工程部',
      path: 'departments/工程部',
      parent: null,
      leader: 'AGENT-1',
      level: 2,
      lanes: ['core'],
      functions: ['交付'],
      relations: [],
    },
  ],
  people: [
    { id: 'AGENT-1', name: '示例工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' },
  ],
  jobs: [
    // v0.4 首个定时岗样例（16-§四「健康巡检」）：5 分钟巡逻——demo 模式出厂即跑通
    // 「cron 到点 → schedule 意图 → 岗单据 → 台账」链（PATROL 起头）。
    // 落位分型（DEV-40）：type='patrol'=巡查工件——物化落终态（已交付），同拍回收 CLOSE，
    // **不派发**（宰相批注 2026-10-20：巡查工件派发=烧配额；真「健康巡检」实职归后续
    // 运维单）。工单型岗（report/cadence）落初态照走派发-收割链（见 engine.ts 物化段）。
    {
      job_id: 'health-patrol',
      company: 'demo',
      dept: 'departments/工程部',
      cron: '*/5 * * * *',
      role: 'AGENT-1',
      level: 2,
      model_tier: 'low',
      budget_cap: { usd: 1 },
      payload: { type: 'patrol', note: 'demo 健康巡检样例岗（16-§四 v0.4）' },
    },
  ],
}
