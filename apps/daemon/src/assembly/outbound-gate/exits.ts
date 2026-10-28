/**
 * exits —— 出站闸出口目录（五出口的唯一定义处；IMPL-07-11）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/plan/05 IMPL-07-11「出站扫描承担面·出站闸＋三不入」：统一出站闸覆盖
 *     **平台写 / 通知 / 证据导出 / 日志外发 / API 响应**五出口；其余出口登记 gap 不静默；
 *   - docs/v2/15 §4.4（SEC-SEC-04）：承担者＝框架出站文本闸（daemon 出站通道统一件，
 *     覆盖全部出站出口）；「无扫描通道的出口登记缺口不得静默放行」；
 *   - docs/v2/15 §4.5（SEC-SEC-05）：「不入库｜不入提示词｜不入日志」三不入强制点；
 *   - docs/v2/17 NEG-SEC-07/N-g（出站扫描失败事件可判定＋覆盖全出口）；
 *   - docs/audit-DSF/V13-01（现状：八个出口只覆盖三个且只对 hrSync 生效——本目录把
 *     「出口」收敛为五个可判定条目，逐条给装配状态，缺口显式登记）。
 *
 * 口径纪律：目录是**静态声明**（哪些出口存在、各自怎么装配、哪些是缺口）；运行期计数
 * 由 gate.coverage() 合并本目录给出——目录本身不因一次运行而变。
 */

/** 五出口（v2/15 §4.4 冻结清单；增删出口＝改本表＋提案流，不在调用点散写字符串） */
export const OUTBOUND_EXIT_IDS = [
  'platform-write',
  'notify',
  'evidence-export',
  'log-egress',
  'api-response',
] as const

/** 出口 id（出站闸一切计数/失败记录的键空间） */
export type OutboundExitId = (typeof OUTBOUND_EXIT_IDS)[number]

/**
 * 装配状态：
 *   - `wired`：生产装配点已过闸（runServe 装配真实接线，见 wiring 列）；
 *   - `gap`  ：闸侧 wrapper 已备，但生产装配点尚未落位/尚无该通道——**显式 gap**，
 *              不冒充已覆盖（gap 码见 gap 列，逐条可判定）。
 */
export type OutboundExitStatus = 'wired' | 'gap'

/** 单出口定义（catalog 行；wiring/gap 列即观察面——谁维护出口、缺口在哪） */
export interface OutboundExitDef {
  readonly id: OutboundExitId
  /** 人话名（日志/报告用） */
  readonly label: string
  readonly status: OutboundExitStatus
  /** 装配事实（哪一行装配点过闸；wired 必填，gap 时写「闸侧 wrapper 已备」） */
  readonly wiring: string
  /** gap 码（status='gap' 必填；`<exit>:<原因>` 形，进 coverage.gaps） */
  readonly gap?: string
}

/**
 * 五出口目录（docs/v2/15 §4.4 清单；本表是唯一源）。
 * 装配点均在 `assembly/serve/runtime.ts`（runServe 装配序）——出口义务先于通道：
 * 通道未接线的出口登记 gap，通道接线的出口走统一闸，二者都不静默。
 */
export const OUTBOUND_EXIT_CATALOG: readonly OutboundExitDef[] = [
  {
    id: 'platform-write',
    label: '平台写',
    status: 'wired',
    wiring:
      'runtime.ts createEngine platform=wrapPlatform(gatedPlatform)：issues.create/setField、' +
      'comments.add、kb.upsert 输入端过闸（redactOutbound 已知值＋形状兜底；命中即改后出站，' +
      '脱敏失败/形态不可判＝fail-closed 阻断该次写）',
  },
  {
    id: 'notify',
    label: '通知',
    status: 'wired',
    wiring:
      'runtime.ts notifyBroadcast 面注入 wrapNotifyFace：Notification（title/body/links）出站前过闸；' +
      '闸阻断时按「发送≠接受」软失败面返回 failed（notify-blocked 可判定，不抛不静默）',
  },
  {
    id: 'evidence-export',
    label: '证据导出',
    status: 'gap',
    wiring: '闸侧 wrapper 已备（wireOutboundGate().guardEvidenceExport）；生产装配点未落位',
    gap: 'evidence-export:no-export-channel',
  },
  {
    id: 'log-egress',
    label: '日志外发',
    status: 'wired',
    wiring:
      'runtime.ts log=guardLog(rawLog)：每条日志行过「值形态＋env 名打印」扫描；' +
      '拦截行整行替换（不落原值），失败进失败台账（redaction-failed/env-print-blocked）',
  },
  {
    id: 'api-response',
    label: 'API 响应',
    status: 'gap',
    wiring:
      '闸侧 wrapper 已备（wireOutboundGate().guardApiResponse）；runServe 的 API 装配位（assembleApi）' +
      '尚未接线（IMPL-06-07/08 端点族接线单），响应面当前无生产出口',
    gap: 'api-response:api-assembly-not-wired',
  },
]

/** 单出口查表（未知 id 显式抛错——不返回 undefined 让调用方自猜） */
export function outboundExitDef(id: OutboundExitId): OutboundExitDef {
  const found = OUTBOUND_EXIT_CATALOG.find((e) => e.id === id)
  if (found === undefined) throw new Error(`outbound-gate：未知出口 id=${String(id)}（五出口见 exits.ts）`)
  return found
}

/**
 * 显式缺口码全集（status='gap' 的出口逐条列出）。
 * 用途：装配日志/测试断言/观察面——「当前有几个出口没有扫描通道」是可直接读出的数字，
 * 不是靠人记得住的纪律（v2/15 §4.4「不得静默放行」）。
 */
export function outboundExitGaps(): readonly string[] {
  const out: string[] = []
  for (const exit of OUTBOUND_EXIT_CATALOG) {
    if (exit.status === 'gap' && exit.gap !== undefined) out.push(exit.gap)
  }
  return out
}
