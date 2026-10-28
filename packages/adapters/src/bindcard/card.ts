/**
 * bindcard/card —— 绑定档案装载面（BIND- 卡可查；版本锁比对；卡内不变量校验）
 *
 * 依据：
 *   - v2/12 §〇.4 绑定档案卡格式：必答十二行＋硬规则（引用带 ID+版本；摘要未计算不得当
 *     校验位；版本不符＝弃用不静默降级；不支持逐条；现状每面恰一值）——本文件是这些硬规则的
 *     **装载期执行面**（卡不合法即拒收，不把坏卡交给消费方）。
 *   - v2/12 §一 BIND-DSH-01＋§2.1 三张 CLI 卡＝本包领土（执行宿主卡）；平台卡
 *     BIND-PLAT-YT/TAIGA/LOCAL、工作区卡 BIND-WS、投影卡 BIND-PRM 归其它包的落点，
 *     **本包不复制第二张表**——请求这些卡一律拒收（不回落、不冒充）。
 *   - v2/16 §三 adapters 行（绑定档案可查＝本单改造项）；plan/05 IMPL-07-05。
 *
 * 纪律：
 *   - 纯函数、零 IO、零时钟：装载只查静态事实与不变量，不碰文件/环境/网络。
 *   - 本文件不引入「卡外第二事实源」：卡数据只在 dsh-card.ts / cli-cards.ts 各一处。
 *   - 装载成功不构成任何授权或机制保证（绑定不是授权，v2/12 §〇.2）；「已有」面仅表示
 *     仓内实现/接线事实，实际拦截能力未证（PRB-04 等未执行）。
 */
import type { ClassifiedError, ExecutorFamily, Result } from '@studio-next/contract'
import type { BindingCard, HostBindingCardId } from './types.ts'
import { CARD_FACT_STATUSES, HOST_BINDING_CARD_IDS, configErr, okResult } from './types.ts'
import { DSH_BINDING_CARD } from './dsh-card.ts'
import {
  CLAUDE_BINDING_CARD,
  CLI_BINDING_CARD_IDS,
  CODEX_BINDING_CARD,
  KIMI_BINDING_CARD,
} from './cli-cards.ts'

/** 全部执行宿主卡（本包领土；卡 ID → 卡本体） */
export const HOST_CARD_REGISTRY: Readonly<Record<HostBindingCardId, BindingCard>> = Object.freeze({
  'BIND-DSH-01': DSH_BINDING_CARD,
  [CLI_BINDING_CARD_IDS.claude]: CLAUDE_BINDING_CARD,
  [CLI_BINDING_CARD_IDS.codex]: CODEX_BINDING_CARD,
  [CLI_BINDING_CARD_IDS.kimi]: KIMI_BINDING_CARD,
})

/** 卡 ID 是否本包领土（type guard） */
export function isHostBindingCardId(cardId: string): cardId is HostBindingCardId {
  return (HOST_BINDING_CARD_IDS as readonly string[]).includes(cardId)
}

/** 执行器家族 → 本包卡 ID（未登记家族 undefined——不为未登记家族代言） */
export function bindingCardIdOfFamily(family: string): HostBindingCardId | undefined {
  for (const cardId of HOST_BINDING_CARD_IDS) {
    if (HOST_CARD_REGISTRY[cardId].family === family) return cardId
  }
  return undefined
}

/** 外域卡归属说明（拒收 detail 用；引位不复制卡体） */
const FOREIGN_CARD_HINTS: readonly { readonly prefix: string; readonly owner: string }[] = Object.freeze([
  { prefix: 'BIND-PLAT-', owner: '协作平台卡（BIND-PLAT-*）归 packages/yt、packages/taiga、packages/localplatform 各包领土' },
  { prefix: 'BIND-WS-', owner: '工作区卡（BIND-WS-01）归工作区绑定落点（v2/12 §三），非本包' },
  { prefix: 'BIND-PRM-', owner: '策略投影承载卡（BIND-PRM-01）归投影落点（v2/12 §1.6），非本包' },
])

