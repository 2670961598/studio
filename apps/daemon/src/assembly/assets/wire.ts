/**
 * assembly/assets/wire —— 公司资产部生产接线（DOM-07；studio-dev-549 / 分析件 #23）
 *
 * 依据（实现单引用）：
 *   - docs/17-§2（daemon 装配相位：boot 装载＋拍边界热载 apply；主循环七相位不增不减）；
 *   - docs/17-§6（资产/插件属执行前置面，不改变收割四要件判据）；
 *   - v2/05 §三 DOM-07（公司资产唯一权威=公司资产部；索引/绑定档案=投影）；
 *   - v2/06 §3.4（装载报告：可用/不可用资产面与原因；必备不可用＝具名二选一，缺省拒绝）、
 *     §3.5（传播≠授权）、§4.5（plugins/＝DSH 插件专属资产位）；
 *   - v2/11 §十一 REC-ASSET-01（专属标记/未表达项不得丢弃；登记面读取口径）；
 *   - docs/43-§四（dependencies.yaml 属性绑定→插件安装/启用）＋§十-8（热重载幂等：指纹不变
 *     ＝零动作；收缩不卸载）；
 *   - docs/v2/16 §三 packages/company 行（资产部装载/依赖解析面为 DOM-07 目标件）。
 *
 * 接线语义（fail-closed，不留半载态）：
 *   - 启动（runServe boot 装配）：loadCompanyAssets（缺省 requiredAssetPolicy=refuse，必备不可用
 *     即 CONFIG_INVALID）＋syncCompanyPlugins；任一失败＝拒启（run.ts 收口关台账后抛错）。
 *   - 热载（runtime.ts apply 段，docs/38-§2 L1）：同一函数先跑（装载=只读校验，插件=指纹幂等
 *     补装），抛错＝apply 失败 → 保持旧快照 + ESCALATE RELOAD_APPLY_FAILED；成功才进纯赋值段。
 *   - availableExecutors＝agent.yaml 已注册的 executor 族（dsh/claude/codex/kimi；档位名如
 *     dsh-mid 归 dsh 族）；未配置/ demo fake＝空集 → 专属资产一律 incompatible（不默认可用）。
 *   - 插件根固定 `<rootDir>/plugins`（与 `company add` 的 var/plugins 同源），必填注入、无缺省，
 *     结构上不写用户 ~/.dsh（docs/43-§四）。
 *
 * 边界：本件只读公司目录＋写隔离插件根；不执行任何资产字节（字节惰性 v2/10 §4.8）、不签发
 * 安装授权（v2/07 能力链）、不落 REC-ASSET-01 记录（记录族写面归 P0 差距#1；本刀只做装载
 * 报告与装配接线，不冒充登记落库）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadAgentConfig } from '@studio-next/adapters'
import {
  EXECUTOR_VALUES,
  extractPersonAttrs,
  loadCompanyAssets,
  syncCompanyPlugins,
  type AssetLoadReport,
  type Executor,
  type PluginReloadResult,
} from '@studio-next/company'

/** 插件隔离根在 daemon rootDir 下的固定相对位（与 company add 的 `<workRoot>/var/plugins` 同源） */
export const PLUGINS_DIR = 'plugins'

/** 资产装载＋插件同步的装配产物（日志行同回传——测试断言面，调用方决定落点） */
export interface CompanyAssetWiring {
  assets: AssetLoadReport
  plugins: PluginReloadResult
  logLines: string[]
}

/** executor 注册名 → 执行器族（档位/判断位名如 `dsh-mid`/`dsh-judge` 归 `dsh`；未登记名忽略） */
export function executorFamiliesOf(names: readonly string[]): Executor[] {
  const families = new Set<Executor>()
  for (const name of names) {
    const family = EXECUTOR_VALUES.find((candidate) => name === candidate || name.startsWith(`${candidate}-`))
    if (family !== undefined) families.add(family)
  }
  return [...families].sort()
}

/** agent.yaml 声明的执行器族（缺配置＝空集：专属资产按 v2/06 §3.4 明示不可用） */
export function declaredExecutorFamilies(agentYaml: string | undefined): Executor[] {
  if (agentYaml === undefined) return []
  return executorFamiliesOf(loadAgentConfig(readFileSync(path.resolve(agentYaml), 'utf8')).executors.map((e) => e.name))
}

