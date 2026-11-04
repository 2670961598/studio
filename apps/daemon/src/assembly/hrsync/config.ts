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
  /** Taiga 邀请令牌日志文件（兜底源；docs/52-§6.1 tokenSource——docker logs/邮件日志落盘文件） */
  hrTaigaInviteLog?: string
  /**
   * 邀请令牌 docker logs 源容器名（793；与 hrTaigaInviteLog 至少配一个）：Taiga console email backend
   * 把邀请邮件打到容器 stdout——daemon 用 `docker logs --since <窗口> <container>` 抓 /invitation/<token>。
   * 非法容器名=CONFIG_INVALID；两者都配=优先 docker，失败降级文件并记录（docs/52-§6.1）。
   */
  hrTaigaInviteLogDocker?: string
  /**
   * 邀请邮箱域（793 A 自动建号；缺省 `studio.local`）：Taiga 对"未知用户"只接受**合法邮箱形 username**
   * 发邀请；自动流程用 `<login>@<domain>` 作邀请锚（console 后端不真发信）。必须小写域名形。
   */
  hrTaigaEmailDomain: string
  /**
   * 预建账号池（793 B；缺省空映射）：`{"REL-1":"rel-1@studio.local"}` JSON（或 `login=value;...` 紧凑形）。
   * 命中=用池内 Taiga email/username 直接绑 membership（不建号）；值可为 email（推荐）或已存在 username。
   */
  hrTaigaAccountPool?: string
  /**
   * 公司角色/职级 → Taiga 项目角色 slug 映射（docs/52-§6.2；必配面可选）：
   * `role:<岗位名>=<slug>;level:<n>=<slug>`（分号隔项；slug 形如 stakeholder/back/product-owner）。
   * **role: 条目优先于 level:**；未命中走 hrTaigaRoleFallback。空/非法条目=CONFIG_INVALID 拒启动。
   */
  hrTaigaRoleMap?: string
  /**
   * 映射未命中时的 Taiga 项目角色 slug（docs/52-§6.2；缺省 `stakeholder`）。
   * 依据：项目模板必含 Stakeholder（权限最小、只读）；旧缺省 `member` 不是 Taiga 项目角色，
   * 会把 hr-sync 打成 unknown-role/CONFIG_INVALID（784 事故）。
   */
  hrTaigaRoleFallback: string
  /** 令牌日志轮询次数（缺省 10）/间隔毫秒（缺省 500）——窗口内抓不到=任务回队重试 */
  hrTaigaInvitePolls: number
  hrTaigaInvitePollMs: number
  /**
   * people-change 唤起源开关（129-§6.1①/§6.3 P0-A，studio-dev-178 单C；缺省关）：
   * true 时挂 hr-sync 分类器出口双写 data-change 意图（零重复分类——diff 变更清单
   * 经 enqueueHrBatch 产物回传，源本体 engine/hrsync/people-change-source.ts）。
   * **前置 hrSync: true**（分类器在 hr-sync apply 段内——无 hrSync 即无 diff 出口，
   * cross 校验 CONFIG_INVALID）；路由表=org-config hooks.data_change.routes（规范位）。
   */
  hrPeopleWatch: boolean
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
  hrTaigaEmailDomain: 'studio.local',
  hrTaigaRoleFallback: 'stakeholder',
  hrPeopleWatch: false,
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
  'hrTaigaInviteLogDocker',
  'hrTaigaEmailDomain',
  'hrTaigaAccountPool',
  'hrTaigaInvitePolls',
  'hrTaigaInvitePollMs',
  'hrTaigaRoleMap',
  'hrTaigaRoleFallback',
  'hrPeopleWatch',
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
    case 'hrTaigaInviteLogDocker': {
      const v = h.str(value, key)
      cfg.hrTaigaInviteLogDocker = assertDockerContainerName(v, 'daemon.yaml hrTaigaInviteLogDocker')
      return true
    }
    case 'hrTaigaEmailDomain': {
      const v = h.str(value, key)
      cfg.hrTaigaEmailDomain = assertTaigaEmailDomain(v, 'daemon.yaml hrTaigaEmailDomain')
      return true
    }
    case 'hrTaigaAccountPool': {
      const v = h.str(value, key)
      parseHrTaigaAccountPool(v)
      cfg.hrTaigaAccountPool = v
      return true
    }
    case 'hrTaigaRoleMap': {
      const v = h.str(value, key)
      parseHrTaigaRoleMap(v) // 解析即验（非法条目/未知前缀/重复键 → CONFIG_INVALID 拒启动）
      cfg.hrTaigaRoleMap = v
      return true
    }
    case 'hrTaigaRoleFallback': {
      const v = h.str(value, key)
      cfg.hrTaigaRoleFallback = assertTaigaProjectRole(v, 'daemon.yaml hrTaigaRoleFallback') // F1：allowlist 同源校验
      return true
    }
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
    case 'hrPeopleWatch':
      cfg.hrPeopleWatch = h.bool(value, key)
      return true
    default:
      return false
  }
}

