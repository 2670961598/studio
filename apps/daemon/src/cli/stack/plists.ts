// plists —— `studio-next stack` 命令组的纯函数面（M5-1 第一刀，2026-11-21）。
//
// 依据（实现单引用设计文档章节号——AGENTS §五.1）：
//   - docs/plan/08-M5打包分发-2026-11-20.md §2.2（一键起停：up=plist 实例化＋load；
//     launchd 首版）、§2.5（down 数据全保留）、§三 里程碑5-1（CLI 骨架刀）
//   - docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 里程碑5（干净机器一条命令起公司）
//   - scripts/ops/chatd-setup.mjs（M4.5 判例：var/workbench 约定、0600/0700 纪律、
//     label io.studionext.chatd.<slug>、__占位符__ 模板、原子写、不 load 须显式确认）
//   - ops/launchd/io.studionext.daemon.plist（guardian 保活模板——本命令组 daemon 侧同构）
//
// 纪律：
//   - 仓内零 host 绝对路径：模板全部 __占位符__，实例化只发生在目标机
//     ~/Library/LaunchAgents（生成物落主机不落仓）；缺省值运行时推导（deploy/node/home）。
//   - plist 与 chatd-setup.mjs PLIST_TEMPLATE 同构（socket/db/token 走 env、不嵌 token 值）；
//     本刀在 CLI 侧内联同款模板（.mjs 无类型面不可直接 import）——漂移由
//     test/v2/cli/stack.test.ts 关键行断言背书，M5-2 收敛单一源时一并处理。
//   - 幂等：同输入 → 同字节 plist（renderPlist 纯函数；占位符残留即抛，不落盘）。
import path from 'node:path'

/** 生产约定（与 scripts/ops/chatd-setup.mjs CONVENTIONS 同源；daemon 缺省推导同款） */
export const STACK_CONVENTIONS = Object.freeze({
  /** <companyDir>/var/workbench —— chatd 数据面（socket/db/token 三件） */
  varRel: Object.freeze(['var', 'workbench']),
  dbFile: 'chat.db',
  socketFile: 'chat.sock',
  tokenFile: 'chatd.token',
  /** label 根前缀（chatd label=<prefix>.chatd.<slug>，daemon label=<prefix>.daemon） */
  labelPrefix: 'io.studionext',
  plistRel: Object.freeze(['Library', 'LaunchAgents']),
  logRel: Object.freeze(['Library', 'Logs', 'studio-next']),
  throttleIntervalSec: 10,
})

/** 期望权限（docs/plan/08 §四 验收 #2：chat.sock 0700 / chatd.token·chat.db 0600） */
export const EXPECTED_MODES = Object.freeze({ socket: 0o700, db: 0o600, token: 0o600 })

/** stack 用法错误（可预期面：参数/路径非法——CLI 收口为 exit 1 + 简段） */
export class StackUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StackUsageError'
  }
}

/** 公司 slug 规则（label 进 launchd，防非法字符；chatd-setup buildPlan 同款口径） */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i

/** slug 解析：--company 显式优先，缺省=公司目录名；非法即抛（明报，不静默兜底） */
export function normalizeSlug(input: { companyDir: string; company?: string | undefined }): string {
  const explicit = input.company ?? ''
  const candidate = explicit !== '' ? explicit : path.basename(path.resolve(input.companyDir))
  if (!SLUG_RE.test(candidate)) {
    throw new StackUsageError(`公司 slug 非法（须 [a-z0-9-]，首字符字母数字）：${candidate}${explicit !== '' ? '' : '（取自 --company-dir 目录名；可用 --company 显式指定）'}`)
  }
  return candidate.toLowerCase()
}

/** label 三件（daemon=guardian 固定名；chatd/panel 按公司实例化——plan/08 §2.2 判例） */
export function stackLabels(labelPrefix: string, slug: string): { daemon: string; chatd: string; panel: string } {
  return { daemon: `${labelPrefix}.daemon`, chatd: `${labelPrefix}.chatd.${slug}`, panel: `${labelPrefix}.panel.${slug}` }
}

/* ------------------------------------------------------------------ */
/* plist 模板（占位符实例化；与仓内既有模板同构）                        */
/* ------------------------------------------------------------------ */

