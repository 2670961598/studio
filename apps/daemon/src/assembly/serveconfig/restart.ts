/**
 * serveconfig/restart —— 受权重启配置面（studio-dev-504 S4）
 *
 * 依据：#497 plan §5（daemon.yaml 七键；全部可缺省、缺省即关/最严）、§4.6（授权预登记）、
 *   C-6（restartEnabled 缺省 false；S1–S5 全绿且 #485/#496 就位后由制作人下令开面）。
 *
 * fail-closed 纪律（沿用 coerceSeatbeltGrant 风格）：
 *   - false 时出现任何 restart* 从键（除 restartEnabled 自身）→ CONFIG_INVALID：关就是关，
 *     不留半开面；
 *   - true 时缺授权源/坏 JSON/空数组/全量过期/期限越界/策略值域外 → CONFIG_INVALID 拒启；
 *   - 本模块只归配置形状，不做授权放行（运行期校验在 control/restart/channel.ts）。
 */
import { loadRestartAuthorizations } from '../../control/restart/channel.ts'

/** 受权重启配置子面（ServeConfig extends 本接口） */
export interface RestartServeConfig {
  /** 总开关（缺省 false=控制面重启请求一律拒，生产零行为） */
  restartEnabled: boolean
  /** 部署面预登记授权文件（0600；与 restartAuthorizations 二选一） */
  restartAuthorizationFile?: string
  /** 内联授权 JSON 数组字符串（单机/测试形态） */
  restartAuthorizations?: string
  /** 在途结算上限 ms（缺省 180000；请求只能收紧，下限 5000/上限 1800000） */
  restartDrainTimeoutMs: number
  /** 启动自检 tick 窗口（缺省 3） */
  restartSelfcheckTicks: number
  /** 自检总超时 ms（缺省 15000） */
  restartSelfcheckTimeoutMs: number
  /** 版本对齐策略（advance|strict|off；缺省 advance） */
  restartVersionAlignPolicy: 'advance' | 'strict' | 'off'
  /** 附加授权白名单（逗号/分号清单；仍须过组织面与授权面） */
  restartAuthorizers?: string
}

export const RESTART_SERVE_DEFAULTS: RestartServeConfig = {
  restartEnabled: false,
  restartDrainTimeoutMs: 180_000,
  restartSelfcheckTicks: 3,
  restartSelfcheckTimeoutMs: 15_000,
  restartVersionAlignPolicy: 'advance',
}

const RESTART_KEYS = new Set([
  'restartEnabled',
  'restartAuthorizationFile',
  'restartAuthorizations',
  'restartDrainTimeoutMs',
  'restartSelfcheckTicks',
  'restartSelfcheckTimeoutMs',
  'restartVersionAlignPolicy',
  'restartAuthorizers',
])

export function isRestartKey(key: string): boolean {
  return RESTART_KEYS.has(key)
}

/** 解析 restartAuthorizers 清单（逗号/分号/空白分隔；空段忽略） */
export function parseRestartAuthorizers(spec: string | undefined): ReadonlySet<string> {
  if (spec === undefined) return new Set()
  return new Set(
    spec
      .split(/[,;，；\s]+/)
      .map((s) => s.trim())
      .filter((s) => s !== ''),
  )
}

/**
 * 单键归位（config.ts 扁平解析 switch 的 restart 段；值域校验在此 fail-closed）。
 * 返回 true=已消费该键。
 */