/** 跨键校验（docs/52-§6.1/§7.2 必配面；非法=CONFIG_INVALID 拒启动——不静默降级） */
export function validateHrServeCross(cfg: {
  hrSync: boolean
  platform: string
  hrTaigaInviteLog?: string
  hrTaigaInviteLogDocker?: string
  hrTaigaEmailDomain?: string
  hrTaigaAccountPool?: string
  hrTaigaRoleMap?: string
  hrTaigaRoleFallback?: string
  hrMatrix: boolean
  hrMatrixRooms?: string
  hrPeopleWatch: boolean
}): void {
  if (cfg.hrSync) {
    if (
      cfg.platform === 'taiga' &&
      (cfg.hrTaigaInviteLog === undefined || cfg.hrTaigaInviteLog === '') &&
      (cfg.hrTaigaInviteLogDocker === undefined || cfg.hrTaigaInviteLogDocker === '')
    ) {
      throw new Error('daemon.yaml：hrSync: true + platform: taiga 需配 hrTaigaInviteLog（文件兜底）或 hrTaigaInviteLogDocker（793 docker logs 源；至少一个）——否则邀请令牌无法闭环（docs/52-§6.1）')
    }
    if (cfg.platform === 'taiga') {
      assertTaigaEmailDomain(cfg.hrTaigaEmailDomain ?? 'studio.local', 'daemon.yaml hrTaigaEmailDomain')
      parseHrTaigaAccountPool(cfg.hrTaigaAccountPool)
      if (cfg.hrTaigaInviteLogDocker !== undefined) assertDockerContainerName(cfg.hrTaigaInviteLogDocker, 'daemon.yaml hrTaigaInviteLogDocker')
    }
    // 784：Taiga 角色映射面解析即验（fallback 缺省 stakeholder；map 可空=全部 fallback）
    if (cfg.platform === 'taiga') {
      assertTaigaProjectRole(cfg.hrTaigaRoleFallback ?? '', 'daemon.yaml hrTaigaRoleFallback')
      parseHrTaigaRoleMap(cfg.hrTaigaRoleMap)
    }
    if (cfg.hrMatrix) {
      if (cfg.hrMatrixRooms === undefined || !cfg.hrMatrixRooms.includes('company=')) {
        throw new Error('daemon.yaml：hrMatrix: true 需配 hrMatrixRooms 且含 company= 项（`company=#co:srv;研发部=#rd:srv` 形——docs/52-§7.2 房间面）')
      }
    }
  }
  // people-change 源前置（129-C，studio-dev-178）：源挂 hr-sync 分类器出口——
  // hrSync 关即无 diff 出口，开 watch 是结构性空转，CONFIG_INVALID 明报不静默
  if (cfg.hrPeopleWatch && !cfg.hrSync) {
    throw new Error('daemon.yaml：hrPeopleWatch: true 需 hrSync: true（people-change 源挂 hr-sync peopleDiff 分类器出口双写——无 hrSync 即无 diff 出口；129-§6.1① 注册模式）')
  }
}

/** Taiga 角色 slug 形状（小写字母/数字/连字符） */
const TAIGA_ROLE_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

/**
 * Taiga 项目角色 allowlist（docs/52-§6.2.1；2026-11-05 真机实测项目 3 角色集）。
 * 配置目标（map 值/fallback）**必须是** allowlist 内角色；`member` 及未知角色=CONFIG_INVALID。
 * 扩展点：项目新增自定义角色时，先扩展本常量+docs/52-§6.2.1（走补丁/提案），再允许配置引用——
 * 不在运行期按远端 roles 动态放行（fail-closed；防止配置指向不存在的角色再次 ESCALATE）。
 */