/** daemon 侧＝guardian 保活（ops/launchd/io.studionext.daemon.plist 同构：guardian 再监护 daemon） */
export const DAEMON_PLIST_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- 由 studio-next stack up 实例化（M5-1；缺省 dry-run 可预览）。保活 guardian，guardian 再监护 daemon。 -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>__LABEL__</string>
  <key>ProgramArguments</key>
  <array>
    <string>__NODE_BIN__</string>
    <string>__GUARDIAN__</string>
    <string>--config</string>
    <string>__DAEMON_CONFIG__</string>
  </array>
  <key>WorkingDirectory</key>
  <string>__DEPLOY_ROOT__</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>__THROTTLE__</integer>
  <key>StandardOutPath</key>
  <string>__LOG_OUT__</string>
  <key>StandardErrorPath</key>
  <string>__LOG_ERR__</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`

/** chatd 侧（scripts/ops/chatd-setup.mjs PLIST_TEMPLATE 同构：token 走 TOKEN_FILE 不嵌值） */
export const CHATD_PLIST_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- 由 studio-next stack up 实例化（M5-1；缺省 dry-run 可预览）。token 只带文件路径，不嵌值。 -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>__LABEL__</string>
  <key>ProgramArguments</key>
  <array>
    <string>__NODE_BIN__</string>
    <string>--experimental-strip-types</string>
    <string>__CHATD_MAIN__</string>
  </array>
  <key>WorkingDirectory</key>
  <string>__DEPLOY_ROOT__</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WORKBENCH_CHATD_SOCKET</key>
    <string>__SOCKET__</string>
    <key>WORKBENCH_CHATD_DB</key>
    <string>__DB__</string>
    <key>WORKBENCH_CHATD_TOKEN_FILE</key>
    <string>__TOKEN_FILE__</string>
    <key>WORKBENCH_CHATD_LOG</key>
    <string>info</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>__THROTTLE__</integer>
  <key>StandardOutPath</key>
  <string>__LOG_OUT__</string>
  <key>StandardErrorPath</key>
  <string>__LOG_ERR__</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`

/** panel 侧（:8791 只读监控面常驻——`studio-next panel` 命令直跑，launchd 保活） */
export const PANEL_PLIST_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- 由 studio-next stack up 实例化（M5-1；缺省 dry-run 可预览）。只读面，库不存在即拒启。 -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>__LABEL__</string>
  <key>ProgramArguments</key>
  <array>
    <string>__NODE_BIN__</string>
    <string>--experimental-strip-types</string>
    <string>__CLI_MAIN__</string>
    <string>panel</string>
    <string>--db</string>
    <string>__DB__</string>
    <string>--company-dir</string>
    <string>__COMPANY_DIR__</string>
    <string>--port</string>
    <string>__PANEL_PORT__</string>
  </array>
  <key>WorkingDirectory</key>
  <string>__DEPLOY_ROOT__</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>__THROTTLE__</integer>
  <key>StandardOutPath</key>
  <string>__LOG_OUT__</string>
  <key>StandardErrorPath</key>
  <string>__LOG_ERR__</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`

/** 残留 __占位符__ 即抛（模板/计划不齐不落盘——chatd-setup renderPlist 同款防线） */
export function renderPlist(template: string, map: Readonly<Record<string, string>>): string {
  let out = template
  for (const [key, value] of Object.entries(map)) out = out.split(key).join(value)
  const residual = out.match(/__[A-Z_]+__/g)
  if (residual !== null) throw new Error(`plist 渲染残留占位符：${residual.join(',')}`)
  return out
}

/* ------------------------------------------------------------------ */
/* 扁平 YAML 标量读（daemon.yaml 子集：`key: value`——serve 骨架同款面）   */
/* ------------------------------------------------------------------ */

/**
 * 读扁平 `key: value` 标量（# 注释行跳过；值支持 JSON 双引号/单引号壳；行尾 ` #…` 注释剥离）。
 * 只服务 stack 面（doctor 读 platform、up 读 db）——**不做**全量配置校验（那是
 * `serve --config` 的 CONFIG_INVALID 面；这里缺键=如实报缺，不猜）。
 */