/**
 * 资产装载＋插件同步（boot 与热载 apply 共用）。
 * 抛错＝装载/校验/同步失败——调用方必须按 fail-closed 处置（boot 拒启／热载保持旧态）。
 */
export async function wireCompanyAssets(opts: {
  companyDir: string
  pluginRoot: string
  executorFamilies: readonly Executor[]
  log: (line: string) => void
  now?: () => Date
}): Promise<CompanyAssetWiring> {
  const companyDir = path.resolve(opts.companyDir)
  const pluginRoot = path.resolve(opts.pluginRoot)
  // 插件绑定求值的人员属性面：单源读 org-config.yaml（与 create 导入面同法；批内文档已校验）
  const persons = extractPersonAttrs(readFileSync(path.join(companyDir, 'org-config.yaml'), 'utf8'))
  const assets = await loadCompanyAssets({ companyDir, availableExecutors: opts.executorFamilies })
  const plugins = await syncCompanyPlugins({
    companyDir,
    pluginRoot,
    persons,
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  })

  const counts = { loaded: 0, missing: 0, incompatible: 0, blocked: 0 }
  for (const item of assets.items) counts[item.state] += 1
  const logLines = [
    `[serve] 公司资产装载（DOM-07；docs/17-§2 boot 装配／热载 apply）：manifest=${
      assets.manifestPresent ? 'present' : 'absent'
    } loaded=${counts.loaded} missing=${counts.missing} incompatible=${counts.incompatible} blocked=${counts.blocked}；必备策略=${assets.required.policy}（${assets.required.outcome}）；executor 族=${
      opts.executorFamilies.join('、') || '（无——专属资产按 v2/06 §3.4 明示不可用）'
    }`,
  ]
  if (assets.items.length > 0) {
    logLines.push(
      `[serve] 资产装载报告（REC-ASSET-01 读取口径；逐项不冒充已装）：${assets.items
        .map((item) => `${item.assetId}:${item.state}${item.required ? '(必备)' : ''}`)
        .join('、')}`,
    )
  }
  const issues = [...assets.issues.map((i) => i.code), ...assets.warnings.map((w) => w.code)]
  if (issues.length > 0 || assets.unlisted.length > 0) {
    logLines.push(
      `[serve] 资产装载诊断：issues=[${[...new Set(issues)].join('、') || '无'}] unlisted=${assets.unlisted.length}（不默认全收；细节见装载报告）`,
    )
  }
  const installed = plugins.install?.items.filter((i) => i.action === 'install' || i.action === 'replace').length ?? 0
  logLines.push(
    `[serve] 插件同步（dependencies.yaml；docs/43-§四/§十-8）：changed=${plugins.changed} 指纹=${
      plugins.fingerprint.slice(0, 19)
    }… 启用集=${Object.keys(plugins.enabled).length} 人；${
      plugins.install === undefined ? '零动作（指纹未变，幂等）' : `安装/替换=${installed} 项 日志=${plugins.install.logFile}`
    }`,
  )
  for (const line of logLines) opts.log(line)
  return { assets, plugins, logLines }
}

/**
 * boot 装配包装：失败＝拒启（fail-closed）——先执行调用方拒启收口（关台账/释放 writer lock），
 * 再抛带「拒绝启动」前缀的 CONFIG_INVALID 形状错误（runServe 未捕获面 → 进程非零退出）。
 */
export async function wireCompanyAssetsAtBoot(opts: {
  companyDir: string
  pluginRoot: string
  /** agent.yaml（可选）：执行器族在拒启 try 内解析——解析失败同样走拒启收口，不漏台账锁 */
  agentYaml?: string
  log: (line: string) => void
  onRefuse: () => void
}): Promise<CompanyAssetWiring> {
  try {
    return await wireCompanyAssets({
      companyDir: opts.companyDir,
      pluginRoot: opts.pluginRoot,
      executorFamilies: declaredExecutorFamilies(opts.agentYaml),
      log: opts.log,
    })
  } catch (err) {
    opts.onRefuse()
    throw new Error(
      `公司资产装载/插件同步失败（含 agent.yaml 执行器族解析；拒绝启动；DOM-07 fail-closed）：${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
