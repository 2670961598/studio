/**
 * daemon.yaml 标量强制件＋网关签根/绑定收口件（serve.ts 拆出——20-§十五.三.3 尺寸门「先拆再增」；
 * studio-dev-166 129-A 接线时腾位；MIG-07 / IMPL-07-06 扩容）
 *
 * 依据（实现单引用）：
 *   - docs/plan/05 IMPL-07-06「daemon.yaml schema 去 gateway 键＋DEV 默认密钥常量删除＋SEC-WD-02
 *     启动比对」（LANE-G；本文件即 plan/05 所指「serveconfig/coerce 等效件」）；
 *   - docs/v2/15 §一 SEC-FC-01（关掉即裸的键删除）／SEC-FC-02（签根无配置＝拒启，不回落仓内常量）；
 *     §三 SEC-WD-02（唯一绑定源＝部署面，org-config platform 不一致＝CONFIG_INVALID 拒启）。
 *
 * 内容：
 *   ① 标量收窄 str/num/bool（原样，逐字搬迁零行为漂移）；
 *   ② 已删除键的显式拒绝 rejectRemovedGatewayKey（`gateway`/`gatewaySecret`——不是「未知键」泛化）；
 *   ③ 签根解析 resolveGatewaySecret（env `STUDIO_GATEWAY_SECRET` ＞ 无公司目录 demo 临时随机；否则拒）；
 *   ④ SEC-WD-02 绑定比对 assertPlatformBinding（org-config company.platform vs daemon.yaml platform）；
 *   ⑤ daemonIdentity（签根＋快照 → 网关署名上下文/工号）——serve/runtime.ts 经 serve/config.ts 同源取用；
 *   ⑥ seatbelt 配置通道 coerceSeatbeltGrant（daemon.yaml 三键 → SeatbeltGrant；缺省不写=read-only，
 *      workspace-write 须显式 tier＋绝对路径根＋授权留痕——IMPL-07-09 随动）。
 *
 * 边界：本文件零业务 IO；唯一进程面＝env 秘密读取（只报键名不报值）与 demo 随机源（可注入求确定性）。
 */

import { randomBytes } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { DEFAULT_SEATBELT_TIER, resolveSeatbeltGrant, SEATBELT_TIERS, type SeatbeltGrant } from '@studio-next/adapters'
import { configInvalid } from '@studio-next/contract'
import type { CompanySnapshot } from '@studio-next/contract'
import type { SignatureContext } from '@studio-next/gateway'
import { ENGINE_CONFIG_DEFAULTS } from '../../engine/engine.ts'
import type { ServeConfig } from '../serve/config.ts'

/** 键值须为非空字符串（缺省回填后的显式键校验） */
export function str(v: unknown, key: string): string {
  if (typeof v !== 'string' || v === '') throw new Error(`daemon.yaml：${key} 须为非空字符串`)
  return v
}

/** 键值须为非负有限数 */
export function num(v: unknown, key: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`daemon.yaml：${key} 须为非负数`)
  return v
}

/** 键值须为布尔字面量 */
export function bool(v: unknown, key: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`daemon.yaml：${key} 须为 true/false`)
  return v
}

// ---------------------------------------------------------------------------
// seatbelt 配置通道（IMPL-07-09 随动；daemon.yaml 三键 → SeatbeltGrant）
// ---------------------------------------------------------------------------

/** seatbelt 三键原文（serve/config.ts 扁平解析后交接；键缺省不写＝undefined） */
export interface SeatbeltConfigRaw {
  tier?: string | number | boolean
  writeRoots?: string | number | boolean
  authorization?: string | number | boolean
}

/**
 * daemon.yaml seatbelt 三键 → 派工圈定授权（**缺省不写＝undefined＝read-only 最严**）。
 * fail-closed 校验（不静默放宽、不静默补全）：
 *   - tier 值域封闭（read-only|workspace-write；'off' 一类「关掉即裸」拒）；
 *   - read-only（含未写 tier 的缺省档）给 roots/authorization → 拒（read-only 无放宽面）；
 *   - workspace-write 缺 roots/authorization、roots 非 JSON 数组/空数组/非字符串项/相对路径 → 拒；
 *   - 档位语义二道守门＝resolveSeatbeltGrant（本文件不复制规则，只做 YAML 形态收窄）。
 */