export function readFlatYamlScalars(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    let value = line.slice(colon + 1).trim()
    if (value === '') continue
    if (value.startsWith('"')) {
      const m = /^"((?:[^"\\]|\\.)*)"/.exec(value)
      if (m !== null) {
        try {
          out[key] = JSON.parse(`"${m[1]}"`) as string
          continue
        } catch {
          /* 落到裸值面 */
        }
      }
    } else if (value.startsWith("'")) {
      const m = /^'([^']*)'/.exec(value)
      if (m !== null) {
        out[key] = m[1] ?? ''
        continue
      }
    } else {
      const hash = value.indexOf(' #')
      if (hash !== -1) value = value.slice(0, hash).trim()
    }
    out[key] = value
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 安装/停服计划（纯推导，零 IO——路径全集 + label + 命令）               */
/* ------------------------------------------------------------------ */

export interface StackServicePlan {
  readonly id: 'daemon' | 'chatd' | 'panel'
  readonly label: string
  readonly plistPath: string
  readonly logOut: string
  readonly logErr: string
  readonly plist: string
  /** 展示形命令（uid 用 $(id -u) 字面——chatd-setup 判例）；执行形由 CLI 侧组 argv */
  readonly bootstrapCmd: string
  readonly bootoutCmd: string
}

export interface StackUpPlan {
  readonly slug: string
  readonly companyDir: string
  readonly varDir: string
  readonly socketPath: string
  readonly dbPath: string
  readonly tokenFile: string
  readonly deployRoot: string
  readonly nodeBin: string
  readonly guardianConfig: string
  readonly daemonConfigPath: string
  readonly daemonDb: string
  readonly port: number
  readonly panelPort: number
  readonly guardianEntry: string
  readonly chatdEntry: string
  readonly cliEntry: string
  readonly services: readonly StackServicePlan[]
}

/** 空串/undefined 统一视作「未指定」（parseArgs 缺省 '' 与直接调用缺键同语义） */
function orDefault(value: string | undefined, fallback: string): string {
  return value !== undefined && value !== '' ? value : fallback
}

function resolveDir(value: string | undefined, fallback: string): string {
  return path.resolve(orDefault(value, fallback))
}

/**
 * up 安装计划（纯推导）。占位全部显式入参/运行时推导，仓内不落主机路径。
 * daemonDb＝daemon.yaml 的 db 键（panel --db 来源）；guardianConfig＝guardian.json 路径。
 */