export function coerceRestartServeKey(
  cfg: RestartServeConfig,
  key: string,
  value: string | number | boolean,
  helpers: { str: (v: unknown, k: string) => string; num: (v: unknown, k: string) => number; bool: (v: unknown, k: string) => boolean },
): boolean {
  switch (key) {
    case 'restartEnabled':
      cfg.restartEnabled = helpers.bool(value, key)
      return true
    case 'restartAuthorizationFile':
      cfg.restartAuthorizationFile = helpers.str(value, key)
      return true
    case 'restartAuthorizations': {
      const text = helpers.str(value, key)
      try {
        loadRestartAuthorizations({ inline: text })
      } catch (err) {
        throw new Error(`daemon.yaml：restartAuthorizations 非法（${err instanceof Error ? err.message : String(err)}）`)
      }
      cfg.restartAuthorizations = text
      return true
    }
    case 'restartDrainTimeoutMs': {
      const v = helpers.num(value, key)
      if (!Number.isInteger(v) || v < 5_000 || v > 1_800_000) {
        throw new Error(`daemon.yaml：restartDrainTimeoutMs 须为 5000..1800000 整数（实得 ${v}）`)
      }
      cfg.restartDrainTimeoutMs = v
      return true
    }
    case 'restartSelfcheckTicks': {
      const v = helpers.num(value, key)
      if (!Number.isInteger(v) || v < 1 || v > 100) throw new Error(`daemon.yaml：restartSelfcheckTicks 须为 1..100 整数（实得 ${v}）`)
      cfg.restartSelfcheckTicks = v
      return true
    }
    case 'restartSelfcheckTimeoutMs': {
      const v = helpers.num(value, key)
      if (!Number.isInteger(v) || v < 1_000 || v > 300_000) {
        throw new Error(`daemon.yaml：restartSelfcheckTimeoutMs 须为 1000..300000 整数（实得 ${v}）`)
      }
      cfg.restartSelfcheckTimeoutMs = v
      return true
    }
    case 'restartVersionAlignPolicy': {
      const v = helpers.str(value, key)
      if (v !== 'advance' && v !== 'strict' && v !== 'off') {
        throw new Error(`daemon.yaml：restartVersionAlignPolicy 须为 advance|strict|off（实得 ${v}）`)
      }
      cfg.restartVersionAlignPolicy = v
      return true
    }
    case 'restartAuthorizers':
      cfg.restartAuthorizers = helpers.str(value, key)
      return true
    default:
      return false
  }
}

/**
 * 交叉校验（config.ts 循环后一次性收口）：
 *   - 关面时任何 restart* 从键出现即拒（「关就是关，不留半开面」）；
 *   - 开面须恰有授权源（file/inline 二选一）、非空、至少一条未过期；
 *   - 授权文件的存在/owner/0600 由运行期装载守（此处不重复 IO，坏形态启动即拒）。
 */
export function validateRestartCross(cfg: RestartServeConfig, rawKeys: ReadonlySet<string>, now = Date.now()): void {
  const restartKeysPresent = [...rawKeys].filter((k) => isRestartKey(k))
  if (!cfg.restartEnabled) {
    const extra = restartKeysPresent.filter((k) => k !== 'restartEnabled')
    if (extra.length > 0) {
      throw new Error(`daemon.yaml：restartEnabled=false 时不得携带 restart* 键（${extra.join('、')}）——关就是关，不留半开面`)
    }
    return
  }
  const sources = [cfg.restartAuthorizationFile !== undefined, cfg.restartAuthorizations !== undefined].filter(Boolean).length
  if (sources === 0) throw new Error('daemon.yaml：restartEnabled=true 须配 restartAuthorizationFile 或 restartAuthorizations')
  if (sources > 1) throw new Error('daemon.yaml：restartAuthorizationFile 与 restartAuthorizations 二选一（不得双源）')
  let entries
  try {
    entries =
      cfg.restartAuthorizations !== undefined
        ? loadRestartAuthorizations({ inline: cfg.restartAuthorizations })
        : loadRestartAuthorizations({ file: cfg.restartAuthorizationFile ?? '' })
  } catch (err) {
    throw new Error(`daemon.yaml：重启授权装载失败（${err instanceof Error ? err.message : String(err)}）`)
  }
  if (entries.length === 0) throw new Error('daemon.yaml：重启授权数组为空（开面必须有可用授权）')
  if (!entries.some((e) => now >= e.issuedAt && now <= e.expiresAt)) {
    throw new Error('daemon.yaml：重启授权全部过期（开面必须有至少一条有效期内的授权）')
  }
}