export function coerceSeatbeltGrant(raw: SeatbeltConfigRaw): SeatbeltGrant | undefined {
  if (raw.tier === undefined && raw.writeRoots === undefined && raw.authorization === undefined) return undefined
  const tier = raw.tier === undefined ? DEFAULT_SEATBELT_TIER : str(raw.tier, 'seatbeltTier')
  if (!SEATBELT_TIERS.some((allowed) => allowed === tier)) {
    throw new Error(
      `daemon.yaml：seatbeltTier 须为 ${SEATBELT_TIERS.join('|')}（实得 ${tier}）——'off' 一类「关掉即裸」不是档位`,
    )
  }
  if (tier === 'read-only') {
    if (raw.writeRoots !== undefined) {
      throw new Error(
        'daemon.yaml：read-only 档（含未声明 seatbeltTier 的缺省档）不得给 seatbeltWriteRoots（放宽须显式 tier: workspace-write）',
      )
    }
    if (raw.authorization !== undefined) {
      throw new Error(
        'daemon.yaml：read-only 档（含未声明 seatbeltTier 的缺省档）不得给 seatbeltAuthorization（read-only 无放宽面）',
      )
    }
    return { tier: 'read-only' }
  }
  if (raw.writeRoots === undefined) {
    throw new Error('daemon.yaml：seatbeltTier: workspace-write 须配 seatbeltWriteRoots（JSON 数组字符串，绝对路径）')
  }
  if (raw.authorization === undefined) {
    throw new Error('daemon.yaml：seatbeltTier: workspace-write 须配 seatbeltAuthorization（谁/何单/何策略）')
  }
  const writeRoots = parseSeatbeltWriteRoots(str(raw.writeRoots, 'seatbeltWriteRoots'))
  const authorization = str(raw.authorization, 'seatbeltAuthorization').trim()
  if (authorization === '') throw new Error('daemon.yaml：seatbeltAuthorization 须非空白（谁/何单/何策略）')
  resolveSeatbeltGrant({ tier: 'workspace-write', writeRoots, authorization }) // 二道守门（空数组/相对路径/档位语义）
  return { tier: 'workspace-write', writeRoots, authorization }
}

/** JSON 数组字符串 → 绝对路径根列表（非 JSON/非数组/空数组/非字符串项/相对路径一律拒） */
function parseSeatbeltWriteRoots(raw: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`daemon.yaml：seatbeltWriteRoots 须为 JSON 数组字符串（如 '["/abs/root"]'；实得 ${JSON.stringify(raw)}）`)
  }
  if (!Array.isArray(parsed)) throw new Error('daemon.yaml：seatbeltWriteRoots 须为 JSON 数组（收到非数组 JSON）')
  if (parsed.length === 0) throw new Error('daemon.yaml：seatbeltWriteRoots 不得为空数组——workspace-write 须显式点名写域根')
  return parsed.map((root): string => {
    if (typeof root !== 'string' || root === '' || !isAbsolute(root)) {
      throw new Error(
        `daemon.yaml：seatbeltWriteRoots 每项须为绝对路径字符串（收到 ${JSON.stringify(root)}）——相对路径根在内核面按 cwd 解析＝隐式放宽`,
      )
    }
    if (/[\u0000-\u001f\u007f]/.test(root)) {
      throw new Error(
        `daemon.yaml：seatbeltWriteRoots 不得含控制字符（收到 ${JSON.stringify(root)}）——profile 文法按行渲染，换行/制表会断行或注入`,
      )
    }
    const normalized = resolve(root)
    if (normalized === '/') {
      throw new Error('daemon.yaml：seatbeltWriteRoots 不得为根目录 /（显式全盘写域；请点名具体写根，不做根最小化）')
    }
    return normalized
  })
}

/** 网关签根 env-ref 名（`SEC-GW-SIGNING` 的 v0 env 通道；键名可露面，值永不入日志/台账） */
export const GATEWAY_SECRET_ENV = 'STUDIO_GATEWAY_SECRET'

/**
 * 已删除配置键的显式拒绝（SEC-FC-01/02）：`gateway`（关掉即裸的开关）与 `gatewaySecret`
 * （yaml 承载签根值）两键从生产配置面删除——命中即 `CONFIG_INVALID/gateway-key-removed`，
 * 不按「未知键」泛化处理（要让人读到「键已被规范删除＋替代供给面」，不是拼写错误）。
 */
export function rejectRemovedGatewayKey(key: string): never {
  configInvalid(
    'gateway-key-removed',
    `daemon.yaml ${key} 键已删除（SEC-FC-01/02）——平台写路径恒过闸、无关闭键；签根只从部署秘密源注入：` +
      `env ${GATEWAY_SECRET_ENV}（值永不入 daemon.yaml/日志/台账）`,
  )
}

/**
 * 签根供给（SEC-FC-02 fail-closed）：env 值 → 注入；无公司目录 demo → 进程内临时随机；
 * 其余＝`CONFIG_INVALID/gw-secret-missing` 拒启。**无仓内缺省常量**（旧开发缺省已删）。
 */
export interface GatewaySecretSource {
  /** 部署秘密源（缺省 process.env；注入求确定性） */
  env?: Record<string, string | undefined>
  /** demo 临时签根随机源（缺省 crypto.randomBytes；注入求确定性） */
  random?: (bytes: number) => Uint8Array
}

/** 签根来源判读（进启动日志/证据；**值与材料永不出现**） */
export type GatewaySecretOrigin = 'env' | 'demo-ephemeral'

export interface ResolvedGatewaySecret {
  secret: Uint8Array
  origin: GatewaySecretOrigin
}

