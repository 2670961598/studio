/**
 * worker-key-face —— worker 级 wkey 接线（自 `serve/runtime.ts` 逐字迁移；根委任注入缝）
 *
 * 依据（实现单引用）：
 *   - docs/17-§7「按单签发→随派发注入→关单吊销」（wkey 生命周期；`src/engine/worker-key.ts`）；
 *   - docs/v2/15 §7.3「SEC-ROOT-02 启动腿」：`createGateway` 构造期即验 `root_delegation`
 *     ——本件把 daemon 装载面（root-face.ts）产出的 root 面并入网关装配输入；
 *   - docs/20-§十五.三（文件 600 行阈）：runtime.ts 接线前已满 600 行，本接线**先拆再增**
 *     ——本件为逐字迁移（行为/日志/返回形状不变），迁移后 runtime.ts 在阈内。
 *
 * 边界：签发实例绑 `CONTROL_TICKET`——本实例只用 issue/revoke 面，verify 面结构性失效
 * （永远不能验 worker key，防误用）；root 面在本实例上的意义＝**启动期校验＋可观测**
 * （装配成功即 SEC-ROOT-02 步①-④通过；运行期 root 动作 preflight 由生产网关面消费）。
 */
import { createGateway, CONTROL_TICKET } from '@studio-next/gateway'
import type { WorkerKeyDeps } from '../../../engine/worker-key.ts'
import type { DaemonIdentity, ServeConfig } from '../config.ts'
import { formatRootDelegationTrace, type RootDelegationFace } from './root-face.ts'

/**
 * worker 级 wkey 接线（17-§7「按单签发→随派发注入→关单吊销」；src/engine/worker-key.ts）。
 * gateway: false 时不签发（与控制面同开关）；签发实例绑 CONTROL_TICKET——本实例只用
 * issue/revoke 面，verify 面结构性失效（永远不能验 worker key，防误用；worker 侧验签
 * 归 per-ticket studio-tools 接线，吊销跨进程可见性疑点见 worker-key.ts 头注）。
 * 身份=共享活对象（与控制面同源——L1 热重载 mutate 面）。
 *
 * rootFace 给出＝装配期验根委任（坏委任/缺证明在此抛 `CONFIG_INVALID`，对象不产出）；
 * 缺省＝不装 root 面（`rootPreflight` 恒拒 `gw-root-no-delegation`，行为与接线前一致）。
 */
export function wireWorkerKeys(
  config: ServeConfig,
  identity: DaemonIdentity,
  clock: () => number,
  log: (line: string) => void,
  rootFace?: RootDelegationFace,
): WorkerKeyDeps | undefined {
  if (!config.gateway) return undefined
  const { secret, ctx, author } = identity
  const gateway = createGateway({
    secret,
    clock,
    ticket: CONTROL_TICKET,
    ctx,
    author,
    ...(rootFace !== undefined ? { root: rootFace.options } : {}),
  })
  if (rootFace !== undefined) {
    log(`[serve] root 委任已验（SEC-ROOT-02 启动腿；docs/v2/15 §7.3）：${formatRootDelegationTrace(rootFace.trace)}`)
  }
  log('[serve] worker wkey 已接：按单签发 → TaskBrief.credentials（env 通道，子进程 env STUDIO_TOOLS_WKEY）→ GATE_FAIL/断路/CLOSE 吊销（17-§7；scope=六动词全集；凭据值红名单——不入提示词/档案/任务书/日志）')
  return { gateway }
}
