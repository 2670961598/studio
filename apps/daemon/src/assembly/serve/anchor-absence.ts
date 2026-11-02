// anchor-absence —— 装配「显式声明无锚」的 daemon.yaml 解析（SEC-FC-03；docs/44-§2.3-4）
//
// 语义（docs/v2/15 §一 SEC-FC-03）：「无锚」只允许出现在**显式声明无锚**的装配并记台账；
// init 通道目录不落锚（packages/company/src/init.ts 不写 trust.json）＝ docs/44-§2.3-4
// 「init 通道目录无锚＝闸不适用（存量行为不变）」的装配面显式化。
//
// 声明面＝daemon.yaml 两个扁平键（v0 只收扁平 `key: value` 子集，嵌套不收）：
//   reloadAnchorAbsenceDeclaredBy: <声明人/通道标识>   # 出现即＝本装配声明无锚
//   reloadAnchorAbsenceReason: <为何无锚>              # 可选；随启动日志/RELOAD note 留痕
//
// 失败面（fail-closed，一律 CONFIG_INVALID 明报不猜）：
//   - 只给 reason 不给 declaredBy → 拒（只给理由＝未声明，不得静默放行）；
//   - declaredBy 空白/超长 → 拒；
//   - 无 companyDir 却声明 → 拒（热重载不装配，声明无消费面＝配置错）。
//
// 生效边界（本文件只做解析，不做放行判定）：声明只在锚**不在场**时被 hot-reload 应用门
// 消费；合法锚优先于声明（锚在场走批准指纹面）；坏锚仍拒启/拒应用——声明不是「跳过
// 信任锚」的开关（docs/v2/15 SEC-FC-03 负向义务 N-d）。
import type { AnchorAbsenceDeclaration } from '../../control/hot-reload.ts'

/** 声明人标识长度上限（防把整段说明塞进台账单行字段） */
const DECLARED_BY_MAX = 200

/** daemon.yaml 两键原文（coerceServeConfig 循环内收集，循环后一次收口） */
export interface AnchorAbsenceRaw {
  declaredBy?: string
  reason?: string
}

/**
 * 两键 → 装配声明。undefined＝未声明（无锚仍拒，fail-closed 保持）。
 * ctx.companyDir＝undefined（未挂公司目录）时带声明＝CONFIG_INVALID（声明无消费面）。
 */
export function coerceAnchorAbsenceDeclaration(
  raw: AnchorAbsenceRaw,
  ctx: { companyDir: string | undefined },
): AnchorAbsenceDeclaration | undefined {
  const declaredBy = raw.declaredBy?.trim() ?? ''
  const reason = raw.reason?.trim() ?? ''
  if (declaredBy === '') {
    if (reason !== '') {
      throw new Error(
        'daemon.yaml：reloadAnchorAbsenceReason 必须与 reloadAnchorAbsenceDeclaredBy 同时出现（只给理由＝未声明无锚，不得静默放行）',
      )
    }
    return undefined
  }
  if (declaredBy.length > DECLARED_BY_MAX) {
    throw new Error(`daemon.yaml：reloadAnchorAbsenceDeclaredBy 超长（${declaredBy.length} > ${DECLARED_BY_MAX}）`)
  }
  if (ctx.companyDir === undefined) {
    throw new Error(
      'daemon.yaml：reloadAnchorAbsenceDeclaredBy 只在 companyDir 给定时生效（无公司目录＝热重载不装配，声明无消费面）',
    )
  }
  return { declaredBy, ...(reason !== '' ? { reason } : {}) }
}