export const TAIGA_PROJECT_ROLE_SLUGS = ['ux', 'design', 'front', 'back', 'product-owner', 'stakeholder'] as const
const TAIGA_PROJECT_ROLE_SET: ReadonlySet<string> = new Set(TAIGA_PROJECT_ROLE_SLUGS)

/**
 * 目标角色合法性统一校验（map 目标与 fallback 同源；大小写/首尾空白归一后再判）。
 * @throws CONFIG_INVALID（形状非法/不在 allowlist）
 */
export function assertTaigaProjectRole(raw: string, context: string): string {
  const slug = String(raw).trim().toLowerCase()
  if (!TAIGA_ROLE_SLUG_RE.test(slug)) {
    throw new Error(`CONFIG_INVALID：${context} 目标角色 slug 非法（${JSON.stringify(raw)}；小写字母/数字/连字符——docs/52-§6.2.1）`)
  }
  if (!TAIGA_PROJECT_ROLE_SET.has(slug)) {
    throw new Error(
      `CONFIG_INVALID：${context} 目标角色「${slug}」不在 Taiga 项目角色 allowlist（${TAIGA_PROJECT_ROLE_SLUGS.join('/')}）——docs/52-§6.2.1；` +
        `如项目新增角色，先扩展 allowlist（代码常量+文档），不得运行时猜角色`,
    )
  }
  return slug
}

/** 邀请邮箱域校验/归一（793；小写域名形，允许子域；归一=trim+lower） */
export function assertTaigaEmailDomain(raw: string, context: string): string {
  const domain = String(raw).trim().toLowerCase()
  const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
  if (!DOMAIN_RE.test(domain)) {
    throw new Error(`CONFIG_INVALID：${context} 须为小写域名形（如 studio.local；无空格/协议/斜杠；实得 ${JSON.stringify(raw)}——docs/52-§6.1.1）`)
  }
  return domain
}

/** docker 容器名校验（793 docker logs 源；仅 [A-Za-z0-9_.-]，防命令注入） */
export function assertDockerContainerName(raw: string, context: string): string {
  const name = String(raw).trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)) {
    throw new Error(`CONFIG_INVALID：${context} 容器名非法（仅 [A-Za-z0-9_.-]，1-128 字符；实得 ${JSON.stringify(raw)}）`)
  }
  return name
}

/**
 * 预建账号池解析（793 B）：JSON 对象 `{"REL-1":"rel-1@studio.local"}` 或紧凑 `REL-1=rel-1@studio.local;ENG-1=eng-1`。
 * - login 键=工号（非空、不含空格/分号/=/"）；
 * - 值=已存在 Taiga user 的 email（含 @，推荐——直接绑 membership 不过 contact 校验）或 username（不含 @）；
 * - 重复键/空值/非法字符=CONFIG_INVALID（解析即验，不静默忽略）。
 */
export function parseHrTaigaAccountPool(spec?: string): Record<string, string> {
  if (spec === undefined || spec.trim() === '') return {}
  const out: Record<string, string> = {}
  const text = spec.trim()
  let entries: [string, string][]
  if (text.startsWith('{')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      throw new Error(`CONFIG_INVALID：hrTaigaAccountPool JSON 解析失败（${err instanceof Error ? err.message : String(err)}）`)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('CONFIG_INVALID：hrTaigaAccountPool 须为 JSON 对象（login→email/username）')
    }
    entries = Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)] as [string, string])
  } else {
    entries = text.split(';').filter((p) => p.trim() !== '').map((part) => {
      const eq = part.indexOf('=')
      if (eq <= 0) throw new Error(`CONFIG_INVALID：hrTaigaAccountPool 条目须 login=email/username（实得 ${JSON.stringify(part)}）`)
      return [part.slice(0, eq).trim(), part.slice(eq + 1).trim()] as [string, string]
    })
  }
  for (const [login, value] of entries) {
    if (login === '' || /[\s;=,{}"]/.test(login)) throw new Error(`CONFIG_INVALID：hrTaigaAccountPool login 非法（${JSON.stringify(login)}）`)
    if (out[login] !== undefined) throw new Error(`CONFIG_INVALID：hrTaigaAccountPool login 重复（${login}）`)
    const v = value.trim()
    if (v === '') throw new Error(`CONFIG_INVALID：hrTaigaAccountPool 值不能为空（${login}）`)
    if (v.includes('@')) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error(`CONFIG_INVALID：hrTaigaAccountPool 邮箱值非法（${login}→${JSON.stringify(v)}）`)
    } else if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(v)) {
      throw new Error(`CONFIG_INVALID：hrTaigaAccountPool username 值非法（${login}→${JSON.stringify(v)}）`)
    }
    out[login] = v
  }
  return out
}

