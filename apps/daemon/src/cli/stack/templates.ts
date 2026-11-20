// templates —— `studio-next stack` 服务模板单一源（M5-2 第二刀，2026-11-21）。
//
// 依据（实现单引用设计文档章节号——AGENTS §五.1）：
//   - docs/plan/08-M5打包分发-2026-11-20.md §2.2（launchd＋systemd 双制式）、§三 里程碑5-2
//     （运维脚本刀：Linux systemd user unit）、§七.6/§八（模板单一源收敛记录）
//   - docs/plan/06-自研单子与聊天室切换-2026-11-19.md §二 里程碑5（干净机器一条命令起公司）
//
// 单一源纪律（M5-2 收敛——此前 chatd launchd 模板在 stack/plists.ts 与
// scripts/ops/chatd-setup.mjs 两处重复，靠测试关键行断言背书）：
//   - 三服务 × 双制式（launchd plist / systemd user unit）六枚模板**全部**定义在本件；
//     plists.ts（launchd 计划）、systemd.ts（systemd 计划）只引用不复制；
//     scripts/ops/chatd-setup.mjs 经 Node 24 原生 type-stripping 直接 import 本件
//     （scripts/ 不在宪法扫描面——boundary-rules.mjs scopeDirs；.ts 引用方向
//     apps→scripts 为 escape 违例，唯一合法方向即本向）。
//   - 仓内零 host 绝对路径：模板全部 __占位符__，实例化只发生在目标机
//     （macOS ~/Library/LaunchAgents／Linux ~/.config/systemd/user）；缺省值运行时推导。
//   - token 只带 WORKBENCH_CHATD_TOKEN_FILE 路径，值永不入任何模板（密钥纪律）。
//   - 幂等：同输入 → 同字节（renderTemplate 纯函数；占位符残留即抛，不落盘）。
//
// 制式差异速查（plan/08 §八）：
//   - 常驻保活：launchd=RunAtLoad+KeepAlive+ThrottleInterval；systemd=Enable+WantedBy=
//     default.target+Restart=on-failure+RestartSec（10s 与 ThrottleInterval 同值）。
//   - 入口：launchd 逐参数组 ProgramArguments（绝对路径）；systemd ExecStart 用
//     WorkingDirectory=deployRoot ＋ 相对 deployRoot 入口（scripts/guardian.mjs 等）。
//   - 环境：launchd EnvironmentVariables dict；systemd Environment="KEY=value" 行（值
//     带引号防路径空格断裂）＋可选 EnvironmentFile 行（--env-file）。
//   - 日志：launchd StandardOut/ErrorPath 落文件；systemd user unit 走 journald
//     （journalctl --user -u <unit>），不落文件——模板不含日志占位符。
import path from 'node:path'

/* ------------------------------------------------------------------ */
/* launchd plist 模板（macOS——M5-1 起在位，M5-2 收拢单一源）             */
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

/**
 * chatd 侧——**双消费面单一源**：stack up（plists.ts buildUpPlan）与
 * scripts/ops/chatd-setup.mjs renderPlist 共用本模板（M4.5 起在位；token 走
 * TOKEN_FILE 不嵌值；__DEPLOY_ROOT__/__LOG_LEVEL__/__THROTTLE__ 统一占位面）。
 */
export const CHATD_PLIST_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- 由 studio-next stack up（或 scripts/ops/chatd-setup.mjs）实例化；缺省 dry-run 可预览。token 只带文件路径，不嵌值。 -->
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
    <string>__LOG_LEVEL__</string>
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

/* ------------------------------------------------------------------ */
/* systemd user unit 模板（Linux——M5-2 新增；§六「首验 macOS」口径，     */
/* 本仓只出模板与 dry-run 预览，不在本机装 systemd）                     */
/* ------------------------------------------------------------------ */

/** daemon 侧＝guardian 保活（与 launchd 版同模型：guardian 再监护 daemon） */
export const DAEMON_UNIT_TEMPLATE = `# 由 studio-next stack up 实例化（M5-2 systemd user unit；缺省 dry-run 可预览）。保活 guardian，guardian 再监护 daemon。
[Unit]
Description=Studio Next daemon guardian（__LABEL__）

[Service]
Type=simple
WorkingDirectory=__DEPLOY_ROOT__
ExecStart=__NODE_BIN__ scripts/guardian.mjs --config __GUARDIAN_CONFIG__
Restart=on-failure
RestartSec=__RESTART_SEC__
__ENV_FILE_LINE__

[Install]
WantedBy=default.target
`

/** chatd 侧（token 走 TOKEN_FILE 不嵌值；env 四键与 launchd 版同源约定） */
export const CHATD_UNIT_TEMPLATE = `# 由 studio-next stack up 实例化（M5-2 systemd user unit；缺省 dry-run 可预览）。token 只带文件路径，不嵌值。
[Unit]
Description=Studio Next chatd（__LABEL__）

[Service]
Type=simple
WorkingDirectory=__DEPLOY_ROOT__
ExecStart=__NODE_BIN__ --experimental-strip-types apps/workbench-chatd/src/main.ts
Environment="WORKBENCH_CHATD_SOCKET=__SOCKET__"
Environment="WORKBENCH_CHATD_DB=__DB__"
Environment="WORKBENCH_CHATD_TOKEN_FILE=__TOKEN_FILE__"
Environment="WORKBENCH_CHATD_LOG=__LOG_LEVEL__"
Restart=on-failure
RestartSec=__RESTART_SEC__
__ENV_FILE_LINE__

[Install]
WantedBy=default.target
`

/** panel 侧（:8791 只读监控面常驻——`studio-next panel` 命令直跑，systemd 保活） */
export const PANEL_UNIT_TEMPLATE = `# 由 studio-next stack up 实例化（M5-2 systemd user unit；缺省 dry-run 可预览）。只读面，库不存在即拒启。
[Unit]
Description=Studio Next panel（__LABEL__）

[Service]
Type=simple
WorkingDirectory=__DEPLOY_ROOT__
ExecStart=__NODE_BIN__ --experimental-strip-types apps/daemon/src/cli/main.ts panel --db __DB__ --company-dir __COMPANY_DIR__ --port __PANEL_PORT__
Restart=on-failure
RestartSec=__RESTART_SEC__
__ENV_FILE_LINE__

[Install]
WantedBy=default.target
`

/* ------------------------------------------------------------------ */
/* 渲染（纯函数；双制式共用）                                            */
/* ------------------------------------------------------------------ */

/** 残留 __占位符__ 即抛（模板/计划不齐不落盘——chatd-setup.mjs/renderPlist 同款防线） */
export function renderTemplate(template: string, map: Readonly<Record<string, string>>): string {
  let out = template
  for (const [key, value] of Object.entries(map)) out = out.split(key).join(value)
  const residual = out.match(/__[A-Z_]+__/g)
  if (residual !== null) throw new Error(`模板渲染残留占位符：${residual.join(',')}`)
  return out
}

/** 可选 EnvironmentFile 行的两种渲染值（整行占位——未指定时留自述注释行，不留空行） */
export function envFileLine(envFile: string | null | undefined): string {
  return envFile !== null && envFile !== undefined && envFile !== ''
    ? `EnvironmentFile=${path.resolve(envFile)}`
    : '# EnvironmentFile 未指定（--env-file <路径> 可选注入 daemon.env 等凭据面）'
}
