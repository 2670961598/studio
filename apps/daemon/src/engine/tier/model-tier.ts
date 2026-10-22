/**
 * 模型档执行面 —— studio-dev-196（制作人 2026-10-22 三档定调：大/中/小）
 *
 * 依据：
 *   - docs/17-§2：主循环七相位——派发相位选适配器只读能力声明；本件是「选哪一档」的
 *     决策面，不改七相位结构（档选位=registry 选位前置件，非新相位）。
 *   - docs/17-§4：models.yaml 三档+角色映射（tiers.high/mid/low + roles）；agent.yaml
 *     `<family>-<tier>` 注册位（agentconfig.ts tierAwareResolver——档位是全功能派工位）。
 *   - docs/17-§6：收割四要件不动；模型留痕=work_records.model（132-A v8 列，ResultStats.model
 *     镜像——收割侧既有链路零改动，本件只保证档位适配器带对镜像）。
 *   - AGENTS.md §五-3 证据断言：真档路由证据=受控真跑（deliverables/plan.md §1.6）。
 *
 * 三个面（本件集中，engine.ts/serve.ts 只留接线行——边界基线纪律）：
 *   1. resolveModelTier：单 → 档 → 角色三级解析（显式单级覆盖 > 岗单锚 > 角色映射）。
 *      开面条件=modelTierByRole 注入（=models.yaml 已装载，serve 装配）；未注入=面关，
 *      返回 undefined——派发行为与 studio-dev-196 之前逐字节一致（fake/demo/引擎测试面
 *      零变更，17-§2「零 if executor」同源的装配面开关纪律）。
 *   2. modelTierDispatchFace：档 → 执行位名（`<family>-<tier>`）→ 注册表解析；位不在册
 *      → 缺省回退 + 降级锚（明报不静默——DISPATCH note 可观测；fake 注册表自然走回退）。
 *   3. provisionModelTierOverlays / parseModelTierTickets / checkTierPositionDeclarations：
 *      serve 装配面（overlay 生成=低/高档 dsh --patch 文件；显式覆盖表解析即验；
 *      档位声明与 models.yaml 漂移=启动拒——fail-closed）。
 *
 * 中档不生成 overlay：缺省=现役 headless profile 的 agent-default-model（GLM-5.3）——
 * 「现役即中档」是制作人定调的直接落位，少一个文件少一份漂移面。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { configInvalid } from '@studio-next/contract'
import type { ExecutorAdapter, PersonId, PersonRef, TicketId } from '@studio-next/contract'
import { dshModelFromPatches, tierExecutorName, tierOfExecutorName } from '@studio-next/adapters'
import type { ModelsConfig, TierId } from '@studio-next/core'
import { roleOfAssignee } from '../read-tiers.ts'

/** 档位 id（contract ModelTier['tier'] 同枚举；TierId=core 冻结值——单一来源引用） */
export type { TierId }

const TIER_IDS: readonly TierId[] = ['high', 'mid', 'low']

/**
 * 档路由配置面（EngineConfig 注入；两键都缺=面关）：
 *   - modelTierByRole：models.yaml roles 的直录（岗位→档；main_worker 必在=parse 闸）；
 *   - modelTierTickets：daemon.yaml modelTierTickets 显式单级覆盖（解析即验）。
 */
export interface ModelTierRoutingConfig {
  readonly modelTierByRole?: Readonly<Record<string, TierId>>
  readonly modelTierTickets?: Readonly<Record<TicketId, TierId>>
}

/** 档解析结果（source=命中的解析级——DISPATCH 观测锚素材） */
export interface ResolvedModelTier {
  readonly tier: TierId
  readonly source: 'ticket' | 'job' | 'role'
}

/**
 * 单 → 档三级解析（优先级冻结）：
 *   1. 显式单级覆盖（modelTierTickets[ticket]——org-config 规范位/单据字段=登记债务，
 *      扁平面先行 pinnedTickets 先例）；
 *   2. 岗单锚（PATROL note `job=<id>` 物化单 → ledger.getJob(id).model_tier——
 *      jobs-sources jobTickets 同口径派生，jobs 表列随行落库早已就位）；
 *   3. worker 单角色映射（roleOfAssignee：非工号 assignee=角色名，否则 main_worker →
 *      modelTierByRole[role]；未知角色回 'mid'——保守缺省=现役主力档，不惊扰）。
 * 面关（modelTierByRole 未注入）→ undefined（调用方保持现行为）。
 */