/**
 * 卡内不变量校验（装载期执行；返回问题清单，空数组＝合法）：
 *   - 必答行非空：ownerRef/宿主名与版本/覆盖/不支持/载体映射/供给/授权与生效/证据/损失/
 *     导出迁移退出/探针/现状（§0.4 十二行）；
 *   - 摘要位：computed 必须为 false（jcs@1 未证前不得当校验位）；
 *   - 载体映射行：status 与 unmappable **恰一**（不可表达不硬塞进现状四值）；
 *   - 探针行：ID 形如 PRB-NN、状态 ∈ 三值；现状面：状态 ∈ 四值、面名唯一；
 *   - 损失行：ID 形如 BIND-LOSS-NN、severity ∈ 三值、cannotClaim 非空。
 */
export function validateBindingCard(card: BindingCard): readonly string[] {
  const issues: string[] = []
  const need = (ok: boolean, issue: string): void => {
    if (!ok) issues.push(issue)
  }
  need(card.cardId !== '', '卡标识为空（引用必须带 ID）')
  need(/^v\d+\.\d+$/.test(card.cardVersion), `卡版本须为 v<主>.<次> 形（收到 ${JSON.stringify(card.cardVersion)}）`)
  need(card.ownerRef.trim() !== '', 'ownerRef 为空（无主＝不得引用，§0.4）')
  need(card.digest.computed === false, '摘要位 computed=true：jcs@1 跨实现未证前摘要必须标「未计算（目标）」，不得当校验位')
  need(card.host.name.trim() !== '', '宿主名为空')
  need(card.host.version.trim() !== '', '宿主版本为空（版本不符＝弃用；不写「当前最新」）')
  need(card.host.license.trim() !== '', '宿主许可为空（不默认继承仓库许可）')
  need(card.host.launchForm.trim() !== '', 'launch 形态为空（宿主与版本范围行必答）')
  need(card.host.supplyRef.trim() !== '', '供给引用为空（缺钉版本＝不得供给）')
  need(card.coverage.length > 0, '覆盖行为空（承载哪些语义必答）')
  need(card.unsupported.length > 0, '不支持行为空（不支持项逐条列，不得散文带过）')
  for (const row of card.carrierMap) {
    const hasStatus = row.status !== undefined
    const hasUnmappable = row.unmappable === true
    need(hasStatus !== hasUnmappable, `载体映射「${row.semantic}」须 status 与 unmappable 恰一（不可表达不是未证）`)
    if (row.status !== undefined) {
      need(
        (CARD_FACT_STATUSES as readonly string[]).includes(row.status),
        `载体映射「${row.semantic}」现状值非法：${String(row.status)}`,
      )
    }
    need(row.semantic.trim() !== '' && row.carrier.trim() !== '', '载体映射行缺语义/载体（无映射即无绑定）')
  }
  need(card.carrierMap.length > 0, '载体映射表为空（无映射即无绑定）')
  need(card.supply.length > 0, '供给行为空（来源/钉版本/完整性/许可必答）')
  need(card.authorization.mode === 'per-segment', '授权与生效行须按段计（mode=per-segment；不提供整体已生效布尔）')
  need(card.authorization.unsupportedSegmentRule.trim() !== '', '未承载段规则为空（§1.6 按段计状态必答）')
  need(card.authorization.notAuthority.trim() !== '', '授权行缺「绑定不是授权」声明（禁止用部署动作冒充授权决定）')
  need(card.evidence.length > 0, '证据行为空（无采集通道＝不得宣称可复核）')
  need(card.losses.length > 0, '损失行为空（绑定损失表行引用必答）')
  for (const loss of card.losses) {
    need(/^BIND-LOSS-\d{2}$/.test(loss.lossId), `损失 ID 非法：${loss.lossId}（形如 BIND-LOSS-NN）`)
    need(
      ['blocking', 'degrading', 'cosmetic'].includes(loss.severity),
      `损失 ${loss.lossId} severity 非法：${String(loss.severity)}`,
    )
    need(loss.cannotClaim.trim() !== '', `损失 ${loss.lossId} 缺 cannotClaim（该损失下不得作出的宣称）`)
  }
  need(card.exportExit.export.trim() !== '', '导出行为空')
  need(card.exportExit.migration.trim() !== '', '迁移行为空')
  need(card.exportExit.exit.trim() !== '', '退出行为空（无退出＝锁定，判缺陷）')
  need(card.probes.length > 0, '探针行为空（PRB- 行引用必答）')
  for (const probe of card.probes) {
    need(/^PRB-\d{2}$/.test(probe.probeId), `探针 ID 非法：${probe.probeId}（形如 PRB-NN）`)
    need(
      ['executed', 'not-executed', 'not-applicable'].includes(probe.state),
      `探针 ${probe.probeId} 状态非法：${String(probe.state)}（只有三值；未执行不得写「预期通过」）`,
    )
  }
  need(card.faces.length > 0, '现状行为空（每卡须产出「面→现状」表）')
  const seenFaces = new Set<string>()
  for (const face of card.faces) {
    need(face.face.trim() !== '' && face.anchor.trim() !== '', '现状面缺面名/锚点')
    need(
      (CARD_FACT_STATUSES as readonly string[]).includes(face.status),
      `现状面「${face.face}」状态非法：${String(face.status)}（四值：已有|库级|目标|未证）`,
    )
    need(!seenFaces.has(face.face), `现状面重复：${face.face}（一面一行，禁混写）`)
    seenFaces.add(face.face)
  }
  return Object.freeze(issues)
}

