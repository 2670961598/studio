#!/usr/bin/env node
// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L1-L113（头注）+L1549-L1603（main 体）逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、新装配 import 头与路径注记机械替换）。
/**
 * studio-next CLI（v0.1-M3；落点按 docs/25-§七 P1 拟批默认：daemon 包出 bin，不新增 apps/cli）
 *
 * 子命令：
 *   init <slug> [--name <公司名>] [--dir <目录>] [--template <模板目录>]
 *       从模板生成公司目录（默认模板 templates/company-2-level）：复制 → 占位替换 → 自检 → git 首提
 *   company add <git-url> [名] [--dir|--work-root|--plugin-root|--platform-root|--aiws-root|--by]
 *       git 网址即公司（DEV-27；docs/43-§一+§十1-4）：clone → 剥 .git 重建本地仓 → schema
 *       校验 → provision+信任锚+.AIWS 建树+依赖清单安装（隔离根）；升级=同 url 再跑（幂等）
 *   company create <slug> [名] [--name|--dir|--template|--platform|--work-root|--db|
 *                     --plugin-root|--platform-root|--aiws-root|--by|--dry-run]
 *       公司创建编排（DEV-15 / docs/36-§4 M-B 骨架刀）：init→provision→全员建号→jobs
 *       装载→插件 provisioning→验收报告一条命令串完，幂等（已有同 slug 合法目录=adopt
 *       收敛不重建）；--dry-run 全相位只出计划零落盘
 *   validate <目录>
 *       目录结构校验：不合法逐条打印「文件:行 [规则] 修法」到 stderr，exit 1（04-§九）
 *   ledger drill <库路径>
 *       删库重建演习（F2-12 可操作化）：自建语料写入 → dump → 删库三件套 → 原路径重建 →
 *       比对报告；结论行「演习 PASS/FAIL」，exit 0/1（库路径必须不存在——防误删真实台账）
 *   ledger dump <库路径> <输出.jsonl>
 *       events 全量导出 JSONL（F2-11 库→JSONL 单向派生）
 *   ledger rebuild <源.jsonl> <目标库>
 *       JSONL → 新库重放（单事务原子，坏行中止指明行号；F2-12）
 *   candidates list --db <库路径>
 *       进化管线现状只读列表（v0.10，docs/16-§四/17-§3/20-§九）：candidates 全量按
 *       (created_at,id) 升序——汇总行（总数+状态分布）+ 逐行 id/状态/资产类型/blast_radius/
 *       version/谱系父/资产路径/diff 哈希；库不存在即拒（只读面不代建库，panel 同款闸）
 *   sandbox --db <库路径> --candidate <id> [--command <冻结验收命令>] [--file <变更文件>]
 *           [--timeout <ms>] [--root <资产根目录>]
 *       进化链沙箱执行器（20-§九「候选制品→沙箱→三态闸门」的沙箱环节；临时目录法——
 *       生产零触碰，结构性保证见 src/evolve/sandbox.ts 头注）：取候选 → tmp 拷贝最小集（资产+
 *       同目录测试文件）→ 应用变更（--file=资产整文件替换，v0）→ 跑冻结验收命令
 *       （--command；超时进程组杀）→ updateVerification 落证据（sandboxPass=判定）→
 *       proposed 则迁移 sandboxed——一条命令进沙箱。判定红非命令错误（exit 0，档案面）；
 *       无 --command 即 fail 如实（无验收命令=不可验证=不过）。
 *   cutover --db <库路径> --candidate <id> --file <新文件> --company <公司slug>
 *           [--no-restart] [--no-gray] [--root <资产根目录>] [--actor <actor>] [--dept <部门path>]
 *           [--level <1-9>]
 *       进化链切权执行器（20-§九管线「→灰度→切权」的切权环节，进化链四刀之三，
 *       src/evolve/cutover.ts）：approved/promoted 候选**受控上产**——双闸（状态前置 + 判负闸
 *       authorize 写前复跑，evolve-guard 观察模式的受控对偶）→ 备份现存目标为
 *       <目标>.bak-<候选id>（回滚锚点，保留）→ 同目录 tmp+rename 原子写 → 读回复核
 *       hash → approved 则迁移 promoted（core 判边+乐观锁）→ SCHEMA_EVOLVE 事件落账
 *       （note=候选+资产+旧新 hash）。任一失败面先回滚再如实报（不留半改态）。
 *       切权成功**默认开灰度观察窗**（kv gray:<候选id>；--no-gray 跳过）。
 *       --no-restart 抑制重启提示；v0 恒不实际重启（supervisor 看护归运维刀——诚实边界）。
 *       库必须已存在（写面不代建库）。
 *   gray --db <库路径> --candidate <id> [--check | --close] [--root <资产根目录>]
 *       灰度观察窗三动作（20-§四灰度零事故；进化链四刀之四收官，src/evolve/gray.ts）：
 *       缺省=查窗（窗状态/阈值/锚点只读）；--check=手动检查（窗内 ESCALATE/CIRCUIT_BREAK
 *       事故信号计数 ≥ 阈值 → **自动回滚**：备份逐字节恢复+复核+promoted→retired+
 *       SCHEMA_EVOLVE 事件 note=gray-rollback；窗到期无事故 → 关窗=灰度完成可请求制作人
 *       过目；守夜中 → 无动作）；--close=手动关窗（幂等，关窗不回滚）。回滚是合法判定
 *       结果非命令错误（exit 0）；无窗候选/用法错 exit 1；库必须已存在（写面不代建库）。
 *       观察窗驱动接 daemon tick（每拍自动 check）归真单刀——本面为 check+CLI。
 *   postmortem --db <库路径> --company <slug> --issue <复盘单号> --input <复盘.json>
 *             [--casebook <案例库目录>] [--slug <条目slug>] [--date <YYYY-MM-DD>]
 *             [--dept <部门path>] [--level <1-9>] [--actor <actor>]
 *       复盘归档链（20-§十一「发现→止血→复盘（挂复盘单）→案例库」的复盘→案例库两环；
 *       进化链四刀之二，src/evolve/postmortem.ts）：断路器关联（该单 CIRCUIT_BREAK/ESCALATE
 *       台账历史自动进时间线）→ 渲染复盘模板（七节，无「责任人」字段——不追责的机制化）
 *       → 写案例库条目文件（<casebook>/<date>-<slug>.md：条目+完整复盘自包含）→ 落
 *       POSTMORTEM 事件（note=条目路径、size、payload_hash）。--input 必给（复盘正文
 *       不可虚构——缺即拒，fail-closed）；库必须已存在（写面不代建库）。
 *   panel --db <库路径> [--port 8787]
 *       :8787 只读监控面（v0.3）：jobs/runs/workers/事件流（SSE），全部读 SQLite 零写；
 *       库不存在即拒启（panel 不代建库）；SIGINT/SIGTERM 优雅关闭
 *   overview --company <目录> [--company <目录2> …] [--db <库路径>] [--port 8789]
 *       :8789 公司概览面（v0.7 读面）：挂载公司目录（校验不过拒绝挂载）→ /<slug>/ 概览/
 *       组织/人事/进度/财务五读面（全 GET 只读、服务端渲染零前端依赖）；--db 可选（给出则
 *       进度/财务页读台账，必须已存在——只读不代建库）；项目/报表/编辑中心归后续刀。
 *       【选型说明（拟稿）】独立子命令而非 serve --overview-port：:8787 本就是独立 panel
 *       子命令（serve 主循环不内嵌面板），:8789 同款——只读壳与 daemon 生命周期解耦，
 *       WAL 同库并存安全；待制作人批示后固化
 *   external --company <目录> [--company <目录2> …] [--db <库路径>] [--port 8788]
 *            [--token <触发面令牌>] [--requests-per-minute N] [--lan]
 *       :8788 对外 API（v0.9 信息/触发骨架）：信息端点全 GET 全公开（D5）——/v1/company、
 *       /v1/org、/v1/people、/v1/projects、/v1/issues、/v1/finance、/v1/reports；
 *       触发端点 POST /v1/requests（X-SN-Token 必带，**只落单不派工**，幂等键防重，IP 配额
 *       429）；/v1/agent-card（名片带版本）；SSE 订阅 501 占位。越权调用全部 fail-closed
 *       （16-§四 v0.9）。--token 缺省=触发面全 401；--db 给出才装配触发面（必须已存在——
 *       不代建库）。【绑定面（D4 拟稿反转说明）】D4「默认局域网」是部署意图，安全缺省取
 *       **127.0.0.1** 只绑本机；对局域网开放须显式 --lan（绑 0.0.0.0）。
 *       【触发面平台（拟稿）】本子命令以 fake 平台过真网关闸（demo 骨架，与 serve demo 模式
 *       同款：DEV_GATEWAY_SECRET 开发密钥+警告）；真 YouTrack/localfile 接线与生产密钥归
 *       daemon 装配后续刀（写闸已在网关侧收口——panel 包不碰 gateway）
 *   serve --config <daemon.yaml>
 *       常驻主循环（v0.5）：七相位引擎 + 心跳日志；SIGINT/SIGTERM 优雅停（等当前拍收口→
 *       在途 drain→关台账）。配置最小面 {db, platform: localfile|fake, company, rootDir,
 *       tickMs, …}（扁平 YAML 子集，见 src/serve.ts 头注）；demo 模式=fake 全家桶零外部依赖
 *   reload [--company <slug>] [--root <工位根>] [--config <daemon.yaml>] [--timeout <ms>]
 *       L1 配置热重载手动触发（docs/38-§2 L1 / §4 R-A）：向运行中的 daemon 发重载请求
 *       （控制面文件通道 <rootDir>/control/）并等回执——daemon 在拍边界重走公司目录装载面
 *       （校验→快照→装配器/人员/调度岗替换），零进程重启。--company 给定且与目标 daemon
 *       不符=回执拒绝（防错家）；daemon 未挂公司目录=回执 no-company-dir。工位根发现序：
 *       --root > --config 的 rootDir（缺省 ./daemon.yaml）> ./var。幂等：内容未变回执
 *       unchanged（exit 0）。
 *   stop [--reason <事由>] [--root <工位根>] [--config <daemon.yaml>] [--timeout <ms>]
 *       控制面优雅停机（DEV-9 顺带项）：向运行中的 daemon 发停机请求（控制面文件通道
 *       <rootDir>/control/stop.request.json，协议与 reload 手动通道同款）并等回执——
 *       daemon 在拍边界走自身优雅停（在途 worker 整树杀+台账落盘）。运维不再 kill
 *       `nohup sh -c` 外层壳（kill 壳不杀 node 孙进程——孤儿问题从通道面根除）。
 *       DEV-41：daemon 消费请求后改名 .consume（去重位落 daemon_kv 跨重启）——残留
 *       请求不再使重启进程一拍自停；回执文件保留，本命令轮询按 id 匹配不受影响。
 *   （v0 诚实边界：真 dsh / 真 YouTrack / 网关 wkey / 审批流 / localfile 平台均未接线——
 *     逐项清单见 src/serve.ts 与 src/engine/engine.ts 头注）
 *
 * argv 解析零依赖手写（单命令薄壳不值得引库；16-§二 选型纪律：引新依赖须登记选型表）。
 * 退出码：0 成功（sandbox 判定 PASS/FAIL 均 0——红是档案面非命令错误；gray 判定面回滚/关窗/守夜均 0——回滚是合法判定结果非命令错误）｜1 用法错误 / 校验不通过 / init 失败 / 演习 FAIL / panel 失败 / overview 失败 / external 失败 / candidates 失败 / sandbox 链面失败（库/候选/状态/写入窗）/ cutover 链面失败（双闸/备份/写/复核/迁移/落账——失败已回滚）/ gray 链面失败（无窗候选/备份缺失/回滚面失败——窗保持 open 待处置）/ postmortem 失败 / serve 配置错｜
 * 2 serve 运行中出错（tick 异常）。
 * 用 process.exitCode 而非 process.exit 收尾：让管道下的 stdout/stderr 先冲刷再自然退出。
 */