export function resolveModelTier(
  input: {
    readonly ticket: TicketId
    readonly assignee: PersonId | undefined
    readonly people: readonly PersonRef[]
    /** 岗锚（EventIndex.jobAnchorOf(ticket)——PATROL 派生；非岗单 undefined） */
    readonly jobAnchor: string | undefined
    /** 岗档读取面（ledger.getJob(anchor)?.model_tier 的注入形——纯函数可测） */
    readonly jobTierOf: (jobId: string) => TierId | undefined
  },
  cfg: ModelTierRoutingConfig,
): ResolvedModelTier | undefined {
  if (cfg.modelTierByRole === undefined) return undefined // 面关（models.yaml 未装载）
  const explicit = cfg.modelTierTickets?.[input.ticket]
  if (explicit !== undefined) return { tier: explicit, source: 'ticket' }
  if (input.jobAnchor !== undefined) {
    const jobTier = input.jobTierOf(input.jobAnchor)
    if (jobTier !== undefined) return { tier: jobTier, source: 'job' }
  }
  const role = roleOfAssignee(input.assignee, input.people)
  return { tier: cfg.modelTierByRole[role] ?? 'mid', source: 'role' }
}

/** 档派发面：适配器 + 观测锚（DISPATCH note 携——`tier=<t>@<位名>`，回退携降级因） */
export interface ModelTierDispatchFace {
  readonly adapter: ExecutorAdapter
  readonly noteAnchor: string
}

/**
 * 档 → 执行位选位：位名=`tierExecutorName(familyOf(缺省位名), tier)`（缺省位名先剥档位
 * 后缀再取家族——`dsh-mid` 缺省时高档落 `dsh-high` 不落 `dsh-mid-high`）；在册 →
 * resolve 指名；不在册 → **缺省回退不炸派发**（回退是业务结果：fake/demo 注册表无档位
 * 名，档面开后派发链也不许断——降级锚明报可观测，与 resume 降级新派同纪律）。
 */
export function modelTierDispatchFace(
  registry: {
    list(): readonly { readonly name: string }[]
    resolve(name: string): ExecutorAdapter
  },
  tier: TierId,
  fallback: ExecutorAdapter,
): ModelTierDispatchFace {
  const family = tierOfExecutorName(fallback.name)?.family ?? fallback.name
  const tierName = tierExecutorName(family, tier)
  const registered = registry.list().some((e) => e.name === tierName)
  if (registered) {
    return { adapter: registry.resolve(tierName), noteAnchor: `;tier=${tier}@${tierName}` }
  }
  return {
    adapter: fallback,
    noteAnchor: `;tier=${tier}@${fallback.name}（降级：无 ${tierName} 档执行位——agent.yaml 未登记该位）`,
  }
}

/**
 * 生成低/高档 dsh overlay（<rootDir>/tmp/dsh-tier-<tier>.yml）：内容=单一
 * `agent-default-model` patch 条目（provider+model 取自 models.yaml tiers——单一事实源；
 * 形状与 headless profile cordis.patch.yml 同构，--patch 多层后写胜）。每次启动覆写刷新
 * （确定性内容）。**mid 不生成**（缺省=现役 profile）。返回存在的位（serve 日志与
 * agent.yaml 挂载指引素材）；tier 缺失（models.yaml 形状坏）→ 该位省略不炸启动。
 */
