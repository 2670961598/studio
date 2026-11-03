/**
 * assembly/trust/wire —— `PORT-TRUST` 生产装配腿（凭据目录接线，studio-dev-544 差距项 #18）
 *
 * 依据：docs/v2/14 §1.7（PORT-TRUST）、docs/v2/15 §4.1/4.3/4.5（五型/轮换吊销/三不入）、
 *   docs/v2/11 §2.2（REC-AUTH-04）、docs/v2/17 §4.1（NEG-SEC-08）；实现体在
 *   `packages/gateway/src/trust.ts`（目录/判定/拒绝码唯一源，本件只做装配与观测行）。
 *
 * 装配纪律（fail-closed）：
 *   - 声明未注入 ＝ 目录空置：伙伴档/供给路径全部拒（不回落匿名、不造缺省条目）；
 *   - 声明注入但形状非法/重复/必需秘密缺证 ＝ `createSecretTrust` 构造期 `CONFIG_INVALID`
 *     抛错——启动即拒（对象不产出，不降级为告警继续）；
 *   - 观测行只报条数/五型类别/逻辑引用纪律，**不报任何值/环境变量值**。
 */
import { createSecretTrust, readSecretDeclarations as readDeclarations, type SecretDeclaration, type SecretTrust } from '@studio-next/gateway'

/** 组合根/runServe 注入形状（引用侧字段；与 gateway `SecretDeclaration` 单一源） */
export type SecretDeclarationInput = SecretDeclaration

export interface WireSecretTrustArgs {
  /** 部署声明全集（缺省＝未注入＝目录空置；空数组＝显式空目录） */
  readonly declarations?: readonly SecretDeclarationInput[]
  /** 必需秘密 id（缺一条即拒启；如部署期 `['SEC-MX-BOT-PASSWORD']`） */
  readonly requiredSecretIds?: readonly string[]
  readonly clock?: () => number
  readonly log?: (line: string) => void
}

/** 声明 JSON 形状闸（组合根读文件后调用；单一声明判据仍归 gateway 构造器） */
export function readSecretDeclarations(raw: unknown): readonly SecretDeclarationInput[] {
  return readDeclarations(raw) as readonly SecretDeclarationInput[]
}

/** 装配 PORT-TRUST：未注入→undefined（fail-closed 面保留）；注入→构造期全量登记 */
export function wireSecretTrust(args: WireSecretTrustArgs = {}): SecretTrust | undefined {
  const log = args.log ?? ((): void => {})
  if (args.declarations === undefined) {
    log('[serve] PORT-TRUST 凭据目录：未注入秘密声明——目录空置，伙伴档/短时供给一律 fail-closed（缺口如实登记，不回落匿名）')
    return undefined
  }
  const trust = createSecretTrust({
    declarations: args.declarations,
    ...(args.requiredSecretIds !== undefined ? { requiredSecretIds: args.requiredSecretIds } : {}),
    ...(args.clock !== undefined ? { clock: args.clock } : {}),
  })
  const rows = trust.rows()
  log(
    `[serve] PORT-TRUST 凭据目录已接：${String(rows.length)} 条（五型分类/用途 allowedUses/短时供给/轮换/吊销；` +
      '非法/缺证/未知引用即拒；目录只存类别＋逻辑引用，值不入目录/提示词/日志）',
  )
  return trust
}
