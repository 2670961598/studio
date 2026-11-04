/**
 * serve/config —— serve 配置面（ServeConfig 形状／缺省／扁平 YAML 解析／交叉校验）
 *
 * 依据（实现单引用）：
 *   - docs/plan/05 IMPL-06-05「serve 拆分·config/runtime/run」（LANE-E）；
 *   - docs/v2/16 §三 daemon 行（DISP-02：serve 拆 config/runtime/run，薄壳只留转发）；
 *   - docs/20-§十五.三（文件 600 行阈）／§十五.四（域平面不新增散件——拆件归本子域）。
 *
 * 内容＝原 assembly/serve.ts 配置段迁移（行为/错误码零漂移）＋MIG-07 安全面收口：
 *   - ServeConfig 类型＋DEFAULT_SERVE_CONFIG（**网关开关/开发密钥二键已删除**——SEC-FC-01/02）；
 *   - 零依赖扁平 YAML 子集解析 parseDaemonConfig（未知键/嵌套/空值 fail-closed；`gateway`/
 *     `gatewaySecret` 二键命中即 `CONFIG_INVALID/gateway-key-removed` 明报——不是「未知键」的
 *     泛化，而是「该键已被规范删除」的显式拒绝）；
 *   - 平台/人事/matrix/频道交叉校验（CONFIG_INVALID 明报，校验顺序不变）；
 *   - 由配置派生的启动身份 daemonIdentity（**签根只从秘密源注入** → 署名上下文/工号）；
 *   - SEC-WD-02 绑定一致性：org-config `company.platform` 与 daemon.yaml `platform` 不一致＝拒启；
 *   - seatbelt 配置通道（IMPL-07-09 随动）：三键 → `ServeConfig.seatbelt`（缺省不写＝read-only；
 *     workspace-write 须显式 tier＋绝对路径 roots＋authorization，fail-closed 不静默放宽）。
 *
 * 签根供给（plan/05 IMPL-07-06；v2/15 SEC-FC-02）：
 *   - daemon.yaml **不再承载任何网关密钥值**（键删除，出现即拒）；值只从部署秘密源注入——
 *     v0 env-ref 名 `STUDIO_GATEWAY_SECRET`（对应 `SEC-GW-SIGNING`，v2/16/catalog 落地前的
 *     env 通道，IMPL-07-12 换 SecretProvider 时保持同一逻辑引用）。
 *   - 仅「无公司目录 demo 装配」（`companyDir` 未给且 `platform: fake`）允许进程内临时随机签根，
 *     并**显式打降级标记**（wireGatedPlatform 日志 + DaemonIdentity.secretSource）；其余形态缺值
 *     ＝ `CONFIG_INVALID/gw-secret-missing` 拒启（不回落仓内常量——SEC-FC-02）。
 *
 * 边界：本文件零业务 IO；唯一进程面＝env 秘密读取（键名可枚举、值不落日志/台账/错误消息）与
 * demo 随机源（可注入）。只收配置校验件（serveconfig/coerce、hrsync/config、channels/channels）
 * 与引擎缺省常量。runtime.ts / run.ts / executor-face.ts 从这里取同一份配置契约。
 */
import path from 'node:path'
import { parseWhitelistSpec } from '../../engine/directive/index.ts'
import { parseJudgeSites } from '../../engine/judge/sites129.ts'
import { parseModelTierTickets } from '../../engine/tier/model-tier.ts'
import { parsePersonInflightOverrides } from '../../engine/todoqueue/queue.ts'
import { parseStallAfterMsByExecutor } from './watchdog-config.ts'
import { bool, coerceDispatchSelectionChain, coerceSeatbeltGrant, num, rejectRemovedGatewayKey, str, type SeatbeltConfigRaw } from '../serveconfig/coerce.ts'
import { coerceHrServeKey, validateHrServeCross } from '../hrsync/config.ts'
import { crossValidateMatrixChannels } from '../channels/channels.ts'
import { coerceRestartServeKey, isRestartKey, validateRestartCross } from '../serveconfig/restart.ts'
import { coerceAnchorAbsenceDeclaration, type AnchorAbsenceRaw } from './anchor-absence.ts'
import { coerceRootGrantAbsenceDeclaration, type RootGrantAbsenceRaw } from './root-grant-absence.ts'
import { coerceSignatureServeKey } from '../serveconfig/signature.ts'
import { coerceAuthorityServeKey } from '../serveconfig/authority.ts'
import { DEFAULT_SERVE_CONFIG, type ServeConfig } from './config-types.ts'