/** 公司角色/职级 → Taiga 项目角色映射（docs/52-§6.2；分号隔项，role: 优先于 level:） */
export interface HrTaigaRoleMap {
  byRole: ReadonlyMap<string, string>
  byLevel: ReadonlyMap<number, string>
}

/**
 * 解析 hrTaigaRoleMap（fail-closed，docs/52-§6.2）：
 *   `role:<岗位名>=<slug>;level:<n>=<slug>`（分号隔项，空项忽略；未知前缀/坏 slug/重复键=抛 CONFIG_INVALID）。
 * 空串/undefined → 空映射（全部走 fallback）——不视为错误（首启/小团队可先只配 fallback）。
 */
export function parseHrTaigaRoleMap(spec?: string): HrTaigaRoleMap {
  const byRole = new Map<string, string>()
  const byLevel = new Map<number, string>()
  const raw = (spec ?? '').trim()
  if (raw === '') return { byRole, byLevel }
  for (const part of raw.split(';').map((item) => item.trim()).filter((item) => item !== '')) {
    const eq = part.indexOf('=')
    if (eq <= 0) throw new Error(`CONFIG_INVALID：hrTaigaRoleMap 条目缺 \`<key>=<slug>\`（实得 ${JSON.stringify(part)}——docs/52-§6.2）`)
    const key = part.slice(0, eq).trim()
    const rawSlug = part.slice(eq + 1).trim()
    const slug = assertTaigaProjectRole(rawSlug, 'hrTaigaRoleMap') // 形状+allowlist 同源校验（normalize）
    if (key.startsWith('role:')) {
      const role = key.slice('role:'.length).trim()
      if (role === '') throw new Error('CONFIG_INVALID：hrTaigaRoleMap 的 role: 键缺岗位名（docs/52-§6.2）')
      if (byRole.has(role)) throw new Error(`CONFIG_INVALID：hrTaigaRoleMap 重复 role:${role}（docs/52-§6.2）`)
      byRole.set(role, slug)
    } else if (key.startsWith('level:')) {
      const levelText = key.slice('level:'.length).trim()
      const level = Number(levelText)
      if (!Number.isInteger(level) || level < 1 || level > 9) throw new Error(`CONFIG_INVALID：hrTaigaRoleMap 的 level: 键须为 1-9 整数（实得 ${JSON.stringify(key)}——docs/52-§6.2）`)
      if (byLevel.has(level)) throw new Error(`CONFIG_INVALID：hrTaigaRoleMap 重复 level:${String(level)}（docs/52-§6.2）`)
      byLevel.set(level, slug)
    } else {
      throw new Error(`CONFIG_INVALID：hrTaigaRoleMap 键须以 role: 或 level: 开头（实得 ${JSON.stringify(key)}——docs/52-§6.2）`)
    }
  }
  return { byRole, byLevel }
}

/**
 * 解析目标角色 slug（纯函数，docs/52-§6.2 优先级）：
 *   ① role:<岗位> 命中 → ② level:<n> 命中 → ③ fallback（缺省 stakeholder）。
 * fallback 必须为项目真实角色 slug（daemon 启动期只做形状校验；真值由 Taiga /roles 运行时解析）。
 */
export function resolveHrTaigaRole(
  map: HrTaigaRoleMap,
  fallback: string,
  level: number | undefined,
  roleName?: string,
): string {
  if (roleName !== undefined && roleName !== '') {
    const hit = map.byRole.get(roleName)
    if (hit !== undefined) return hit
  }
  if (level !== undefined) {
    const hit = map.byLevel.get(level)
    if (hit !== undefined) return hit
  }
  return fallback
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