export function buildUpPlan(input: {
  companyDir: string
  company?: string
  deployRoot: string
  nodeBin: string
  guardianConfig: string
  daemonConfigPath: string
  daemonDb: string
  port: number
  panelPort: number
  home: string
  labelPrefix: string
  launchAgents?: string
  logDir?: string
}): StackUpPlan {
  const companyDir = path.resolve(input.companyDir)
  const slug = normalizeSlug({ companyDir, company: input.company })
  const home = path.resolve(input.home)
  const deployRoot = path.resolve(input.deployRoot)
  const labels = stackLabels(input.labelPrefix, slug)
  const launchAgents = resolveDir(input.launchAgents, path.join(home, ...STACK_CONVENTIONS.plistRel))
  const logDir = resolveDir(input.logDir, path.join(home, ...STACK_CONVENTIONS.logRel, slug))
  const varDir = path.join(companyDir, ...STACK_CONVENTIONS.varRel)
  const throttle = String(STACK_CONVENTIONS.throttleIntervalSec)

  const daemonPlist = renderPlist(DAEMON_PLIST_TEMPLATE, {
    __LABEL__: labels.daemon,
    __NODE_BIN__: path.resolve(input.nodeBin),
    __GUARDIAN__: path.join(deployRoot, 'scripts', 'guardian.mjs'),
    __DAEMON_CONFIG__: path.resolve(input.guardianConfig),
    __DEPLOY_ROOT__: deployRoot,
    __THROTTLE__: throttle,
    __LOG_OUT__: path.join(logDir, 'guardian.out.log'),
    __LOG_ERR__: path.join(logDir, 'guardian.err.log'),
  })
  const chatdPlist = renderPlist(CHATD_PLIST_TEMPLATE, {
    __LABEL__: labels.chatd,
    __NODE_BIN__: path.resolve(input.nodeBin),
    __CHATD_MAIN__: path.join(deployRoot, 'apps', 'workbench-chatd', 'src', 'main.ts'),
    __DEPLOY_ROOT__: deployRoot,
    __SOCKET__: path.join(varDir, STACK_CONVENTIONS.socketFile),
    __DB__: path.join(varDir, STACK_CONVENTIONS.dbFile),
    __TOKEN_FILE__: path.join(varDir, STACK_CONVENTIONS.tokenFile),
    __THROTTLE__: throttle,
    __LOG_OUT__: path.join(logDir, 'chatd.out.log'),
    __LOG_ERR__: path.join(logDir, 'chatd.err.log'),
  })
  const panelPlist = renderPlist(PANEL_PLIST_TEMPLATE, {
    __LABEL__: labels.panel,
    __NODE_BIN__: path.resolve(input.nodeBin),
    __CLI_MAIN__: path.join(deployRoot, 'apps', 'daemon', 'src', 'cli', 'main.ts'),
    __DEPLOY_ROOT__: deployRoot,
    __DB__: path.resolve(input.daemonDb),
    __COMPANY_DIR__: companyDir,
    __PANEL_PORT__: String(input.panelPort),
    __THROTTLE__: throttle,
    __LOG_OUT__: path.join(logDir, 'panel.out.log'),
    __LOG_ERR__: path.join(logDir, 'panel.err.log'),
  })

  const service = (id: StackServicePlan['id'], label: string, plist: string, logOut: string, logErr: string): StackServicePlan => {
    const plistPath = path.join(launchAgents, `${label}.plist`)
    return {
      id,
      label,
      plistPath,
      logOut,
      logErr,
      plist,
      bootstrapCmd: `launchctl bootstrap gui/$(id -u) ${plistPath}`,
      bootoutCmd: `launchctl bootout gui/$(id -u)/${label}`,
    }
  }

  return {
    slug,
    companyDir,
    varDir,
    socketPath: path.join(varDir, STACK_CONVENTIONS.socketFile),
    dbPath: path.join(varDir, STACK_CONVENTIONS.dbFile),
    tokenFile: path.join(varDir, STACK_CONVENTIONS.tokenFile),
    deployRoot,
    nodeBin: path.resolve(input.nodeBin),
    guardianConfig: path.resolve(input.guardianConfig),
    daemonConfigPath: path.resolve(input.daemonConfigPath),
    daemonDb: path.resolve(input.daemonDb),
    port: input.port,
    panelPort: input.panelPort,
    guardianEntry: path.join(deployRoot, 'scripts', 'guardian.mjs'),
    chatdEntry: path.join(deployRoot, 'apps', 'workbench-chatd', 'src', 'main.ts'),
    cliEntry: path.join(deployRoot, 'apps', 'daemon', 'src', 'cli', 'main.ts'),
    services: [
      service('daemon', labels.daemon, daemonPlist, path.join(logDir, 'guardian.out.log'), path.join(logDir, 'guardian.err.log')),
      service('chatd', labels.chatd, chatdPlist, path.join(logDir, 'chatd.out.log'), path.join(logDir, 'chatd.err.log')),
      service('panel', labels.panel, panelPlist, path.join(logDir, 'panel.out.log'), path.join(logDir, 'panel.err.log')),
    ],
  }
}

export interface StackDownPlan {
  readonly slug: string
  readonly companyDir: string
  readonly labels: { readonly daemon: string; readonly chatd: string; readonly panel: string }
  readonly bootoutCmds: readonly string[]
}

/** down 停服计划（纯推导）：bootout 三 label；plist 文件与数据面全保留（plan/08 §2.5） */
export function buildDownPlan(input: { companyDir: string; company?: string; labelPrefix: string }): StackDownPlan {
  const companyDir = path.resolve(input.companyDir)
  const slug = normalizeSlug({ companyDir, company: input.company })
  const labels = stackLabels(input.labelPrefix, slug)
  return {
    slug,
    companyDir,
    labels,
    bootoutCmds: [labels.daemon, labels.chatd, labels.panel].map((label) => `launchctl bootout gui/$(id -u)/${label}`),
  }
}