// 配置形状/缺省面拆至 config-types.ts（docs/20-§十五.三 600 行阈；拆后原文件余量 ≥50）；
// 此处再出口保持既有导入面零改行（runtime.ts / run.ts / executor-face.ts 仍从 ./config.ts 取契约）。
export { DEFAULT_SERVE_CONFIG, type ServeConfig } from './config-types.ts'

/** DM 房白名单（docs/21-§七.6）：分号分隔 room_id；空/非 `!` 开头=CONFIG_INVALID 拒启 */
function parseConversationRooms(raw: string): string[] {
  const rooms = raw.split(';').map((v) => v.trim()).filter((v) => v !== '')
  if (rooms.length === 0) throw new Error('daemon.yaml：conversationRooms 为空（至少一个 DM 房 room_id）')
  for (const room of rooms) {
    if (!room.startsWith('!')) throw new Error(`daemon.yaml：conversationRooms 条目须为 room_id（!xxx:server；实得 ${room}）`)
  }
  return rooms
}

/** 会话正整数闸（窗口/字数面）：非整数或越界＝明报不猜 */
function conversationPositiveInt(value: string | number | boolean, key: string, min: number, max: number): number {
  const v = num(value, key)
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new Error(`daemon.yaml：${key} 须为 ${min}..${max} 的整数（实得 ${v}；docs/21-§七.3）`)
  }
  return v
}

function parseScalar(raw: string): string | number | boolean {
  const v = raw.trim()
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10)
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) return v.slice(1, -1)
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1)
  return v
}

/**
 * 零依赖扁平 YAML 子集解析（v0 占位——真 YAML 装载归依赖登记后）：
 * 只认 `key: value` 行与 # 注释；嵌套/列表/多行标量不收（CONFIG_INVALID 明报不猜）。
 */
/** 分号/逗号清单解析（775/C2/C3 派工排除与监控配置；空项剔除，全空=非法） */
function parseTextList(value: unknown, key: string): readonly string[] {
  const raw = str(value, key)
  const items = raw
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
  if (items.length === 0) throw new Error(`daemon.yaml：${key} 不能为空清单`)
  return [...new Set(items)]
}

