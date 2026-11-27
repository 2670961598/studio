/**
 * agent.yaml patches 的家族专属消费（agentconfig.ts 分片；BC-S2 尺寸阈「先拆后加」，docs/20-§十五）
 *
 * generic 层「patches 透传不解释」维持：本文件是家族专属消费（cmd 同位先例），其余家不读 patches。
 * 自 agentconfig.ts **原样迁出** dshModelFromPatches（studio-dev-168；逐字不变）＋ task-140 新增
 * agy 家 agyOptionsFromPatches；agentconfig.ts 保留 re-export——既有引用路径零变
 * （apps/daemon engine/tier/model-tier.ts 经包 index；adapters/test/agentconfig.test.ts 相对路径）。
 */
import { configInvalid } from '@studio-next/contract'
import type { AgyAdapterOptions } from './agy.ts'

/**
 * agy 家 patches 消费（家族专属，dshModelFromPatches 同位先例；generic 层仍透传不解释）：
 *   - `model`：字符串（非空、不含换行）→ AgyAdapter --model 与 ResultStats.model
 *     （实测可用自然语言串，如 "Gemini 4 Neon (High)"）
 *   - `print-timeout-sec`：正整数 → --print-timeout + 适配器 watchdog（agy.ts 头注）；单位按秒
 *     是**未证假设**（CLI 侧单位未实测，见 docs/quality/agy-adapter.md §八）——只收整数秒，
 *     不收时长串/小数（形状坏即 CONFIG_INVALID，不静默不猜）
 * 两键缺=undefined（如实缺席）；键在而形状坏 → CONFIG_INVALID。
 */
export function agyOptionsFromPatches(patches: Readonly<Record<string, unknown>> | undefined): AgyAdapterOptions {
  if (patches === undefined) return {}
  const opts: { model?: string; printTimeoutSec?: number } = {}
  if (Object.hasOwn(patches, 'model')) {
    const model = patches['model']
    if (typeof model !== 'string' || model.trim() === '' || /[\r\n]/.test(model)) {
      configInvalid(
        'agentconfig/agy-patch-shape',
        `agy patches.model 形状坏（期望非空单行 string，收到 ${JSON.stringify(model)}）——不静默不猜（task-140）`,
      )
    }
    opts.model = model
  }
  if (Object.hasOwn(patches, 'print-timeout-sec')) {
    const sec = patches['print-timeout-sec']
    if (typeof sec !== 'number' || !Number.isInteger(sec) || sec <= 0) {
      configInvalid(
        'agentconfig/agy-patch-shape',
        `agy patches.print-timeout-sec 形状坏（期望正整数秒，收到 ${JSON.stringify(sec)}）——不静默不猜（task-140）`,
      )
    }
    opts.printTimeoutSec = sec
  }
  return opts
}

/**
 * dsh 家 patches['agent-default-model'] 声明解析（132-§6.1 单A·C3）：dsh 无 `--model` 旗标，
 * 模型=profile 插件配置（provider+model）——daemon 直读机器全局态与 per-company 隔离相抵，
 * agent.yaml patches 段是部署对该 patch 的**声明镜像**（非新增第三事实源）。形状照录
 * `{config: {provider, model}}`（两非空串且不含 `/`）；缺键=undefined（如实缺席），键在而
 * 形状坏 → CONFIG_INVALID（不静默不猜）。generic 层「patches 透传不解释」维持：本解析是 dsh
 * 家族专属消费（cmd 同位先例），其余家不读 patches。
 */
export function dshModelFromPatches(patches: Readonly<Record<string, unknown>> | undefined): string | undefined {
  if (patches === undefined || !Object.hasOwn(patches, 'agent-default-model')) return undefined
  const entry = patches['agent-default-model']
  const detail = (why: string): never =>
    configInvalid(
      'agentconfig/dsh-model-patch',
      `executors.dsh.patches['agent-default-model'] ${why}——形状须为 {config: {provider, model}}（profile patch 条目的声明镜像，132-§6.1 单A）`,
    )
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    detail(`形状不合（收到 ${Array.isArray(entry) ? '数组' : typeof entry}）`)
  }
  const config = (entry as Record<string, unknown>)['config']
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    detail('缺 config 映射段')
  }
  const c = config as Record<string, unknown>
  const provider = c['provider']
  const model = c['model']
  if (typeof provider !== 'string' || provider === '') detail('config.provider 须为非空字符串')
  if (typeof model !== 'string' || model === '') detail('config.model 须为非空字符串')
  const p = provider as string
  const m = model as string
  if (p.includes('/') || m.includes('/')) {
    detail(`provider/model 不得含 '/'（归一形 ${JSON.stringify(`${p}/${m}`)} 有歧义）`)
  }
  return `${p}/${m}`
}
