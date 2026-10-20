/**
 * config —— 人事同步器装配配置面（DEV-48，docs/52-§九；BC-S2 先拆再增：自 serve.ts 拆出）
 *
 * 规格依据：docs/52-§九（hr-sync 开关族）+ §9.2（maxHrSyncPerTick/retryLimit/applying 窗）+
 * §6.1（hrTaigaInviteLog——邀请令牌只落 console/邮件日志）+ §7.2（hrMatrixRooms 房间面）。
 * 本模块只承载 ServeConfig 的 hr* 字段子面（HrServeConfig——ServeConfig extends 之）、
 * 缺省值（HR_SERVE_DEFAULTS）、daemon.yaml 键胁迫（coerceHrServeKey——serve.ts 大 switch
 * 的 hr* case 组委托此处）、跨键校验（validateHrServeCross）与两个装配小件
 * （collectHrSecrets / parseHrRooms）。运行时装配体在 ./assemble.ts。
 */

/** daemon.yaml 胁迫小件（serve.ts 注入——单一源，不复制） */
export interface CoerceHelpers {
  str(v: unknown, key: string): string
  num(v: unknown, key: string): number
  bool(v: unknown, key: string): boolean
}

/** ServeConfig 的 hr* 字段子面（DEV-48，docs/52-§九；ServeConfig extends 本面） */
export interface HrServeConfig {
  /**
   * 人事同步器总开关（DEV-48，docs/52-§九；缺省关）：true 时——启动期 syncCompany
   * 台账镜像接线（people/departments 落库——store v2 面此前从未接，本单收口）+
   * resetStaleHrSyncApplying 断电复位；L1 热重载 apply 段 diffPeople 入队（哨兵票
   * @hr:<batchId>，零平台 IO）；引擎相位 7 尾消化 hr_sync_log（hrMaxPerTick 条/拍）。
   * Taiga 面在 platform: taiga 时自动装配（hrTaigaInviteLog 必配——令牌只落日志）；
   * Matrix 面另需 hrMatrix: true + buildServeRuntime opts.hrMatrixFace 注入。
   */
  hrSync: boolean
  /** 每拍消化任务上限（docs/52-§9.2 maxHrSyncPerTick；缺省 2） */
  hrMaxPerTick: number
  /** 任务重试上限（§9.2：达限 failed 终态+ESCALATE 不自动开单；缺省 3——17-§6 形状借用） */
  hrRetryLimit: number
  /** applying 断电复位窗毫秒（§9.2；缺省 0=10×tickMs 推导） */
  hrApplyingTimeoutMs: number
  /**
   * Matrix 执行面开关（docs/52-§七；缺省关）：true 需注入工厂（opts.hrMatrixFace——
   * 装配单元拼 createMatrixHrFace 产物；daemon 不强依赖 @studio-next/matrix，同
   * matrixSource 纪律）+ hrMatrixRooms 必配。开而未注入=CONFIG_INVALID 拒启动。
   */
  hrMatrix: boolean
  /**
   * Matrix 房间别名表（hrMatrix: true 时必配）：`company=#co:srv;研发部=#rd:srv` 形
   * （分号隔项；company 键=公司房——别名须全限定 #name:server）。部门键=公司目录
   * departments[].path 原文比对（「调」部门房重挂面）。
   */
  hrMatrixRooms?: string
  /** Taiga 邀请令牌日志文件（hrSync+platform: taiga 时必配；docs/52-§6.1 tokenSource——docker logs/邮件日志落盘文件） */
  hrTaigaInviteLog?: string
  /** 令牌日志轮询次数（缺省 10）/间隔毫秒（缺省 500）——窗口内抓不到=任务回队重试 */
  hrTaigaInvitePolls: number
  hrTaigaInvitePollMs: number
}

/** hr* 配置缺省（docs/52-§九 缺省关——既有部署字节不变；DEFAULT_SERVE_CONFIG 展开本件） */
export const HR_SERVE_DEFAULTS: HrServeConfig = {
  // hrApplyingTimeoutMs=0 → 装配期按 10×tickMs 推导
  hrSync: false,
  hrMaxPerTick: 2,
  hrRetryLimit: 3,
  hrApplyingTimeoutMs: 0,
  hrMatrix: false,
  hrTaigaInvitePolls: 10,
  hrTaigaInvitePollMs: 500,
}

/** hr* 键全集（coerceServeConfig 大 switch 的 case 组=本表键集——测试面同引单一源） */
export const HR_SERVE_KEYS = [
  'hrSync',
  'hrMaxPerTick',
  'hrRetryLimit',
  'hrApplyingTimeoutMs',
  'hrMatrix',
  'hrMatrixRooms',
  'hrTaigaInviteLog',
  'hrTaigaInvitePolls',
  'hrTaigaInvitePollMs',
] as const

/**
 * hr* 键胁迫（serve.ts coerceServeConfig 的 hr* case 组委托处）：
 * 键不属本面=不消费返回 false；属=胁迫写 cfg 返回 true（非法值照抛——与大 switch 同风格）。
 */