export function parseDaemonConfig(text: string): ServeConfig {
  const out: Record<string, string | number | boolean> = {}
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim()
    if (line === '' || line.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx <= 0) {
      throw new Error(`daemon.yaml 第 ${i + 1} 行不是扁平 key: value（v0 只收扁平子集）：${line}`)
    }
    const key = line.slice(0, idx).trim()
    const valueRaw = line.slice(idx + 1).trim()
    if (valueRaw === '' || valueRaw.startsWith('#')) {
      throw new Error(`daemon.yaml 第 ${i + 1} 行 value 为空（v0 不收嵌套/空值）：${line}`)
    }
    if (/^[\[{]|^\s*-/.test(valueRaw)) {
      if (key === 'seatbeltWriteRoots') {
        throw new Error(
          `daemon.yaml 第 ${i + 1} 行 seatbeltWriteRoots 须为引号包裹的 JSON 数组字符串（如 '["/abs/root"]'）——` +
            `扁平 YAML 不收裸列表：${line}`,
        )
      }
      throw new Error(`daemon.yaml 第 ${i + 1} 行是嵌套/列表值（v0 只收扁平标量）：${line}`)
    }
    out[key] = parseScalar(valueRaw.split(' #')[0] ?? valueRaw)
  }
  return coerceServeConfig(out)
}

function coerceServeConfig(raw: Record<string, string | number | boolean>): ServeConfig {
  const cfg: ServeConfig = { ...DEFAULT_SERVE_CONFIG }
  // seatbelt 三键原文（键间交叉校验在循环后一次性收口——read-only 给 roots/auth 即拒）
  const seatbeltRaw: SeatbeltConfigRaw = {}
  // 无锚声明两键原文（同上：成对/消费面校验在循环后一次收口——SEC-FC-03）
  const anchorAbsenceRaw: AnchorAbsenceRaw = {}
  // 根授予无锚三键原文（studio-dev-707；成对/日期/消费面校验在循环后一次收口）
  const rootGrantAbsenceRaw: RootGrantAbsenceRaw = {}
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case 'db': cfg.db = str(value, key); break
      case 'platform': {
        // 平台值收紧为显式枚举（CONFIG_INVALID 明报不猜）：原「未知值静默降 fake」会把
        // platform: taiga 误配跑成 demo 假平台（写面黑洞）——taiga 接线后该静默面必须堵死。
        const v = str(value, key)
        if (v !== 'localfile' && v !== 'taiga' && v !== 'fake') {
          throw new Error(`daemon.yaml：platform 须为 localfile|taiga|fake（实得 ${v}）`)
        }
        cfg.platform = v
        break
      }
      case 'company': cfg.company = str(value, key); break
      case 'rootDir': cfg.rootDir = str(value, key); break
      case 'apiPort': {
        // 对外 API 端口（MIG-06）：0=ephemeral；1..65535=显式端口——非整数/越界明报不猜
        const v = num(value, key)
        if (!Number.isInteger(v) || v > 65_535) {
          throw new Error(`daemon.yaml：apiPort 须为 0..65535 的整数（0=ephemeral；实得 ${v}）`)
        }
        cfg.apiPort = v
        break
      }
      case 'aiwsRoot': cfg.aiwsRoot = str(value, key); break
      case 'companyDir': cfg.companyDir = str(value, key); break
      case 'models': cfg.models = str(value, key); break
      case 'budgetTicketCapUsd': cfg.budgetTicketCapUsd = num(value, key); break
      case 'budgetPersonCapUsd': cfg.budgetPersonCapUsd = num(value, key); break
      case 'maxInflightPerPerson': {
        // 人闸缺省帽（129-§6.2-R3）：正整数——0/负数在闸内 Math.max(1,·) 兜底，但配置
        // 面就明报（fail-closed 纪律：坏配置不猜意图）
        const v = num(value, key)
        if (!Number.isInteger(v) || v < 1) throw new Error(`daemon.yaml：maxInflightPerPerson 须为正整数（实得 ${v}）`)
        cfg.maxInflightPerPerson = v
        break
      }
      case 'queueAgeStepMs': {
        // ageBoost 步长（129-§6.2-R4）：正毫秒——core ageBoostTier 对 ≤0 fail-closed 归 0 档，
        // 配置面同样明报（步长 0=加龄永不升档，几乎必是配置错）
        const v = num(value, key)
        if (!Number.isInteger(v) || v < 1) throw new Error(`daemon.yaml：queueAgeStepMs 须为正整数毫秒（实得 ${v}）`)
        cfg.queueAgeStepMs = v
        break
      }
      case 'personInflightOverrides': {
        // 覆盖表（129-§6.2-R3）：解析即验（坏段启动拒——不静默忽略）；空值=未配（面关）
        const v = str(value, key)
        parsePersonInflightOverrides(v)
        cfg.personInflightOverrides = v
        break
      }
      case 'pinnedTickets': cfg.pinnedTickets = str(value, key); break
      case 'judgeSites': // 址开关清单（160-B）：解析即验（未知址名启动拒——fail-closed）
        cfg.judgeSites = str(value, key)
        parseJudgeSites(cfg.judgeSites)
        break
      case 'modelTierTickets': // 档显式覆盖表（studio-dev-196）：解析即验（坏段/未知档启动拒——fail-closed）
        cfg.modelTierTickets = str(value, key)
        parseModelTierTickets(cfg.modelTierTickets)
        break
      case 'tickMs': cfg.tickMs = num(value, key); break
      case 'maxActionsPerTick': cfg.maxActionsPerTick = num(value, key); break
      case 'maxInflight': cfg.maxInflight = num(value, key); break
      case 'stallAfterMs': cfg.stallAfterMs = num(value, key); break
      case 'stallAfterMsByExecutor': // studio-dev-505：解析即验（坏段/坏值/重复键启动拒——fail-closed）
        cfg.stallAfterMsByExecutor = parseStallAfterMsByExecutor(str(value, key))
        break
      case 'stallKillAfterAlarms': {
        // DEV-44 咬合阈：非负整数（0=关）——非整数明报不静默取整
        const v = num(value, key)
        if (!Number.isInteger(v)) throw new Error(`daemon.yaml：stallKillAfterAlarms 须为非负整数（实得 ${v}）`)
        cfg.stallKillAfterAlarms = v
        break
      }
      case 'harvestSliceMs': cfg.harvestSliceMs = num(value, key); break
      case 'laneTtlMs': cfg.laneTtlMs = num(value, key); break
      case 'mergeLeaseTtlMs': cfg.mergeLeaseTtlMs = num(value, key); break
      case 'breakerThreshold': cfg.breakerThreshold = num(value, key); break
      case 'breakerCooldownMs': cfg.breakerCooldownMs = num(value, key); break
      case 'mirrorRescanEveryTicks': cfg.mirrorRescanEveryTicks = num(value, key); break
      case 'autoAssign': cfg.autoAssign = bool(value, key); break
      case 'autoAssignExcludePeople': cfg.autoAssignExcludePeople = parseTextList(value, key); break
      case 'autoAssignExcludeRoles': cfg.autoAssignExcludeRoles = parseTextList(value, key); break
      case 'executionGuardRoles': cfg.executionGuardRoles = parseTextList(value, key); break
      case 'executionGuardKeywords': cfg.executionGuardKeywords = parseTextList(value, key); break
      case 'autoApprove': cfg.autoApprove = bool(value, key); break
      case 'directiveProducer': cfg.directiveProducer = str(value, key); break
      case 'directiveWhitelist': {
        const v = str(value, key)
        if (parseWhitelistSpec(v) !== undefined) cfg.directiveWhitelist = v
        break
      }
      case 'jobs': cfg.jobs = bool(value, key); break
      case 'jobPollMs': cfg.jobPollMs = num(value, key); break
      case 'matrix': cfg.matrix = bool(value, key); break
      case 'matrixHomeserverUrl': cfg.matrixHomeserverUrl = str(value, key); break
      case 'matrixUserId': cfg.matrixUserId = str(value, key); break
      case 'matrixRooms': cfg.matrixRooms = str(value, key); break
      case 'matrixRoles': cfg.matrixRoles = str(value, key); break
      case 'dataChangeRoutes': cfg.dataChangeRoutes = str(value, key); break
      case 'costThresholdTarget': cfg.costThresholdTarget = str(value, key); break
      case 'costThresholdLane': cfg.costThresholdLane = str(value, key); break
      case 'matrixPollMs': cfg.matrixPollMs = num(value, key); break
      case 'matrixSyncTimeoutMs': cfg.matrixSyncTimeoutMs = num(value, key); break
      case 'matrixChannels': cfg.matrixChannels = bool(value, key); break
      case 'matrixDeptMap': cfg.matrixDeptMap = str(value, key); break
      case 'matrixProducerMxid': cfg.matrixProducerMxid = str(value, key); break
      // —— 制作人-岗位持久对话（docs/21-§七，studio-dev-646 Phase 1）：五键解析即验 ——
      case 'conversation': cfg.conversation = bool(value, key); break
      case 'conversationDir': cfg.conversationDir = str(value, key); break
      case 'conversationRooms': cfg.conversationRooms = parseConversationRooms(str(value, key)); break
      case 'conversationDefaultPerson': cfg.conversationDefaultPerson = str(value, key); break
      case 'conversationWindow': cfg.conversationWindow = conversationPositiveInt(value, key, 1, 200); break
      case 'conversationMaxChars': cfg.conversationMaxChars = conversationPositiveInt(value, key, 500, 100_000); break
      case 'conversationMaxMessageChars': cfg.conversationMaxMessageChars = conversationPositiveInt(value, key, 100, 100_000); break
      case 'conversationReplyMaxChars': cfg.conversationReplyMaxChars = conversationPositiveInt(value, key, 100, 200_000); break
      case 'fileWatch': cfg.fileWatch = bool(value, key); break
      case 'fileWatchPath': cfg.fileWatchPath = str(value, key); break
      case 'cadence': cfg.cadence = bool(value, key); break
      case 'sla': cfg.sla = bool(value, key); break
      case 'costGuard': cfg.costGuard = bool(value, key); break
      case 'freshness': cfg.freshness = bool(value, key); break
      // —— 接力/续命源开关（129-§6.1⑥/§6.5 单E，studio-dev-184）——
      case 'relay': cfg.relay = bool(value, key); break
      case 'resume': cfg.resume = bool(value, key); break
      // —— 人事同步器键组（DEV-48，docs/52-§九/§六.1/§七；hrPeopleWatch=129-C）——胁迫/校验收口 assembly/hrsync/config.ts（不属 hr 面回落本 switch）
      case 'hrSync':
      case 'hrMaxPerTick':
      case 'hrRetryLimit':
      case 'hrApplyingTimeoutMs':
      case 'hrMatrix':
      case 'hrMatrixRooms':
      case 'hrTaigaInviteLog':
      case 'hrTaigaInvitePolls':
      case 'hrTaigaInvitePollMs':
      case 'hrPeopleWatch':
        coerceHrServeKey(cfg, key, value, { str, num, bool })
        break
      case 'reloadWatch': cfg.reloadWatch = bool(value, key); break
      // —— 无锚显式声明（SEC-FC-03；docs/44-§2.3-4）：两键成对，循环后一次收口 ——
      case 'reloadAnchorAbsenceDeclaredBy': anchorAbsenceRaw.declaredBy = str(value, key); break
      case 'reloadAnchorAbsenceReason': anchorAbsenceRaw.reason = str(value, key); break
      // —— 根授予无锚显式声明（studio-dev-707；#648 方案 c）：三键成对，循环后一次收口 ——
      case 'recordRootGrantAbsenceDeclaredBy': rootGrantAbsenceRaw.declaredBy = str(value, key); break
      case 'recordRootGrantAbsenceReason': rootGrantAbsenceRaw.reason = str(value, key); break
      case 'recordRootGrantAbsenceUntil': rootGrantAbsenceRaw.until = str(value, key); break
      // —— seatbelt 配置通道（IMPL-07-09 随动；缺省不写=read-only；交叉校验在循环后）——
      case 'seatbeltTier': seatbeltRaw.tier = value; break
      case 'seatbeltWriteRoots': seatbeltRaw.writeRoots = value; break
      case 'seatbeltAuthorization': seatbeltRaw.authorization = value; break
      case 'seatbeltOutboundTcp': seatbeltRaw.outboundTcp = value; break
      case 'dispatchSelections': cfg.dispatchSelections = coerceDispatchSelectionChain(str(value, key)); break // studio-dev-620（缺省不写=空链）
      // —— SEC-FC-01/02（v2/15 §一）：网关开关键与密钥键**已从生产配置面删除** ——
      //    不是「未知键」的泛化拒绝：明报「该键已删除 + 替代供给面」，防旧配置静默漂移。
      case 'gateway':
      case 'gatewaySecret':
        rejectRemovedGatewayKey(key)
        break
      case 'platformDir': cfg.platformDir = str(value, key); break
      case 'taigaUrl': cfg.taigaUrl = str(value, key); break
      case 'taigaProject': cfg.taigaProject = str(value, key); break
      case 'taigaEntity': {
        const v = str(value, key)
        if (v !== 'userstory' && v !== 'issue' && v !== 'task') {
          throw new Error(`daemon.yaml：taigaEntity 须为 userstory|issue|task（实得 ${v}）`)
        }
        cfg.taigaEntity = v
        break
      }
      case 'taigaAuth': {
        const v = str(value, key)
        if (v !== 'password' && v !== 'token') {
          throw new Error(`daemon.yaml：taigaAuth 须为 password|token（实得 ${v}）——凭据值只经 env 供给，不入 daemon.yaml`)
        }
        cfg.taigaAuth = v
        break
      }
      case 'taigaFieldsFile': cfg.taigaFieldsFile = str(value, key); break
      case 'agentYaml': cfg.agentYaml = str(value, key); break
      case 'acceptance': cfg.acceptance = str(value, key); break
      default:
        // 受权重启键组（studio-dev-504 S4；值域/交叉校验在 serveconfig/restart.ts）
        if (isRestartKey(key)) {
          coerceRestartServeKey(cfg, key, value, { str, num, bool })
          break
        }
        if (coerceAuthorityServeKey(cfg, key, value)) break // 授权模式键（SEC-FC-08）：shadow/enforce 与期限
        if (!coerceSignatureServeKey(cfg, key, value)) throw new Error(`daemon.yaml：未知配置键 ${key}（v0 最小面，见 serve.ts 头注）`) // 署名决定人键（SEC-FC-06）：键面判定＋值域收窄归 serveconfig/signature.ts，未命中＝未知键
    }
  }
  // —— 无锚显式声明（SEC-FC-03；docs/44-§2.3-4）：两键成对收口——只给理由/无 companyDir
  //    ＝CONFIG_INVALID 拒启（不静默放行；缺省 undefined＝未声明，无锚仍拒）——
  const reloadAnchorAbsence = coerceAnchorAbsenceDeclaration(anchorAbsenceRaw, { companyDir: cfg.companyDir })
  if (reloadAnchorAbsence !== undefined) cfg.reloadAnchorAbsence = reloadAnchorAbsence
  // —— 根授予无锚显式声明（studio-dev-707）：三键成对＋真日历日/未过期/companyDir 消费面 ——
  const recordRootGrantAbsence = coerceRootGrantAbsenceDeclaration(rootGrantAbsenceRaw, { companyDir: cfg.companyDir })
  if (recordRootGrantAbsence !== undefined) cfg.recordRootGrantAbsence = recordRootGrantAbsence
  // —— seatbelt 三键交叉校验（IMPL-07-09）：缺省不写＝undefined（read-only 最严）；任何
  //    read-only 携带放宽键/workspace-write 缺键或根非法＝CONFIG_INVALID 拒启（不静默放宽）
  const seatbelt = coerceSeatbeltGrant(seatbeltRaw)
  if (seatbelt !== undefined) cfg.seatbelt = seatbelt
  // —— taiga 必配键交叉校验（fail-fast：parse 面一次收口；直接构造 ServeConfig 的测试面
  //    由 wirePlatform/createTaigaPlatform validateOptions 二道兜底）——
  if (cfg.platform === 'taiga') {
    const missing = [
      ...(cfg.taigaUrl === undefined ? ['taigaUrl'] : []),
      ...(cfg.taigaProject === undefined ? ['taigaProject'] : []),
      ...(cfg.taigaAuth === undefined ? ['taigaAuth'] : []),
    ]
    if (missing.length > 0) {
      throw new Error(`daemon.yaml：platform: taiga 缺必配键：${missing.join('、')}（见 serve.ts 头注 taiga 段）`)
    }
  }
  // —— 人事同步器交叉校验（DEV-48，docs/52；细节在 assembly/hrsync/config.ts）——
  validateHrServeCross(cfg)
  // —— 受权重启交叉校验（studio-dev-504 S4）：关就是关/开面须有有效授权——
  validateRestartCross(cfg, new Set(Object.keys(raw)))
  // —— matrix 必配键交叉校验（105-刀A A-3；fail-fast 同 taiga 先例）：开关开=非敏感装配
  //    面必齐；bot 密码只经 env MATRIX_BOT_PASSWORD（永不入 yaml，21A D5）——
  //    键组由装配单元 apps/boot 消费（daemon 只收不发 Matrix 网络请求）。
  if (cfg.matrix) {
    const missingMatrix = [
      ...(cfg.matrixHomeserverUrl === undefined ? ['matrixHomeserverUrl'] : []),
      ...(cfg.matrixUserId === undefined ? ['matrixUserId'] : []),
    ]
    if (missingMatrix.length > 0) {
      throw new Error(
        `daemon.yaml：matrix: true 缺必配键：${missingMatrix.join('、')}（105-刀A；密码经 env MATRIX_BOT_PASSWORD 供给，不入 yaml）`,
      )
    }
  }
  // —— 频道供给交叉校验（130-P3，130 提案 §6.7.3-③；fail-fast 同 matrix 先例）
  crossValidateMatrixChannels(cfg)
  // —— 持久对话交叉校验（docs/21-§七.6，studio-dev-646 Phase 1；fail-fast 同 matrix 先例）：
  //    开关开=矩阵源/制作人/白名单必有；缺省会话目录落 <rootDir>/conversations（运行期资产，
  //    不进公司 git 契约包、不进 Taiga——docs/21-§七.1）。关=以下一律不校验（行为零变）。
  if (cfg.conversation) {
    const missingConversation = [
      ...(!cfg.matrix ? ['matrix: true'] : []),
      ...(cfg.matrixProducerMxid === undefined || cfg.matrixProducerMxid.trim() === '' ? ['matrixProducerMxid'] : []),
      ...(cfg.conversationRooms === undefined || cfg.conversationRooms.length === 0 ? ['conversationRooms'] : []),
    ]
    if (missingConversation.length > 0) {
      throw new Error(
        `daemon.yaml：conversation: true 缺必配键：${missingConversation.join('、')}（docs/21-§七.6；DM 房消息入站与命令鉴权都要制作人身份）`,
      )
    }
    const defaultPerson = cfg.conversationDefaultPerson ?? 'PRIME-0'
    if (!/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(defaultPerson)) {
      throw new Error(`daemon.yaml：conversationDefaultPerson 须为工号样式（如 PRIME-0；实得 ${defaultPerson}）`)
    }
    const window = cfg.conversationWindow ?? 12
    const maxChars = cfg.conversationMaxChars ?? 6000
    const maxMessageChars = cfg.conversationMaxMessageChars ?? 2000
    if (maxMessageChars > maxChars) {
      throw new Error(
        `daemon.yaml：conversationMaxMessageChars(${maxMessageChars}) 不得大于 conversationMaxChars(${maxChars})——单条全占预算会让窗口恒定 1 条`,
      )
    }
    if (window < 1) throw new Error('daemon.yaml：conversationWindow 须 ≥1')
    if (cfg.conversationDir === undefined || cfg.conversationDir.trim() === '') {
      cfg.conversationDir = path.join(cfg.rootDir, 'conversations')
    }
  }
  return cfg
}

// —— 签根供给与 SEC-WD-02 绑定比对（MIG-07 搬迁：serveconfig/coerce.ts 收口，路径名不变）——
export {
  GATEWAY_SECRET_ENV,
  assertPlatformBinding,
  daemonIdentity,
  resolveGatewaySecret,
  type DaemonIdentity,
  type GatewaySecretOrigin,
  type GatewaySecretSource,
  type ResolvedGatewaySecret,
} from '../serveconfig/coerce.ts'
