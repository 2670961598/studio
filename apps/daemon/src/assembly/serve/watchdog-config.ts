/**
 * watchdog-config —— 看门狗配置面（studio-dev-505：stallAfterMs 按 executor 分级）
 *
 * 规格依据（实现单引用）：
 *   - docs/02-F1-08 看门狗三道：daemon 侧兜底的阈值面须可配（长回合 executor≠短任务档）；
 *   - docs/17-§4 配置体系（全部外置，坏配启动拒）；docs/v2/07-§三 EXEC-01（看护参数随
 *     派发简报/配置面）；
 *   - docs/17-§2 相位 4 末段（在工静默告警；缺省 3600000ms 保留）。
 *
 * 配置形状（daemon.yaml 单行字符串——与 personInflightOverrides 等既有键同风格）：
 *   stallAfterMsByExecutor: 'dsh-mid=5400000;dsh-high=7200000'
 * 语义：命中的 executor 用分级值，未命中/未配回退 `stallAfterMs`（缺省 3600000 不变）。
 *
 * fail-closed 纪律（「坏配 fail-closed」）：空段/缺 `=`/空键/键形状非法/重复键/非正整数
 * 值一律抛错拒启（不静默忽略、不取整、不回退缺省）。键不要求已在注册表——executor 注册
 * 面在 agent.yaml，配置面与注册面解耦（未知键随注册补上即生效；拼错键=显式配置无效，
 * 由 note 里的「活性锚/阈值」观测面可见，不静默改写语义）。
 */

/** 解析错误统一前缀（configInvalid 面由此抛出→启动拒） */
function invalid(detail: string): never {
  throw new Error(`daemon.yaml：stallAfterMsByExecutor ${detail}`)
}

/**
 * 解析 `executor=ms[;executor=ms...]`（`;`/`,` 分隔，容忍空白）。
 * @returns 冻结的分级阈值表（键=executor 注册名，值=正整数 ms）
 */
export function parseStallAfterMsByExecutor(spec: string): Readonly<Record<string, number>> {
  const out: Record<string, number> = {}
  const segments = spec.split(/[;,\n]/).map((s) => s.trim()).filter((s) => s !== '')
  if (segments.length === 0) invalid('为空（至少一段 executor=ms；不配请删除该键）')
  for (const segment of segments) {
    const eq = segment.indexOf('=')
    if (eq <= 0 || eq === segment.length - 1) invalid(`段形状须为 executor=ms（实得「${segment}」）`)
    const executor = segment.slice(0, eq).trim()
    const rawValue = segment.slice(eq + 1).trim()
    if (executor === '') invalid(`executor 名为空（段「${segment}」）`)
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(executor)) invalid(`executor 名形状非法（实得「${executor}」——只允许字母/数字/._-）`)
    if (Object.prototype.hasOwnProperty.call(out, executor)) invalid(`executor 重复配置：${executor}`)
    if (!/^\d+$/.test(rawValue)) invalid(`阈值须为正整数 ms（executor=${executor} 实得「${rawValue}」）`)
    const ms = Number(rawValue)
    if (!Number.isSafeInteger(ms) || ms <= 0) invalid(`阈值须为正整数 ms（executor=${executor} 实得「${rawValue}」）`)
    out[executor] = ms
  }
  return Object.freeze(out)
}

/** serve → engine 配置投影（runtime 装配单一出口；缺省不注入=旧世界字节不变） */
export function stallServeOverrides(config: {
  readonly stallAfterMs: number
  readonly stallKillAfterAlarms: number
  readonly stallAfterMsByExecutor?: Readonly<Record<string, number>>
}): { stallAfterMs: number; stallKillAfterAlarms: number; stallAfterMsByExecutor?: Readonly<Record<string, number>> } {
  return {
    stallAfterMs: config.stallAfterMs,
    stallKillAfterAlarms: config.stallKillAfterAlarms,
    ...(config.stallAfterMsByExecutor !== undefined ? { stallAfterMsByExecutor: config.stallAfterMsByExecutor } : {}),
  }
}
