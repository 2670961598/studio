/**
 * three-not-in —— 「不入库｜不入提示词｜不入日志」三不入强制点目录（IMPL-07-11）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/15 §4.5（SEC-SEC-05）：三不入各自的强制点（v1 只有零星纪律，均目标未证）；
 *       · **库**：daemon.yaml/公司目录 schema 无秘密值字段位，台账写入前 redaction；
 *       · **提示词**：派发简报只携类别＋逻辑引用（v2/07 EXEC-01），组装器对成品简报跑
 *         出站闸同款扫描；
 *       · **日志**：日志层模式扫描（值形态＋ env 名全打印检测）；
 *     违反三任一＝安全事件入账（失败如实分类上报，AGENTS §五.5 同源）；
 *   - docs/plan/05 IMPL-07-11 交付「三不入强制点测试」；docs/v2/17 NEG-SEC-07/N-g 同单。
 *
 * 口径：本目录只声明**强制点位置与判负口径**；执行体在 gate.ts（scan.ts 是扫描核），
 * 装配点接线在 wire.ts + assembly/serve/runtime.ts——目录不复制实现，避免两份口径。
 */

/** 三不入点 id（gate 计数与失败记录的键空间；与五出口 id 分开命名空间） */
export const THREE_NOT_IN_IDS = ['store', 'prompt', 'log'] as const

/** 三不入点 id */
export type ThreeNotInId = (typeof THREE_NOT_IN_IDS)[number]

/** 单点定义（enforcement=判负口径；wiring=生产装配点事实） */
export interface ThreeNotInDef {
  readonly id: ThreeNotInId
  readonly label: string
  readonly enforcement: string
  readonly wiring: string
}

/**
 * 三不入目录（唯一源）：
 *   - store ：`Ledger.appendEvent` 是 events 唯一写口（store 纪律）——写前过闸；
 *   - prompt：成品 brief.text 出口过严格档（只换已知值、不做形状兜底——内部供给面示例文本
 *             必须原样可见，docs/80-§11.2.1 分工）；
 *   - log   ：每条日志行过「值形态＋env 名打印」扫描，检出即抹值/整行拦截。
 */
export const THREE_NOT_IN_CATALOG: readonly ThreeNotInDef[] = [
  {
    id: 'store',
    label: '不入库',
    enforcement:
      '台账写入前过闸：appendEvent 记录深扫（已知值＋形状），脱敏后仍检出＝阻断该次写入（fail-closed）',
    wiring:
      'runtime.ts 装配序开头 ledger=createStoreWriteGuard(ledger, gate)——此后 engine/hr-sync/' +
      'notify/播种/热重载共享受闸写口（单点收口，不是每个消费者各记得一次）',
  },
  {
    id: 'prompt',
    label: '不入提示词',
    enforcement:
      '成品 brief.text 过严格档扫描（只换已知值；不做形状兜底——教学/示例文本原样可见），' +
      '残留已知值＝阻断该次出口；AGENTS.md 等无通道出口逐条登记缺口（prompt-assembly exitScan.gaps）',
    wiring: 'runtime.ts createDefaultAssembler({ redactKnown: gate.promptRedactor })',
  },
  {
    id: 'log',
    label: '不入日志',
    enforcement:
      '日志行过「值形态＋env 名打印」扫描：env 名带值打印＝检出即抹值（保留键名）；' +
      '脱敏失败/形态不可判＝整行拦截（原值不落日志），失败进失败台账',
    wiring: 'runtime.ts log=guardLog(rawLog, gate)',
  },
]

/** 单点查表（未知 id 显式抛错——不返回 undefined） */
export function threeNotInDef(id: ThreeNotInId): ThreeNotInDef {
  const found = THREE_NOT_IN_CATALOG.find((p) => p.id === id)
  if (found === undefined) throw new Error(`outbound-gate：未知三不入点 id=${String(id)}（见 three-not-in.ts）`)
  return found
}