/**
 * 解析网关签根：env 优先（空串＝已配置但坏形态，**不落 demo 兜底**——fail-closed）；
 * env 缺 → 仅「无公司目录 demo」（companyDir 未给且 platform: fake）允许进程内临时随机签根
 * （重启即换、不可跨进程验，故只服务 demo 装配），其余一律 `CONFIG_INVALID` 拒启。
 */
export function resolveGatewaySecret(
  config: Pick<ServeConfig, 'platform' | 'companyDir'>,
  source?: GatewaySecretSource,
): ResolvedGatewaySecret {
  const env = source?.env ?? process.env
  const raw = env[GATEWAY_SECRET_ENV]
  if (typeof raw === 'string' && raw !== '') {
    return { secret: new TextEncoder().encode(raw), origin: 'env' }
  }
  if (raw === '') {
    configInvalid('gw-secret-empty', `env ${GATEWAY_SECRET_ENV} 已设为空串（空签根不是「未配置」——SEC-FC-02 拒启）`)
  }
  if (config.companyDir === undefined && config.platform === 'fake') {
    const random = source?.random ?? ((bytes: number): Uint8Array => randomBytes(bytes))
    return { secret: random(32), origin: 'demo-ephemeral' }
  }
  configInvalid(
    'gw-secret-missing',
    `网关签根未配置：需部署秘密源注入 env ${GATEWAY_SECRET_ENV}（SEC-FC-02：无配置＝拒启，仓内无缺省密钥、` +
      'daemon.yaml 不承载密钥值）；仅「无公司目录 demo 装配」（companyDir 未给且 platform: fake）走进程内临时签根',
  )
}

/**
 * SEC-WD-02 绑定唯一源与一致性校验（v2/15 §三）：唯一绑定源＝部署面（daemon.yaml），
 * org-config `company.platform` 降为声明/期望；启动时二者比对，不一致＝`CONFIG_INVALID` 拒启。
 * 只在公司目录在场时比对（无公司目录＝无 org-config 声明面可对，demo/夹具装配无从错绑）。
 * 注：org-config 未声明 platform 时装载面 validator 缺省 `youtrack`（company/src/validator.ts）
 * ——缺省即视为声明，与部署面不同即拒（这正是要暴露的静默错绑；修法＝显式声明或改部署面）。
 */
export function assertPlatformBinding(
  config: Pick<ServeConfig, 'platform' | 'companyDir'>,
  snapshot: CompanySnapshot,
): void {
  if (config.companyDir === undefined) return
  const declared = String(snapshot.platform?.platform ?? '')
    .trim()
    .toLowerCase()
  const deployed = config.platform.trim().toLowerCase()
  if (declared === deployed) return
  configInvalid(
    'platform-binding-mismatch',
    `org-config company.platform=${declared === '' ? '（缺）' : declared} 与 daemon.yaml platform=${deployed} 不一致` +
      '（SEC-WD-02：唯一绑定源＝部署面，不一致即拒启，不得静默错绑；org-config 未声明时装载缺省 youtrack——须显式声明或改 daemon.yaml）',
  )
}

/** daemon 侧网关身份（控制面与 worker-key 签发共用的签根/署名上下文/工号） */
export interface DaemonIdentity {
  /** HMAC 签根材料（只进 gateway；永不入日志/台账/错误消息） */
  secret: Uint8Array
  ctx: SignatureContext
  author: string
  /** 签根来源（装配日志降级标记判读面；值/材料永不出现） */
  secretSource: GatewaySecretOrigin
}

/**
 * daemon 侧网关身份（控制面与 worker-key 签发共用的签根/署名上下文/工号）。
 *
 * 启动序（任一步失败＝拒启，不降级）：
 *   ①SEC-WD-02 绑定比对（org-config platform vs daemon.yaml platform）→ 不一致拒；
 *   ②签根解析（env `STUDIO_GATEWAY_SECRET` ＞ 无公司目录 demo 临时随机；否则拒——SEC-FC-02）。
 * 签根长度/弱形态二道门在 `createGateway`（gateway 包，构造期 CONFIG_INVALID）。
 *
 * 签名上下文取快照首部门+公司级（控制面无人员档案，拟稿待批）。
 * **L1 热重载活对象**（docs/38-§2）：gateway 逐调用读 ctx 字段——reload 时 mutate
 * company/dept/level 三字段即全 daemon 署名跟随新组织（hot-reload apply 段唯一写者）。
 */
export function daemonIdentity(config: ServeConfig, snapshot: CompanySnapshot, source?: GatewaySecretSource): DaemonIdentity {
  assertPlatformBinding(config, snapshot)
  const resolved = resolveGatewaySecret(config, source)
  return {
    secret: resolved.secret,
    secretSource: resolved.origin,
    ctx: {
      company: snapshot.name,
      dept: snapshot.departments[0]?.path ?? ENGINE_CONFIG_DEFAULTS.deptFallback,
      role: 'daemon',
      level: Math.max(1, snapshot.level),
    },
    author: ENGINE_CONFIG_DEFAULTS.actor,
  }
}
