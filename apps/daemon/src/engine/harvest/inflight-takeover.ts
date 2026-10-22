/**
 * inflight-takeover —— serve 启动例行接管 work_records running（R-B）
 *
 * 自 assembly/serve.ts 抽件（20-§十五「先拆再增」——129-E studio-dev-184 拆出腾基线，
 * 语义零变；公面经 serve.ts re-export 保持既有导入面——inflight-takeover.test.ts 同源）。
 *
 * 依据：DEV-13 R-B；docs/38-§2「在途接管收口」/docs/38-§4 分期表 R-B 行：崩溃注入测试
 * 语义转正为生产面——crash-injection ③ 的重启恢复语义即本函数；此前冻结边界
 * 「孤儿留 running、接管归后续刀」就此清偿。
 *
 * 语义边界（与 docs/17-§2/§3/§6 的关系）：
 *   - **启动例行，非第八相位**（17-§2 主循环七相位不动）：进程边界一次面，tick 内
 *     零行为；启动时本进程 inflight 恒空——库上一切 running 行都是前命孤儿（daemon
 *     单写者前提，daemon_kv 同款），收口无歧义。
 *   - **接管≠收割**（17-§6 四要件）：handle 已失、流不可续——四要件无据不判（不落
 *     GATE_FAIL、不结算预算 settle、不烧断路连击）；收口=interrupted 终态行
 *     （EndWorkRecord.status 值域 v0 不锁——'interrupted'=前命中断，既不冒认 done
 *     也不误报 failed）。重派照旧走新意图（活动/镜像重决策，DEV-42①）→ 新 attempt
 *     → 预算沿用未结预留（adopt 不双落，crash-injection ③ 冻结语义原样）。
 *   - **零平台 IO / 零事件落账**：接管是台账卫生面（panel workers 投影「异常死亡
 *     未收割单永远留在聚合」的已知误差由此收口，views.ts 头注）；事件词表（17-§3
 *     冻结）无 WORKER_DEAD 名——观测面=启动日志行 + 终态行本身；加名走 SCHEMA_EVOLVE
 *     批示流，本刀不擅动契约。
 *   - **幂等**：过滤面（status='running' 且 ended_at 空）先于收口面（endWorkRecord
 *     已收口再收=CONFIG_INVALID）——二次接管恒零收口；优雅停（dispose 杀 handle 留
 *     running）与硬杀（SIGKILL）殊途同归，重启即收口。
 */
import type { Ledger } from '@studio-next/store'

/** 在途接管结果（serve 启动例行面的观测锚——启动日志一行 + 测试断言面） */
export interface InflightTakeoverResult {
  /** 收口条数（前命孤儿 running 工位） */
  takenOver: number
  /** 收口明细（单号+attempt——日志归因面） */
  items: ReadonlyArray<{ id: string; issue: string; attempt: number }>
}

export function takeOverRunningWorkRecords(ledger: Ledger, now: number): InflightTakeoverResult {
  const items: Array<{ id: string; issue: string; attempt: number }> = []
  for (const r of ledger.listWorkRecords()) {
    if (r.status !== 'running' || r.ended_at !== undefined) continue
    if (ledger.endWorkRecord(r.id, { ended_at: now, status: 'interrupted' })) {
      items.push({ id: r.id, issue: r.issue, attempt: r.attempt })
    }
  }
  return { takenOver: items.length, items }
}