/** 外域/未知卡的拒收 detail（指名归属，不复制卡体） */
function unknownCardDetail(cardId: string): string {
  const hint = FOREIGN_CARD_HINTS.find((h) => cardId.startsWith(h.prefix))
  if (hint !== undefined) {
    return `未知绑定卡 ${JSON.stringify(cardId)}：${hint.owner}——本包只承载执行宿主卡 ${HOST_BINDING_CARD_IDS.join(' / ')}（不复制第二张表）`
  }
  return `未知绑定卡 ${JSON.stringify(cardId)}：本包只承载执行宿主卡 ${HOST_BINDING_CARD_IDS.join(' / ')}——未登记卡不回落、不冒充，也不复制第二张表`
}

/**
 * 绑定档案装载（唯一查表面）：
 *   - cardId 不在本包领土 → CONFIG_INVALID/bindcard/unknown-card（外域卡指名归属）；
 *   - hostVersion 给出且与卡钉住版本不符 → CONFIG_INVALID/bindcard/host-mismatch
 *     （版本不符＝弃用，不静默降级；换宿主＝新档案）；
 *   - 卡内不变量不合法 → CONFIG_INVALID/bindcard/card-invalid（坏卡不交给消费方）。
 */
export function loadBindingCard(
  cardId: string,
  hostVersion?: string,
): Result<BindingCard, ClassifiedError> {
  if (!isHostBindingCardId(cardId)) {
    return configErr('bindcard/unknown-card', unknownCardDetail(cardId))
  }
  const card = HOST_CARD_REGISTRY[cardId]
  const issues = validateBindingCard(card)
  if (issues.length > 0) {
    return configErr('bindcard/card-invalid', `${cardId} 卡内不变量不合法：${issues.join('；')}`)
  }
  if (hostVersion !== undefined && hostVersion !== card.host.version) {
    return configErr(
      'bindcard/host-mismatch',
      `${cardId} 钉住宿主版本 ${JSON.stringify(card.host.version)}，收到 ${JSON.stringify(hostVersion)}——版本不符＝弃用（换宿主＝新档案+能力重认，不静默降级）`,
    )
  }
  return okResult(card)
}

/** 按家族取卡（未登记家族 → undefined；装载口径同 loadBindingCard） */
export function bindingCardOfFamily(family: ExecutorFamily): BindingCard | undefined {
  const cardId = bindingCardIdOfFamily(family)
  return cardId === undefined ? undefined : HOST_CARD_REGISTRY[cardId]
}