import { USAGE } from './usage.ts'
import { errText } from './argv.ts'
import { cmdInit } from './init.ts'
import { cmdCompany } from './company.ts'
import { cmdValidate } from './validate.ts'
import { cmdLedger } from './ledger.ts'
import { cmdCandidates } from './candidates.ts'
import { cmdSandbox } from './sandbox.ts'
import { cmdCutover } from './cutover.ts'
import { cmdGray } from './gray.ts'
import { cmdPostmortem } from './postmortem.ts'
import { cmdPanel } from './panel.ts'
import { cmdOverview } from './overview.ts'
import { cmdExternal } from './external.ts'
import { cmdReload } from './reload.ts'
import { cmdStop } from './stop.ts'
import { cmdServe } from './serve.ts'
async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2)
  switch (command) {
    case 'init':
      return cmdInit(rest)
    case 'company':
      return cmdCompany(rest)
    case 'validate':
      return cmdValidate(rest)
    case 'ledger':
      return cmdLedger(rest)
    case 'candidates':
      return cmdCandidates(rest)
    case 'sandbox':
      return cmdSandbox(rest)
    case 'cutover':
      return cmdCutover(rest)
    case 'gray':
      return cmdGray(rest)
    case 'postmortem':
      return cmdPostmortem(rest)
    case 'panel':
      return cmdPanel(rest)
    case 'overview':
      return cmdOverview(rest)
    case 'external':
      return cmdExternal(rest)
    case 'serve':
      return cmdServe(rest)
    case 'reload':
      return cmdReload(rest)
    case 'stop':
      return cmdStop(rest)
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(USAGE)
      return 0
    default:
      console.error(`未知子命令：${command}`)
      console.error(USAGE)
      return 1
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    console.error(`studio-next：未预期错误：${errText(err)}`)
    process.exitCode = 1
  },
)