export function provisionModelTierOverlays(
  rootDir: string,
  models: ModelsConfig,
): Partial<Record<Exclude<TierId, 'mid'>, string>> {
  const out: Partial<Record<Exclude<TierId, 'mid'>, string>> = {}
  for (const tier of ['high', 'low'] as const) {
    const spec = models.tiers[tier]
    if (spec === undefined) continue
    const overlayPath = path.join(rootDir, 'tmp', `dsh-tier-${tier}.yml`)
    const text = [
      `# Studio Next daemon 生成（serve 启动刷新；生成物勿手改）`,
      `# 模型档 overlay（studio-dev-196，制作人 2026-10-22 三档定调）——tier=${tier}：`,
      `# ${spec.provider}/${spec.model}（models.yaml tiers.${tier} 单一事实源）。挂法：agent.yaml`,
      `# 对应档位 cmd 追加 \`--patch <本文件绝对路径>\`（dsh 多层 --patch 后写胜）。`,
      `# 中档无此文件：缺省=现役 profile 的 agent-default-model（现役即中档）。`,
      `- id: agent-default-model`,
      `  config:`,
      `    provider: ${spec.provider}`,
      `    model: ${spec.model}`,
      ``,
    ].join('\n')
    mkdirSync(path.dirname(overlayPath), { recursive: true, mode: 0o700 })
    writeFileSync(overlayPath, text, { encoding: 'utf8', mode: 0o600 })
    out[tier] = overlayPath
  }
  return out
}

/**
 * daemon.yaml `modelTierTickets` 解析（personInflightOverrides 同型扁平分号对：
 * `LOCAL-H=high;LOCAL-L=low`）。解析即验（坏段/未知档启动拒——fail-closed，
 * judgeSites 同款）；空串=空表（面开但无覆盖，合法——只靠角色映射路由）。
 */
export function parseModelTierTickets(raw: string): Readonly<Record<TicketId, TierId>> {
  const out: Record<string, TierId> = {}
  for (const segment of raw.split(';')) {
    const seg = segment.trim()
    if (seg === '') continue
    const eq = seg.indexOf('=')
    if (eq <= 0 || eq >= seg.length - 1) {
      configInvalid(
        'serve/model-tier-tickets',
        `modelTierTickets 段「${seg}」非 单号=档 形态（分号对，如 STUDIO-196-H=high;STUDIO-196-L=low；档∈ high/mid/low）`,
      )
    }
    const ticket = seg.slice(0, eq).trim()
    const tier = seg.slice(eq + 1).trim()
    if (ticket === '') {
      configInvalid('serve/model-tier-tickets', `modelTierTickets 段「${seg}」单号为空`)
    }
    if (!(TIER_IDS as readonly string[]).includes(tier)) {
      configInvalid(
        'serve/model-tier-tickets',
        `modelTierTickets 段「${seg}」档「${tier}」未知（档∈ high/mid/low——docs/17-§4 三档冻结）`,
      )
    }
    if (Object.hasOwn(out, ticket)) {
      configInvalid('serve/model-tier-tickets', `modelTierTickets 单号「${ticket}」重复登记（后写覆盖先写=静默改配置，拒收）`)
    }
    out[ticket] = tier as TierId
  }
  return out
}

/**
 * 档位声明一致性闸（serve 启动 fail-closed）：agent.yaml 档位名
 * （`<family>-<tier>`）若声明 patches['agent-default-model']（部署镜像），必须与
 * models.yaml tiers[tier] 同 provider/model——三面同源（overlay 生成/ResultStats 镜像/
 * 价目折算）任何一面漂移都让账目失真，启动面拦。未声明镜像的档位不查（镜像缺席=如实
 * 缺席，132-§6.1 单A 口径）；非档位名不查（裸 dsh 等现役位各归各面）。
 */
export function checkTierPositionDeclarations(
  executors: readonly {
    readonly name: string
    readonly patches: Readonly<Record<string, unknown>> | undefined
  }[],
  models: ModelsConfig,
): void {
  for (const rec of executors) {
    const tier = tierOfExecutorName(rec.name)
    if (tier === undefined) continue
    const declared = dshModelFromPatches(rec.patches)
    if (declared === undefined) continue
    const spec = models.tiers[tier.tier as TierId]
    const canonical = spec !== undefined ? `${spec.provider}/${spec.model}` : undefined
    if (declared !== canonical) {
      configInvalid(
        'serve/model-tier-drift',
        `${rec.name}.patches['agent-default-model']=${declared} 与 models.yaml tiers.${tier.tier}=${canonical ?? '缺失'} 漂移——档位镜像/overlay/价目三面须同源（studio-dev-196）`,
      )
    }
  }
}