export function coerceHrServeKey(
  cfg: HrServeConfig,
  key: string,
  value: string | number | boolean,
  h: CoerceHelpers,
): boolean {
  switch (key) {
    case 'hrSync':
      cfg.hrSync = h.bool(value, key)
      return true
    case 'hrMaxPerTick': {
      const v = h.num(value, key)
      if (!Number.isInteger(v) || v < 1) throw new Error(`daemon.yaml：hrMaxPerTick 须为正整数（实得 ${String(v)}——每拍消化上限，52-§9.2）`)
      cfg.hrMaxPerTick = v
      return true
    }
    case 'hrRetryLimit': {
      const v = h.num(value, key)
      if (!Number.isInteger(v) || v < 1) throw new Error(`daemon.yaml：hrRetryLimit 须为正整数（实得 ${String(v)}——达限 failed 终态，52-§9.2）`)
      cfg.hrRetryLimit = v
      return true
    }
    case 'hrApplyingTimeoutMs': {
      const v = h.num(value, key)
      if (!Number.isInteger(v) || v < 0) throw new Error(`daemon.yaml：hrApplyingTimeoutMs 须为非负整数（实得 ${String(v)}；0=按 10×tickMs 推导）`)
      cfg.hrApplyingTimeoutMs = v
      return true
    }
    case 'hrMatrix':
      cfg.hrMatrix = h.bool(value, key)
      return true
    case 'hrMatrixRooms':
      cfg.hrMatrixRooms = h.str(value, key)
      return true
    case 'hrTaigaInviteLog':
      cfg.hrTaigaInviteLog = h.str(value, key)
      return true
    case 'hrTaigaInvitePolls': {
      const v = h.num(value, key)
      if (!Number.isInteger(v) || v < 1) throw new Error(`daemon.yaml：hrTaigaInvitePolls 须为正整数（实得 ${String(v)}）`)
      cfg.hrTaigaInvitePolls = v
      return true
    }
    case 'hrTaigaInvitePollMs': {
      const v = h.num(value, key)
      if (!Number.isInteger(v) || v < 1) throw new Error(`daemon.yaml：hrTaigaInvitePollMs 须为正整数（实得 ${String(v)}）`)
      cfg.hrTaigaInvitePollMs = v
      return true
    }
    default:
      return false
  }
}

/** 跨键校验（docs/52-§6.1/§7.2 必配面；非法=CONFIG_INVALID 拒启动——不静默降级） */
export function validateHrServeCross(cfg: {
  hrSync: boolean
  platform: string
  hrTaigaInviteLog?: string
  hrMatrix: boolean
  hrMatrixRooms?: string
}): void {
  if (cfg.hrSync) {
    if (cfg.platform === 'taiga' && (cfg.hrTaigaInviteLog === undefined || cfg.hrTaigaInviteLog === '')) {
      throw new Error('daemon.yaml：hrSync: true + platform: taiga 需配 hrTaigaInviteLog（邀请令牌只落 console/邮件日志——docs/52-§6.1 tokenSource；未配则 Taiga 建号链无法闭环）')
    }
    if (cfg.hrMatrix) {
      if (cfg.hrMatrixRooms === undefined || !cfg.hrMatrixRooms.includes('company=')) {
        throw new Error('daemon.yaml：hrMatrix: true 需配 hrMatrixRooms 且含 company= 项（`company=#co:srv;研发部=#rd:srv` 形——docs/52-§7.2 房间面）')
      }
    }
  }
}

/**
 * hr-sync 出站脱敏秘密面（DEV-48，docs/52-§十二；AGENTS 纪律 6「出站内容过密钥扫描」）：
 * env 自采（taiga 凭据——resolveTaigaAuth 同源键）+ 装配单元补充（matrix shared_secret
 * 等 daemon 不经手者经 opts.hrKnownSecrets 递入）。空串/过短值滤除（redactOutbound
 * MIN_KNOWN_LENGTH 同口径——无效秘密进名单是噪音）。
 */
export function collectHrSecrets(env: NodeJS.ProcessEnv, extra?: readonly string[]): string[] {
  const keys = ['TAIGA_PASSWORD', 'TAIGA_TOKEN', 'TAIGA_REFRESH', 'MATRIX_SHARED_SECRET', 'MATRIX_HR_SHARED_SECRET']
  const out: string[] = []
  for (const k of keys) {
    const v = env[k]
    if (v !== undefined && v.length >= 6) out.push(v)
  }
  for (const v of extra ?? []) {
    if (v.length >= 6) out.push(v)
  }
  return out
}

/**
 * hrMatrixRooms 解析（`company=#co:srv;研发部=#rd:srv` 形——分号隔项，键=别名）：
 * company 项缺 → CONFIG_INVALID（parse 面已挡，此处兜底直接构造 ServeConfig 的测试面）。
 */
export function parseHrRooms(spec: string): { company: string; byDept: Record<string, string>; aliasForDept(dept: string): string | undefined } {
  const byDept: Record<string, string> = {}
  let company = ''
  for (const part of spec.split(';').map((s) => s.trim()).filter((s) => s !== '')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const key = part.slice(0, eq).trim()
    const alias = part.slice(eq + 1).trim()
    if (key === 'company') company = alias
    else byDept[key] = alias
  }
  if (company === '') {
    throw new Error(`CONFIG_INVALID：hrMatrixRooms 缺 company= 项（\`company=#co:srv;部门=#alias:srv\` 形——docs/52-§7.2；实得 ${spec}）`)
  }
  return { company, byDept, aliasForDept: (dept: string): string | undefined => byDept[dept] }
}
