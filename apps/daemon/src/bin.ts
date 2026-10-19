#!/usr/bin/env node
/**
 * studio-next CLI（v0.1-M3；落点按 docs/25-§七 P1 拟批默认：daemon 包出 bin，不新增 apps/cli）
 *
 * 子命令：
 *   init <slug> [--name <公司名>] [--dir <目录>] [--template <模板目录>]
 *       从模板生成公司目录（默认模板 templates/company-2-level）：复制 → 占位替换 → 自检 → git 首提
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
 *       生产零触碰，结构性保证见 src/sandbox.ts 头注）：取候选 → tmp 拷贝最小集（资产+
 *       同目录测试文件）→ 应用变更（--file=资产整文件替换，v0）→ 跑冻结验收命令
 *       （--command；超时进程组杀）→ updateVerification 落证据（sandboxPass=判定）→
 *       proposed 则迁移 sandboxed——一条命令进沙箱。判定红非命令错误（exit 0，档案面）；
 *       无 --command 即 fail 如实（无验收命令=不可验证=不过）。
 *   cutover --db <库路径> --candidate <id> --file <新文件> --company <公司slug>
 *           [--no-restart] [--no-gray] [--root <资产根目录>] [--actor <actor>] [--dept <部门path>]
 *           [--level <1-9>]
 *       进化链切权执行器（20-§九管线「→灰度→切权」的切权环节，进化链四刀之三，
 *       src/cutover.ts）：approved/promoted 候选**受控上产**——双闸（状态前置 + 判负闸
 *       authorize 写前复跑，evolve-guard 观察模式的受控对偶）→ 备份现存目标为
 *       <目标>.bak-<候选id>（回滚锚点，保留）→ 同目录 tmp+rename 原子写 → 读回复核
 *       hash → approved 则迁移 promoted（core 判边+乐观锁）→ SCHEMA_EVOLVE 事件落账
 *       （note=候选+资产+旧新 hash）。任一失败面先回滚再如实报（不留半改态）。
 *       切权成功**默认开灰度观察窗**（kv gray:<候选id>；--no-gray 跳过）。
 *       --no-restart 抑制重启提示；v0 恒不实际重启（supervisor 看护归运维刀——诚实边界）。
 *       库必须已存在（写面不代建库）。
 *   gray --db <库路径> --candidate <id> [--check | --close] [--root <资产根目录>]
 *       灰度观察窗三动作（20-§四灰度零事故；进化链四刀之四收官，src/gray.ts）：
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
 *       进化链四刀之二，src/postmortem.ts）：断路器关联（该单 CIRCUIT_BREAK/ESCALATE
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
 *   （v0 诚实边界：真 dsh / 真 YouTrack / 网关 wkey / 审批流 / localfile 平台均未接线——
 *     逐项清单见 src/serve.ts 与 src/engine.ts 头注）
 *
 * argv 解析零依赖手写（单命令薄壳不值得引库；16-§二 选型纪律：引新依赖须登记选型表）。
 * 退出码：0 成功（sandbox 判定 PASS/FAIL 均 0——红是档案面非命令错误；gray 判定面回滚/关窗/守夜均 0——回滚是合法判定结果非命令错误）｜1 用法错误 / 校验不通过 / init 失败 / 演习 FAIL / panel 失败 / overview 失败 / external 失败 / candidates 失败 / sandbox 链面失败（库/候选/状态/写入窗）/ cutover 链面失败（双闸/备份/写/复核/迁移/落账——失败已回滚）/ gray 链面失败（无窗候选/备份缺失/回滚面失败——窗保持 open 待处置）/ postmortem 失败 / serve 配置错｜
 * 2 serve 运行中出错（tick 异常）。
 * 用 process.exitCode 而非 process.exit 收尾：让管道下的 stdout/stderr 先冲刷再自然退出。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { initCompany, loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import type { InitOptions } from '@studio-next/company'
import { servePanel } from '@studio-next/panel'
import { serveOverview } from '@studio-next/panel/overview'
import type { OverviewCompanySource } from '@studio-next/panel/overview'
import { serveExternal } from '@studio-next/panel/external'
import type { ExternalCompanySource } from '@studio-next/panel/external'
import { CANDIDATE_STATUS_VALUES, openLedger, rebuild, renderDrillReport, runLedgerDrill } from '@studio-next/store'
import type { CompanySnapshot } from '@studio-next/contract'
import { CONTROL_TICKET, createGateway } from '@studio-next/gateway'
import type { SignatureContext } from '@studio-next/gateway'
import { DEV_GATEWAY_SECRET, parseDaemonConfig } from './serve.ts'
import { createFakePlatform } from './fakes.ts'
import { createGatedPlatform } from './gated-platform.ts'
import { ENGINE_CONFIG_DEFAULTS } from './engine.ts'
import { awaitReloadResult, writeReloadRequest } from './hot-reload.ts'
import { awaitStopResult, writeStopRequest, type StopRequest } from './stop-channel.ts'
import { makeUlid } from './id.ts'
import { runServe } from './serve.ts'
import { renderSandboxLines, runCandidateSandbox } from './sandbox.ts'
import { renderCutoverLines, runCutover } from './cutover.ts'
import { renderGrayCheckLines, renderGrayStatusLines, checkGrayWindow, closeGrayWindow, readGrayWindow } from './gray.ts'
import { parsePostmortemInput, renderPostmortemLines, runPostmortemChain } from './postmortem.ts'

const USAGE = `studio-next —— Studio Next 框架 CLI（v0.1）

用法：
  studio-next init <slug> [--name <公司名>] [--dir <目录>] [--template <模板目录>]
      从模板生成公司目录（默认模板 templates/company-2-level）：复制 → 占位替换 → 自检 → git 首提
  studio-next validate <目录>
      校验公司目录结构：不合法逐条打印「文件:行 [规则] 修法」到 stderr 并 exit 1
  studio-next ledger drill <库路径>
      删库重建演习（F2-12）：语料写入 → dump → 删库三件套 → 原路径重建 → 比对报告，
      结论「演习 PASS/FAIL」exit 0/1；库路径必须不存在（防误删真实台账）；报告走 stdout 可重定向留证
  studio-next ledger dump <库路径> <输出.jsonl>
      events 全量导出 JSONL（F2-11 单向派生）
  studio-next ledger rebuild <源.jsonl> <目标库>
      JSONL → 新库重放（单事务原子；F2-12）
  studio-next candidates list --db <库路径>
      进化管线现状只读列表（v0.10，docs/16-§四）：汇总行（总数+状态分布）+ 候选逐行
      id/状态/资产类型/blast_radius/version/谱系父/资产路径/diff 哈希（(created_at,id) 升序）；
      库不存在即拒（只读面不代建库）
  studio-next sandbox --db <库路径> --candidate <id> [--command <冻结验收命令>]
                      [--file <变更文件>] [--timeout <ms>] [--root <资产根目录>]
      进化链沙箱执行器（20-§九沙箱环节，src/sandbox.ts）：临时目录拷贝资产最小集 → 应用
      变更（--file=候选资产整文件替换）→ 跑 --command 冻结验收命令（超时杀进程组）→
      updateVerification 落证据 → proposed 迁移 sandboxed。生产零触碰（结构性保证）；
      判定 PASS/FAIL 均非命令错误（exit 0——红是档案面）；--command 缺省=fail 如实落账；
      --timeout 缺省 60000；--root 缺省当前目录；库不存在即拒（候选必须在库，不代建库）
  studio-next cutover --db <库路径> --candidate <id> --file <新文件> --company <公司slug>
                      [--no-restart] [--no-gray] [--root <资产根目录>] [--actor <actor>]
                      [--dept <部门path>] [--level <1-9>]
      进化链切权执行器（20-§九切权环节，进化链四刀之三，src/cutover.ts）：approved/promoted
      候选受控上产——双闸（状态∈{approved,promoted} + 判负闸 authorize 写前复跑）→ 备份
      <目标>.bak-<候选id>（回滚锚点保留）→ tmp+rename 原子写 → 读回复核 → approved 迁移
      promoted → SCHEMA_EVOLVE 事件落账（note=候选+资产+旧新 hash）；失败面先回滚再报
      （不留半改态）。切权成功默认开灰度观察窗（kv gray:<候选id>；--no-gray 跳过）。
      --no-restart 抑制重启提示（v0 恒不实际重启——supervisor 看护归运维刀）；
      --root 缺省当前目录；库必须已存在（写面不代建库）
  studio-next gray --db <库路径> --candidate <id> [--check | --close] [--root <资产根目录>]
      灰度观察窗三动作（20-§四灰度零事故；进化链四刀之四收官，src/gray.ts）：缺省=查窗
      （窗状态/阈值/备份锚点，只读）；--check=手动检查（窗内 ESCALATE/CIRCUIT_BREAK 事故
      信号计数 ≥ 阈值 → 自动回滚——备份逐字节恢复+复核+promoted→retired+SCHEMA_EVOLVE 事件
      note=gray-rollback；窗到期无事故 → 关窗=灰度完成可请求制作人过目；守夜中 → 无动作）；
      --close=手动关窗（幂等；关窗不回滚——回滚只由事故阈值触发）。回滚是合法判定结果
      非命令错误（exit 0）；无窗候选/用法错 exit 1；备份锚点按 cutover 定名从 --root（缺省
      当前目录）派生；库必须已存在（写面不代建库）。观察窗驱动接 daemon tick 归真单刀——
      本面为 check+CLI
  studio-next postmortem --db <库路径> --company <slug> --issue <复盘单号> --input <复盘.json>
                         [--casebook <案例库目录>] [--slug <条目slug>] [--date <YYYY-MM-DD>]
                         [--dept <部门path>] [--level <1-9>] [--actor <actor>]
      复盘归档链（20-§十一复盘→案例库，src/postmortem.ts）：断路器关联（该单 CIRCUIT_BREAK/
      ESCALATE 台账历史自动进时间线）→ 渲染复盘模板（七节；无「责任人」字段——复盘不追责
      的机制化）→ 写案例库条目（<casebook>/<date>-<slug>.md，缺省案例库=当前目录 docs/casebook；
      条目=现象/根因/解法/预防 + 完整复盘附录）→ 落 POSTMORTEM 事件（note=条目约定路径、
      size、payload_hash）。--input JSON 七件套见 src/postmortem.ts PostmortemInput；
      --input 必给（复盘正文不可虚构）；库必须已存在（写面不代建库）
  studio-next panel --db <库路径> [--port 8787]
      :8787 只读监控面（v0.3，docs/16-§四）：jobs/runs/workers/事件流（SSE），
      全部读 SQLite 零写；库不存在即拒启；Ctrl-C 优雅关闭
  studio-next overview --company <目录> [--company <目录2> …] [--db <库路径>] [--port 8789]
      :8789 公司概览面（v0.7 读面，docs/04-§七）：挂载公司目录（可多家，校验不过拒绝挂载）
      → /<slug>/ 概览/组织/人事/进度/财务五读面（全 GET 只读、零前端依赖）；
      --db 可选（给出则进度/财务页读台账，必须已存在——只读不代建）；Ctrl-C 优雅关闭
  studio-next external --company <目录> [--company <目录2> …] [--db <库路径>] [--port 8788]
                      [--token <触发面令牌>] [--requests-per-minute N] [--lan]
      :8788 对外 API（v0.9 信息/触发骨架，docs/16-§四/17-§8/25-§4.2）：信息端点全 GET 全公开
      （/v1/company|org|people|projects|issues|finance|reports|agent-card）；触发端点
      POST /v1/requests（X-SN-Token 必带——只落单不派工、幂等键防重、IP 每分钟配额 429）；
      越权调用全部 fail-closed；--token 缺省=触发面全 401；--lan 才绑 0.0.0.0（缺省 127.0.0.1，
      D4 拟稿反转：局域网开放须显式旗标）；Ctrl-C 优雅关闭
  studio-next serve --config <daemon.yaml>
      常驻主循环（v0.5，docs/16-§四）：七相位引擎 + 心跳日志 + SIGINT/SIGTERM 优雅停。
      配置最小面（扁平 YAML 子集）：db / platform(fake|localfile) / company / rootDir / tickMs /
      maxActionsPerTick / maxInflight / stallAfterMs / laneTtlMs / breakerThreshold / autoApprove /
      companyDir / jobs / jobPollMs / models / budgetTicketCapUsd / budgetPersonCapUsd / reloadWatch；
      jobs: true 起定时岗调度器（v0.4：cron 到点→schedule 意图→主循环，结果落台账）；
      models: <models.yaml> 装载价目表→派发前预算闸估算校准（态 A；缺省态 B=适配器自报），
      预算预留-结算不落即不派（20-§六.8）；companyDir 给定时接 L1 配置热重载（指纹自动+
      reload 手动，reloadWatch 缺省开）；demo 模式=fake 全家桶零外部依赖
      （真 dsh/YouTrack/网关未接线，见 src/serve.ts 头注）
  studio-next reload [--company <slug>] [--root <工位根>] [--config <daemon.yaml>] [--timeout <ms>]
      L1 配置热重载手动触发（docs/38-§2 L1 / §4 R-A）：向运行中的 daemon 发重载请求（控制面
      文件通道 <rootDir>/control/reload.request.json）并轮询回执（缺省 15s）——daemon 在拍边界
      重走公司目录装载面（校验→快照→装配器/人员索引/调度岗/署名上下文替换），零进程重启、
      不中断在途单。--company 错家=回执拒绝 exit 1；未挂公司目录=回执 no-company-dir exit 1；
      内容未变=回执 unchanged（幂等，exit 0）。工位根发现序：--root > --config（缺省
      ./daemon.yaml）的 rootDir > 缺省 ./var。
  studio-next stop [--reason <事由>] [--root <工位根>] [--config <daemon.yaml>] [--timeout <ms>]
      控制面优雅停机（DEV-9 顺带项）：向运行中的 daemon 发停机请求（控制面文件通道
      <rootDir>/control/stop.request.json，协议与 reload 手动通道同款）并轮询回执——daemon
      在拍边界收到后走自身优雅停（停唤起源→在途 drain→worker 整树杀→台账落盘），回执
      落盘为证。运维不再 kill nohup sh -c 外层壳（kill 壳不杀 node 孙进程——孤儿问题
      从通道面根除）。超时无回执 exit 1（daemon 未运行/拍太慢/控制面目录不符）；工位根
      发现序与 reload 同款。

默认值：--dir 缺省 ./<slug>；--name 缺省 <slug>；--port 缺省 8787（panel）/ 8789（overview）/ 8788（external）
文档：docs/04-公司目录与等级体系.md §二/§七/§九；docs/16-技术实现与里程碑.md §四；docs/02-需求-框架面.md F2-11/F2-12；docs/17-整体技术设计.md §8`

interface Argv {
  positionals: string[]
  flags: Record<string, string>
  /** 布尔旗标（无值，出现即 true） */
  booleans: Set<string>
  /** 可重复旗标的全部取值（按出现序；不可重复旗标不进此面） */
  multi: Record<string, string[]>
}

/**
 * 零依赖 argv 解析：--key value 成对消费（booleanFlags 中的旗标无值，出现即真）；
 * 未知旗标 / 缺值即用法错误。repeatableFlags 中的旗标可多次出现（取值收集进 multi，
 * 后值不覆盖前值）。
 */
function parseArgv(argv: string[], valueFlags: ReadonlySet<string>, repeatableFlags?: ReadonlySet<string>, booleanFlags?: ReadonlySet<string>): Argv | { error: string } {
  const positionals: string[] = []
  const flags: Record<string, string> = {}
  const booleans = new Set<string>()
  const multi: Record<string, string[]> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      if (booleanFlags?.has(key)) {
        booleans.add(key)
        continue
      }
      if (!valueFlags.has(key)) return { error: `未知参数：${arg}` }
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) return { error: `${arg} 缺少取值` }
      flags[key] = value
      if (repeatableFlags?.has(key)) {
        ;(multi[key] ??= []).push(value)
      }
      i += 1
    } else {
      positionals.push(arg)
    }
  }
  return { positionals, flags, booleans, multi }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function cmdInit(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['name', 'dir', 'template']))
  if ('error' in parsed) {
    console.error(`init：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  const slug = parsed.positionals[0]
  if (slug === undefined) {
    console.error('init：缺少 <slug>（例：studio-next init demo-corp）')
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 1) {
    console.error(`init：多余的位置参数：${parsed.positionals.slice(1).join(' ')}`)
    console.error(USAGE)
    return 1
  }

  const options: InitOptions = { slug, targetDir: parsed.flags.dir ?? path.resolve(slug) }
  if (parsed.flags.name !== undefined) options.name = parsed.flags.name
  if (parsed.flags.template !== undefined) options.templateDir = parsed.flags.template

  try {
    const result = await initCompany(options)
    console.log(`已生成公司目录：${result.dir}`)
    console.log(`git 首次提交：${result.gitCommit}`)
    console.log(`目录自检：通过（slug=${slug}；结构契约 docs/04-§二）`)
    return 0
  } catch (err) {
    // initCompany 的失败即 ClassifiedError(CONFIG_INVALID)（宁失败不半成品，已撤除产物）
    console.error(`init 失败：${errText(err)}`)
    return 1
  }
}

async function cmdValidate(argv: string[]): Promise<number> {
  const dir = argv[0]
  if (argv.length !== 1 || dir === undefined) {
    console.error('validate：需要恰好一个参数（公司目录路径）')
    console.error(USAGE)
    return 1
  }
  let files: Record<string, string>
  try {
    files = await readDirectoryFiles(path.resolve(dir))
  } catch (err) {
    console.error(`validate：读取目录失败：${errText(err)}`)
    return 1
  }
  const mounted = loadCompanyDirectory(files)
  if (mounted.ok) {
    const s = mounted.snapshot
    console.log(`合法：${s.slug}（${s.level} 级公司 · ${s.departments.length} 部门 · ${s.people.length} 人 · 平台 ${s.platform.platform}）`)
    return 0
  }
  for (const issue of mounted.issues) {
    console.error(`${issue.file}:${issue.line} [${issue.rule}] ${issue.fix}`)
  }
  console.error(`校验不通过：${mounted.issues.length} 个问题（docs/04-§九：结构不合法拒绝挂载，修法见上）`)
  return 1
}

/** ledger 子命令组：薄壳转调 store（drill/dump/rebuild 全部语义在 @studio-next/store） */
async function cmdLedger(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  switch (sub) {
    case 'drill': {
      const dbPath = rest[0]
      if (rest.length !== 1 || dbPath === undefined) {
        console.error('ledger drill：需要恰好一个参数（演习库路径；必须不存在——防误删真实台账）')
        console.error(USAGE)
        return 1
      }
      try {
        const report = await runLedgerDrill(path.resolve(dbPath))
        for (const line of renderDrillReport(report)) console.log(line)
        return report.pass ? 0 : 1
      } catch (err) {
        // ClassifiedError(CONFIG_INVALID)（路径已存在等防呆）与重建失败，如实分类上报
        console.error(`ledger drill 失败：${errText(err)}`)
        return 1
      }
    }
    case 'dump': {
      const [dbPath, outPath] = rest
      if (rest.length !== 2 || dbPath === undefined || outPath === undefined) {
        console.error('ledger dump：需要恰好两个参数（库路径、输出.jsonl）')
        console.error(USAGE)
        return 1
      }
      try {
        const ledger = openLedger(path.resolve(dbPath))
        try {
          const { lines } = ledger.dumpEvents(outPath)
          console.log(`已导出 ${lines} 行 → ${outPath}`)
        } finally {
          ledger.close()
        }
        return 0
      } catch (err) {
        console.error(`ledger dump 失败：${errText(err)}`)
        return 1
      }
    }
    case 'rebuild': {
      const [source, target] = rest
      if (rest.length !== 2 || source === undefined || target === undefined) {
        console.error('ledger rebuild：需要恰好两个参数（源.jsonl、目标库路径）')
        console.error(USAGE)
        return 1
      }
      try {
        const result = rebuild(path.resolve(source), path.resolve(target))
        console.log(`已重建：events=${result.events} / schema v${result.version} → ${target}`)
        return 0
      } catch (err) {
        console.error(`ledger rebuild 失败：${errText(err)}`)
        return 1
      }
    }
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(USAGE)
      return 0
    default:
      console.error(`未知 ledger 子命令：${sub}`)
      console.error(USAGE)
      return 1
  }
}

/**
 * candidates 子命令组：进化管线现状只读面（薄壳——语义全在 @studio-next/store 读面，
 * candidatesByStatus 全状态集=全量；只列不改）。库不存在即拒：只读面不代建库（panel 同款
 * existsSync 闸——openLedger 会建库迁移，代建即副作用，违「只读」语义）。
 */
async function cmdCandidates(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  if (sub !== 'list') {
    if (sub !== undefined && sub !== '-h' && sub !== '--help' && sub !== 'help') {
      console.error(`未知 candidates 子命令：${sub}`)
    }
    console.error(USAGE)
    return sub === undefined || sub === '-h' || sub === '--help' || sub === 'help' ? 0 : 1
  }
  const parsed = parseArgv(rest, new Set(['db']))
  if ('error' in parsed) {
    console.error(`candidates list：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`candidates list：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const dbPath = parsed.flags.db
  if (dbPath === undefined) {
    console.error('candidates list：缺少 --db <库路径>')
    console.error(USAGE)
    return 1
  }
  const resolved = path.resolve(dbPath)
  if (!existsSync(resolved)) {
    console.error(`candidates list：库不存在：${resolved}（只读面不代建库——先由 daemon/回填侧建库）`)
    return 1
  }
  try {
    const ledger = openLedger(resolved)
    try {
      const rows = ledger.candidatesByStatus([...CANDIDATE_STATUS_VALUES])
      const byStatus = new Map<string, number>()
      for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1)
      const dist = [...byStatus.entries()].map(([s, n]) => `${s}=${n}`).join(' ')
      console.log(`候选 ${rows.length} 条${dist === '' ? '（库空）' : `（${dist}）`}——库 ${resolved}（schema v${ledger.version()}，只读）`)
      for (const r of rows) {
        const hash = r.diff_hash.length > 17 ? `${r.diff_hash.slice(0, 17)}…` : r.diff_hash
        console.log(
          `${r.id}  ${r.status.padEnd(9)}  ${r.asset_type.padEnd(10)}  ${r.blast_radius.padEnd(10)}  ${r.version.padEnd(12)}  parent=${r.parent_id ?? '—（初代）'}  ${r.asset_path}  ${hash}`,
        )
      }
      return 0
    } finally {
      ledger.close()
    }
  } catch (err) {
    // 坏库/坏行（CONFIG_INVALID 形状）如实分类上报
    console.error(`candidates list 失败：${errText(err)}`)
    return 1
  }
}

/**
 * sandbox 子命令：进化链沙箱执行薄壳（语义全在 src/sandbox.ts——runner+CLI 链）。
 * 退出码语义（拟稿，sandbox.ts 头注）：链走完（证据落账+迁移完成）即 0——判定红是档案面
 * 非命令错误；用法/库/候选/状态面错误 1。库必须已存在：候选必须在库，写面不代建库
 * （candidates list 同款 existsSync 闸）。
 */
async function cmdSandbox(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['db', 'candidate', 'command', 'file', 'timeout', 'root']))
  if ('error' in parsed) {
    console.error(`sandbox：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`sandbox：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const dbPath = parsed.flags.db
  if (dbPath === undefined) {
    console.error('sandbox：缺少 --db <库路径>')
    console.error(USAGE)
    return 1
  }
  const candidateId = parsed.flags.candidate
  if (candidateId === undefined) {
    console.error('sandbox：缺少 --candidate <候选 id>')
    console.error(USAGE)
    return 1
  }
  let timeoutMs: number | undefined
  if (parsed.flags.timeout !== undefined) {
    timeoutMs = Number.parseInt(parsed.flags.timeout, 10)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      console.error(`sandbox：--timeout 取值非法：${parsed.flags.timeout}（须为正整数毫秒）`)
      return 1
    }
  }
  const resolvedDb = path.resolve(dbPath)
  if (!existsSync(resolvedDb)) {
    console.error(`sandbox：库不存在：${resolvedDb}（候选必须在库——写面不代建库，先由 daemon/提案面建库）`)
    return 1
  }
  try {
    const ledger = openLedger(resolvedDb)
    try {
      const row = ledger.getCandidate(candidateId)
      if (row === undefined) {
        console.error(`sandbox：候选 ${candidateId} 不在库（--candidate 回查失败）`)
        return 1
      }
      const result = await runCandidateSandbox(ledger, {
        candidateId,
        ...(parsed.flags.command !== undefined ? { testCommand: parsed.flags.command } : {}),
        ...(parsed.flags.file !== undefined ? { changeFile: parsed.flags.file } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        assetRoot: parsed.flags.root ?? '.',
      })
      for (const line of renderSandboxLines(result, row)) console.log(line)
      console.log(`候选 ${candidateId} 沙箱完成：${result.report.pass ? 'PASS' : 'FAIL'}（证据已落台账，状态 ${ledger.getCandidate(candidateId)?.status ?? '?'}）`)
      return 0
    } finally {
      ledger.close()
    }
  } catch (err) {
    // 链面失败如实分类上报（CONFIG_INVALID/EVOLVE_REJECT——sandbox.ts 头注分类面）
    console.error(`sandbox 失败：${errText(err)}`)
    return 1
  }
}

/**
 * cutover 子命令：进化链切权薄壳（语义全在 src/cutover.ts——受控上产执行器）。
 * --file 必给（新内容全文——判负闸消费其 sha256）；--company 必给（events.company 台账
 * 路由键，postmortem 同款不猜）。库必须已存在：事件要落账+状态要迁移，写面不代建库
 * （sandbox 同款 existsSync 闸）。--no-restart 抑制重启提示（v0 恒不实际重启——诚实边界）。
 */
async function cmdCutover(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['db', 'candidate', 'file', 'company', 'root', 'actor', 'dept', 'level']), undefined, new Set(['no-restart', 'no-gray']))
  if ('error' in parsed) {
    console.error(`cutover：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`cutover：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const dbPath = parsed.flags.db
  if (dbPath === undefined) {
    console.error('cutover：缺少 --db <库路径>')
    console.error(USAGE)
    return 1
  }
  const candidateId = parsed.flags.candidate
  if (candidateId === undefined) {
    console.error('cutover：缺少 --candidate <候选 id>')
    console.error(USAGE)
    return 1
  }
  const filePath = parsed.flags.file
  if (filePath === undefined) {
    console.error('cutover：缺少 --file <新文件>（新内容全文——判负闸消费其 sha256，缺即用法错误）')
    console.error(USAGE)
    return 1
  }
  const company = parsed.flags.company
  if (company === undefined) {
    console.error('cutover：缺少 --company <公司 slug>（events.company 台账路由键，不猜）')
    console.error(USAGE)
    return 1
  }
  let level: number | undefined
  if (parsed.flags.level !== undefined) {
    level = Number.parseInt(parsed.flags.level, 10)
    if (!Number.isInteger(level) || level < 1 || level > 9) {
      console.error(`cutover：--level 取值非法：${parsed.flags.level}（须为 1-9 整数——04-§四等级口径）`)
      return 1
    }
  }
  const resolvedDb = path.resolve(dbPath)
  if (!existsSync(resolvedDb)) {
    console.error(`cutover：库不存在：${resolvedDb}（切权要落账+迁移——写面不代建库，先由 daemon/提案面建库）`)
    return 1
  }
  try {
    const ledger = openLedger(resolvedDb)
    try {
      const result = runCutover(ledger, candidateId, {
        newFilePath: filePath,
        assetRoot: parsed.flags.root ?? '.',
        company,
        restart: !parsed.booleans.has('no-restart'),
        gray: !parsed.booleans.has('no-gray'),
        ...(parsed.flags.actor !== undefined ? { actor: parsed.flags.actor } : {}),
        ...(parsed.flags.dept !== undefined ? { dept: parsed.flags.dept } : {}),
        ...(level !== undefined ? { level } : {}),
      })
      const row = ledger.getCandidate(candidateId)
      if (row !== undefined) {
        for (const line of renderCutoverLines(result, row)) console.log(line)
      }
      console.log(`候选 ${candidateId} 切权完成：${result.targetPath}（hash → ${result.newHash}，状态 ${row?.status ?? '?'}）`)
      return 0
    } finally {
      ledger.close()
    }
  } catch (err) {
    // 链面失败如实分类上报（CONFIG_INVALID——cutover.ts 头注失败面枚举；失败已回滚不留半改态）
    console.error(`cutover 失败：${errText(err)}`)
    return 1
  }
}

/**
 * gray 子命令：灰度观察窗薄壳（语义全在 src/gray.ts——进化链四刀之四收官）。
 * 三动作（互斥）：缺省=查窗（只读 kv 状态面）｜--check=手动检查（判定三态：阈值破窗→
 * 自动回滚字节级恢复+promoted→retired+note=gray-rollback 事件；到期无事故→关窗；守夜中
 * →无动作）｜--close=手动关窗（幂等；关窗不回滚——回滚只由事故阈值触发，面分离）。
 * 回滚是合法判定结果非命令错误（sandbox 判定面同款口径）→ exit 0；无窗候选/用法错/库
 * 面错 exit 1。备份锚点由 cutover 定名约定派生：--root（缺省 '.'）+ 窗内 assetPath +
 * `.bak-<候选id>`。库必须已存在（check/close 是写面——kv/事件/生产文件，不代建库）。
 */
async function cmdGray(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['db', 'candidate', 'root']), undefined, new Set(['check', 'close']))
  if ('error' in parsed) {
    console.error(`gray：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`gray：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.booleans.has('check') && parsed.booleans.has('close')) {
    console.error('gray：--check 与 --close 互斥（检查=判定+自动处置；关窗=平安提前收口——三动作一次一个）')
    console.error(USAGE)
    return 1
  }
  const dbPath = parsed.flags.db
  if (dbPath === undefined) {
    console.error('gray：缺少 --db <库路径>')
    console.error(USAGE)
    return 1
  }
  const candidateId = parsed.flags.candidate
  if (candidateId === undefined) {
    console.error('gray：缺少 --candidate <候选 id>')
    console.error(USAGE)
    return 1
  }
  const resolvedDb = path.resolve(dbPath)
  if (!existsSync(resolvedDb)) {
    console.error(`gray：库不存在：${resolvedDb}（观察窗检查是写面（kv/事件/生产文件）——不代建库，先由 daemon/切权面建库）`)
    return 1
  }
  const assetRoot = parsed.flags.root ?? '.'
  try {
    const ledger = openLedger(resolvedDb)
    try {
      // 备份锚点派生（cutover ⑥ 定名约定：--root + assetPath + .bak-<候选id>——回滚物理基础）
      const deriveBackup = (assetPath: string): string => path.resolve(assetRoot, `${assetPath}.bak-${candidateId}`)

      if (parsed.booleans.has('check')) {
        const state = readGrayWindow(ledger, candidateId)
        if (state === null) {
          console.error(`gray：候选 ${candidateId} 无灰度观察窗（kv gray:${candidateId} 缺——无窗候选不检查；窗由 cutover 默认后缀开）`)
          return 1
        }
        const result = checkGrayWindow(ledger, deriveBackup(state.assetPath))
        for (const line of renderGrayCheckLines(result)) console.log(line)
        console.log(
          `候选 ${candidateId} 灰度检查完成：${result.rolled ? '已自动回滚（零事故破窗）' : result.done ? '窗已收口（平安）' : '守夜中（无动作）'}` +
            `｜信号 ${String(result.incidents)} 条｜窗状态 ${readGrayWindow(ledger, candidateId)?.status ?? '?'}`,
        )
        return 0
      }

      if (parsed.booleans.has('close')) {
        const { state, changed } = closeGrayWindow(ledger, candidateId)
        for (const line of renderGrayStatusLines(state, deriveBackup(state.assetPath), Date.now())) console.log(line)
        console.log(
          changed
            ? `候选 ${candidateId} 灰度观察窗已手动关窗（kv gray:${candidateId} → closed——窗平安提前收口=可请求制作人过目）`
            : `候选 ${candidateId} 灰度观察窗已是 ${state.status}（幂等无动作）`,
        )
        return 0
      }

      // 缺省动作：查窗（只读）
      const state = readGrayWindow(ledger, candidateId)
      if (state === null) {
        console.error(`gray：候选 ${candidateId} 无灰度观察窗（kv gray:${candidateId} 缺——窗由 cutover 默认后缀开，--no-gray 跳过的切权无窗）`)
        return 1
      }
      for (const line of renderGrayStatusLines(state, deriveBackup(state.assetPath), Date.now())) console.log(line)
      return 0
    } finally {
      ledger.close()
    }
  } catch (err) {
    // 链面失败如实分类上报（CONFIG_INVALID——gray.ts 头注失败面枚举；回滚失败窗保持 open）
    console.error(`gray 失败：${errText(err)}`)
    return 1
  }
}

/**
 * postmortem 子命令：复盘归档薄壳（语义全在 src/postmortem.ts——渲染器+CLI 链）。
 * --input 必给（拟稿，postmortem.ts 头注：复盘正文不可虚构——缺即用法错误，不给空模板
 * 充数的旁路）；--issue 与 JSON 内 issue 双给时须一致（双源分歧如实拒）。库必须已存在：
 * 事件要落账，写面不代建库（sandbox 同款 existsSync 闸）。
 */
async function cmdPostmortem(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['db', 'company', 'issue', 'input', 'casebook', 'slug', 'date', 'dept', 'level', 'actor']))
  if ('error' in parsed) {
    console.error(`postmortem：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`postmortem：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const dbPath = parsed.flags.db
  if (dbPath === undefined) {
    console.error('postmortem：缺少 --db <库路径>')
    console.error(USAGE)
    return 1
  }
  const company = parsed.flags.company
  if (company === undefined) {
    console.error('postmortem：缺少 --company <公司 slug>（events.company 台账路由键，不猜）')
    console.error(USAGE)
    return 1
  }
  const inputPath = parsed.flags.input
  if (inputPath === undefined) {
    console.error('postmortem：缺少 --input <复盘.json>（复盘正文不可虚构——七件套形状见 src/postmortem.ts PostmortemInput；fail-closed 拒空模板旁路）')
    console.error(USAGE)
    return 1
  }
  let raw: string
  try {
    raw = readFileSync(path.resolve(inputPath), 'utf8')
  } catch (err) {
    console.error(`postmortem：--input 文件不可读 ${inputPath}：${errText(err)}`)
    return 1
  }
  let parsedInput: ReturnType<typeof parsePostmortemInput>
  try {
    parsedInput = parsePostmortemInput(JSON.parse(raw) as unknown)
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.error(`postmortem：--input 不是合法 JSON：${inputPath}（${err.message}）`)
    } else {
      console.error(`postmortem：复盘输入形状不合法（fail-fast，逐字段修法）：${errText(err)}`)
    }
    return 1
  }
  const issue = parsed.flags.issue ?? parsedInput.issue
  if (parsed.flags.issue !== undefined && parsed.flags.issue !== parsedInput.issue) {
    console.error(`postmortem：--issue ${parsed.flags.issue} 与 JSON 内 issue ${parsedInput.issue} 不一致（双源分歧如实拒）`)
    return 1
  }
  let level: number | undefined
  if (parsed.flags.level !== undefined) {
    level = Number.parseInt(parsed.flags.level, 10)
    if (!Number.isInteger(level) || level < 1 || level > 9) {
      console.error(`postmortem：--level 取值非法：${parsed.flags.level}（须为 1-9 整数——04-§四等级口径）`)
      return 1
    }
  }
  const resolvedDb = path.resolve(dbPath)
  if (!existsSync(resolvedDb)) {
    console.error(`postmortem：库不存在：${resolvedDb}（POSTMORTEM 事件要落账——写面不代建库，先由 daemon/回填侧建库）`)
    return 1
  }
  try {
    const ledger = openLedger(resolvedDb)
    try {
      const result = runPostmortemChain(ledger, {
        input: parsedInput,
        casebookRoot: parsed.flags.casebook ?? path.join(process.cwd(), 'docs/casebook'),
        ...(parsed.flags.slug !== undefined ? { slug: parsed.flags.slug } : {}),
        ...(parsed.flags.date !== undefined ? { date: parsed.flags.date } : {}),
        company,
        ...(parsed.flags.dept !== undefined ? { dept: parsed.flags.dept } : {}),
        ...(level !== undefined ? { level } : {}),
        ...(parsed.flags.actor !== undefined ? { actor: parsed.flags.actor } : {}),
      })
      for (const line of renderPostmortemLines(result)) console.log(line)
      console.log(`复盘单 ${issue} 归档完成：事件 ${result.event.id} → 案例条目 ${result.relPath}`)
      return 0
    } finally {
      ledger.close()
    }
  } catch (err) {
    // 链面失败如实分类上报（CONFIG_INVALID——postmortem.ts 头注分类面）
    console.error(`postmortem 失败：${errText(err)}`)
    return 1
  }
}

/** panel 子命令：薄壳转 servePanel（语义全在 @studio-next/panel；默认只绑本机） */
async function cmdPanel(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['db', 'port']))
  if ('error' in parsed) {
    console.error(`panel：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`panel：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const dbPath = parsed.flags.db
  if (dbPath === undefined) {
    console.error('panel：缺少 --db <库路径>')
    console.error(USAGE)
    return 1
  }
  let port = 8787
  if (parsed.flags.port !== undefined) {
    port = Number.parseInt(parsed.flags.port, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`panel：--port 取值非法：${parsed.flags.port}（须为 1-65535 整数）`)
      return 1
    }
  }
  let handle
  try {
    handle = await servePanel(port, path.resolve(dbPath))
  } catch (err) {
    // 库不存在 / 端口占用等：CONFIG_INVALID 形状，如实分类上报
    console.error(`panel 启动失败：${errText(err)}`)
    return 1
  }
  console.log(`[panel] :8787 监控面已监听 → http://${handle.hostname}:${String(handle.port)}/（只读，Ctrl-C 退出）`)
  console.log(`[panel] 台账：${path.resolve(dbPath)}（零写；端面 /api/health|jobs|runs|workers|events|events/stream|snapshot）`)
  await new Promise<void>((resolve) => {
    const stop = (): void => resolve()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  await handle.close()
  console.log('[panel] 已优雅关闭')
  return 0
}

/** 人事档案文件发现（与 company/multifile isPersonFile 同规则：departments 任意深度下的 people/<工号>.md） */
const PERSON_FILE_RE = /(?:^|\/)departments\/[^/]+\/people\/([^/]+)\.md$/

/**
 * org-config.yaml 单行 mission 提取（**拟稿**：契约 CompanySnapshot 无 mission 字段，本 CLI
 * 以单行 `mission: <标量>` 近似提取——见 panel/overview/server.ts 头注拟稿；块标量形态漏读
 * → undefined → 页面如实显示「未提供」）。引号壳先剥；裸标量剥「 #」行内注释。
 */
function extractMission(orgConfigSrc: string | undefined): string | undefined {
  if (orgConfigSrc === undefined) return undefined
  const m = /^[ \t]*mission:[ \t]*(\S.*)$/m.exec(orgConfigSrc)
  const raw = m?.[1]?.trim()
  if (raw === undefined || raw === '') return undefined
  let value = raw
  if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2) || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
    value = value.slice(1, -1)
  } else {
    const hash = value.indexOf(' #')
    if (hash >= 0) value = value.slice(0, hash)
  }
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * overview 子命令：:8789 公司概览面薄壳（语义全在 @studio-next/panel/overview）。
 * 挂载语义：逐目录 readDirectoryFiles → loadCompanyDirectory（校验不过拒绝挂载——04-§九）；
 * 快照挂载时装载并缓存（目录变更=重新挂载；热更归 daemon 后续刀）；档案正文按文件名=工号
 * 建映射（校验器保证文件名与 front-matter id 一致）。默认只绑本机。
 */
async function cmdOverview(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['company', 'db', 'port']), new Set(['company']))
  if ('error' in parsed) {
    console.error(`overview：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`overview：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const companyDirs = parsed.multi.company ?? []
  if (companyDirs.length === 0) {
    console.error('overview：至少给一个 --company <公司目录>（可重复给多家）')
    console.error(USAGE)
    return 1
  }
  let port = 8789
  if (parsed.flags.port !== undefined) {
    port = Number.parseInt(parsed.flags.port, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`overview：--port 取值非法：${parsed.flags.port}（须为 1-65535 整数）`)
      return 1
    }
  }

  const companies: OverviewCompanySource[] = []
  for (const dir of companyDirs) {
    const resolved = path.resolve(dir)
    let files: Record<string, string>
    try {
      files = await readDirectoryFiles(resolved)
    } catch (err) {
      console.error(`overview：读取公司目录失败 ${resolved}：${errText(err)}`)
      return 1
    }
    const mounted = loadCompanyDirectory(files)
    if (!mounted.ok) {
      console.error(`overview：公司目录校验不通过（拒绝挂载，docs/04-§九）：${resolved}`)
      for (const issue of mounted.issues) console.error(`  ${issue.file}:${issue.line} [${issue.rule}] ${issue.fix}`)
      return 1
    }
    const snapshot = mounted.snapshot
    const personFiles = new Map<string, string>()
    for (const [p, content] of Object.entries(files)) {
      const m = PERSON_FILE_RE.exec(p)
      if (m !== null && m[1] !== undefined) personFiles.set(m[1], content)
    }
    const mission = extractMission(files['org-config.yaml'])
    companies.push({
      slug: snapshot.slug,
      snapshotProvider: () => snapshot,
      ...(mission !== undefined ? { mission } : {}),
      readPersonFile: (personId) => personFiles.get(personId),
    })
  }

  let handle
  try {
    handle = await serveOverview(port, companies, parsed.flags.db !== undefined ? { ledgerPath: path.resolve(parsed.flags.db) } : undefined)
  } catch (err) {
    // 重复 slug / 库不存在 / 端口占用等：CONFIG_INVALID 形状，如实分类上报
    console.error(`overview 启动失败：${errText(err)}`)
    return 1
  }
  console.log(`[overview] :8789 公司概览面已监听 → http://${handle.hostname}:${String(handle.port)}/（只读，Ctrl-C 退出）`)
  console.log(`[overview] 已挂载：${companies.map((c) => c.slug).join('、')}${parsed.flags.db !== undefined ? `；台账：${path.resolve(parsed.flags.db)}（零写）` : '；无台账（progress/finance 页如实显示无台账数据）'}`)
  console.log('[overview] 端面：/ 公司清单｜/<slug>/ 概览｜/<slug>/org 组织｜/<slug>/people 人事｜/<slug>/people/<工号> 档案｜/<slug>/progress 进度｜/<slug>/finance 财务')
  await new Promise<void>((resolve) => {
    const stop = (): void => resolve()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  await handle.close()
  console.log('[overview] 已优雅关闭')
  return 0
}

/**
 * external 子命令：:8788 对外 API 薄壳（语义全在 @studio-next/panel/external）。
 * 挂载语义与 overview 同款（逐目录 readDirectoryFiles → loadCompanyDirectory，校验不过
 * 拒绝挂载）；报表清单从目录文件集派生（reports/ 前缀——v0 只出清单不出正文）。
 * 触发面平台（拟稿）：fake 平台过真网关闸（createGatedPlatform——17-§7 写收口在 daemon
 * 侧装配，panel 包不碰 gateway）；DEV_GATEWAY_SECRET 开发密钥+警告，与 serve demo 同款，
 * 真平台接线与生产密钥归 daemon 装配后续刀。绑定面：缺省 127.0.0.1，--lan 显式绑 0.0.0.0
 * （D4 拟稿反转：D4「默认局域网」是部署意图，安全缺省只绑本机）。
 */
async function cmdExternal(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['company', 'db', 'port', 'token', 'requests-per-minute']), new Set(['company']), new Set(['lan']))
  if ('error' in parsed) {
    console.error(`external：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`external：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const companyDirs = parsed.multi.company ?? []
  if (companyDirs.length === 0) {
    console.error('external：至少给一个 --company <公司目录>（可重复给多家）')
    console.error(USAGE)
    return 1
  }
  let port = 8788
  if (parsed.flags.port !== undefined) {
    port = Number.parseInt(parsed.flags.port, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`external：--port 取值非法：${parsed.flags.port}（须为 1-65535 整数）`)
      return 1
    }
  }
  let requestsPerMinute: number | undefined
  if (parsed.flags['requests-per-minute'] !== undefined) {
    requestsPerMinute = Number.parseInt(parsed.flags['requests-per-minute'], 10)
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1) {
      console.error(`external：--requests-per-minute 取值非法：${parsed.flags['requests-per-minute']}（须为正整数）`)
      return 1
    }
  }

  const companies: ExternalCompanySource[] = []
  let firstSnapshot: CompanySnapshot | undefined
  for (const dir of companyDirs) {
    const resolved = path.resolve(dir)
    let files: Record<string, string>
    try {
      files = await readDirectoryFiles(resolved)
    } catch (err) {
      console.error(`external：读取公司目录失败 ${resolved}：${errText(err)}`)
      return 1
    }
    const mounted = loadCompanyDirectory(files)
    if (!mounted.ok) {
      console.error(`external：公司目录校验不通过（拒绝挂载，docs/04-§九）：${resolved}`)
      for (const issue of mounted.issues) console.error(`  ${issue.file}:${issue.line} [${issue.rule}] ${issue.fix}`)
      return 1
    }
    const snapshot = mounted.snapshot
    if (firstSnapshot === undefined) firstSnapshot = snapshot
    companies.push({
      slug: snapshot.slug,
      snapshotProvider: () => snapshot,
      listReports: () =>
        Object.entries(files)
          .filter(([p]) => p.startsWith('reports/'))
          .map(([file, content]) => ({ file: file.slice('reports/'.length), bytes: content.length }))
          .filter((r) => !r.file.startsWith('.') && r.file !== ''), // 点文件（.gitkeep 占位）与目录本身不出清单
    })
  }

  // 触发面平台装配（拟稿）：fake 平台 + 真网关闸（issues.create 过 comment 动作词收口）。
  // 身份取首家快照（控制面无人员档案——与 serve daemonIdentity 同拟稿）；开发密钥+警告。
  const snapshotForIdentity = firstSnapshot as CompanySnapshot
  const ctx: SignatureContext = {
    company: snapshotForIdentity.name,
    dept: snapshotForIdentity.departments[0]?.path ?? 'departments/未挂部门',
    role: 'daemon',
    level: Math.max(1, snapshotForIdentity.level),
  }
  const author = ENGINE_CONFIG_DEFAULTS.actor
  const gateway = createGateway({
    secret: new TextEncoder().encode(DEV_GATEWAY_SECRET),
    clock: () => Date.now(),
    ticket: CONTROL_TICKET,
    ctx,
    author,
  })
  const platform = createGatedPlatform(createFakePlatform(), gateway, { ctx, author })
  console.warn('[external] 警告：触发面平台为 fake demo 骨架，网关密钥用开发缺省值（生产装配必配强密钥——17-§7；真平台接线归 daemon 后续刀）')

  const token = parsed.flags.token
  if (token === undefined && parsed.flags.db !== undefined) {
    console.warn('[external] 警告：给了 --db 但未给 --token——触发面全 401（fail-closed），只读信息面可用')
  }

  let handle
  try {
    handle = await serveExternal(port, companies, {
      ...(parsed.flags.db !== undefined ? { ledgerPath: path.resolve(parsed.flags.db) } : {}),
      ...(token !== undefined ? { token } : {}),
      platform,
      ...(requestsPerMinute !== undefined ? { requestsPerMinute } : {}),
      ...(parsed.booleans.has('lan') ? { hostname: '0.0.0.0' } : {}),
    })
  } catch (err) {
    // 重复 slug / 库不存在 / 端口占用等：CONFIG_INVALID 形状，如实分类上报
    console.error(`external 启动失败：${errText(err)}`)
    return 1
  }
  console.log(
    `[external] :8788 对外 API 已监听 → http://${handle.hostname}:${String(handle.port)}/v1/agent-card` +
      `${parsed.booleans.has('lan') ? '' : '（默认只绑本机——对局域网开放须 --lan，D4 拟稿反转）'}`,
  )
  console.log(
    `[external] 已挂载：${companies.map((c) => c.slug).join('、')}；` +
      (parsed.flags.db !== undefined ? `台账：${path.resolve(parsed.flags.db)}（触发面 kv 幂等写；信息面零写）` : '无台账（issues/finance 如实降级；触发面 501）') +
      (token !== undefined ? '' : '；触发面未配令牌（POST /v1/requests 全 401——fail-closed）'),
  )
  console.log('[external] 端面：/v1/agent-card｜/v1/company｜/v1/org｜/v1/people｜/v1/projects｜/v1/issues｜/v1/finance｜/v1/reports｜POST /v1/requests（token）｜/v1/events（501 占位）')
  await new Promise<void>((resolve) => {
    const stop = (): void => resolve()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  await handle.close()
  console.log('[external] 已优雅关闭')
  return 0
}

/**
 * reload 子命令：L1 配置热重载手动触发薄壳（执行体全在 daemon 侧 src/hot-reload.ts——
 * 本命令只写控制面请求 + 轮询回执）。工位根发现序：--root > --config（缺省 ./daemon.yaml，
 * 读其 rootDir）> 缺省 ./var。退出码：0=重载成功或幂等 unchanged；1=回执失败
 * （company-mismatch/no-company-dir/config-invalid/apply-failed）或超时（daemon 不在跑/
 * 拍太慢——--timeout 可调，缺省 15000ms）。
 */
async function cmdReload(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['company', 'root', 'config', 'timeout']))
  if ('error' in parsed) {
    console.error(`reload：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`reload：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  let timeoutMs = 15_000
  if (parsed.flags.timeout !== undefined) {
    timeoutMs = Number.parseInt(parsed.flags.timeout, 10)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100) {
      console.error(`reload：--timeout 取值非法：${parsed.flags.timeout}（须为 >=100 的整数毫秒）`)
      return 1
    }
  }

  // 工位根发现序：--root > --config 的 rootDir > ./var（daemon 控制面落点 <rootDir>/control/）
  let rootDir: string
  if (parsed.flags.root !== undefined) {
    rootDir = path.resolve(parsed.flags.root)
  } else {
    const configPath = parsed.flags.config ?? './daemon.yaml'
    if (existsSync(path.resolve(configPath))) {
      try {
        rootDir = path.resolve(parseDaemonConfig(readFileSync(path.resolve(configPath), 'utf8')).rootDir)
      } catch (err) {
        console.error(`reload：daemon.yaml 解析失败（${configPath}）：${errText(err)}`)
        return 1
      }
    } else if (parsed.flags.config !== undefined) {
      console.error(`reload：--config 指定的 daemon.yaml 不存在：${configPath}`)
      return 1
    } else {
      rootDir = path.resolve('./var')
    }
  }

  const id = makeUlid(Date.now())
  const request = { id, company: parsed.flags.company ?? null, requestedAt: Date.now() }
  writeReloadRequest(rootDir, request)
  console.log(`[reload] 请求已写：${path.join(rootDir, 'control', 'reload.request.json')}（id=${id}${request.company !== null ? `，company=${request.company}` : ''}）——等 daemon 拍边界处理（超时 ${timeoutMs}ms）`)

  const result = await awaitReloadResult(rootDir, id, timeoutMs)
  if (result === undefined) {
    console.error(`reload：超时无回执（${timeoutMs}ms）——daemon 未运行 / tickMs 过大 / 控制面目录不符（rootDir=${rootDir}；可用 --root/--config 指定）`)
    return 1
  }
  if (result.ok) {
    console.log(`[reload] 回执 ok（id=${result.id}）：${result.applied ? '已重装载' : `无动作（${result.reason ?? 'unchanged'}）`}${result.detail !== undefined ? `——${result.detail}` : ''}`)
    return 0
  }
  console.error(`[reload] 回执失败（id=${result.id}，reason=${result.reason ?? '?'}）：${result.detail ?? ''}`)
  return 1
}

/**
 * stop 子命令：控制面优雅停机薄壳（DEV-9 顺带项——孤儿进程问题的通道面；执行体全在
 * daemon 侧 src/serve.ts runServe + src/stop-channel.ts）。动机：`nohup sh -c "…"` 双层
 * 壳下 kill 外层 sh 不杀 node 孙进程——停机改走 daemon 自身优雅停（在途 worker 整树
 * 杀+台账落盘），回执为证。工位根发现序与 reload 同款：--root > --config（缺省
 * ./daemon.yaml，读其 rootDir）> 缺省 ./var。退出码：0=优雅停完成（回执 stopped=true）；
 * 1=超时无回执（daemon 未运行/拍太慢/控制面目录不符）或回执失败面。
 */
async function cmdStop(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['reason', 'root', 'config', 'timeout']))
  if ('error' in parsed) {
    console.error(`stop：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`stop：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  let timeoutMs = 15_000
  if (parsed.flags.timeout !== undefined) {
    timeoutMs = Number.parseInt(parsed.flags.timeout, 10)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100) {
      console.error(`stop：--timeout 取值非法：${parsed.flags.timeout}（须为 >=100 的整数毫秒）`)
      return 1
    }
  }

  // 工位根发现序：--root > --config 的 rootDir > ./var（daemon 控制面落点 <rootDir>/control/）
  let rootDir: string
  if (parsed.flags.root !== undefined) {
    rootDir = path.resolve(parsed.flags.root)
  } else {
    const configPath = parsed.flags.config ?? './daemon.yaml'
    if (existsSync(path.resolve(configPath))) {
      try {
        rootDir = path.resolve(parseDaemonConfig(readFileSync(path.resolve(configPath), 'utf8')).rootDir)
      } catch (err) {
        console.error(`stop：daemon.yaml 解析失败（${configPath}）：${errText(err)}`)
        return 1
      }
    } else if (parsed.flags.config !== undefined) {
      console.error(`stop：--config 指定的 daemon.yaml 不存在：${configPath}`)
      return 1
    } else {
      rootDir = path.resolve('./var')
    }
  }

  const id = makeUlid(Date.now())
  const request: StopRequest = {
    id,
    requestedAt: Date.now(),
    ...(parsed.flags.reason !== undefined ? { reason: parsed.flags.reason } : {}),
  }
  writeStopRequest(rootDir, request)
  console.log(`[stop] 请求已写：${path.join(rootDir, 'control', 'stop.request.json')}（id=${id}${request.reason !== undefined ? `，reason=${request.reason}` : ''}）——等 daemon 拍边界优雅停（超时 ${timeoutMs}ms）`)

  const result = await awaitStopResult(rootDir, id, timeoutMs)
  if (result === undefined) {
    console.error(`stop：超时无回执（${timeoutMs}ms）——daemon 未运行 / tickMs 过大 / 控制面目录不符（rootDir=${rootDir}；可用 --root/--config 指定）`)
    return 1
  }
  if (result.ok && result.stopped) {
    console.log(`[stop] 回执 ok（id=${result.id}）：daemon 已优雅停——在途 worker 整树杀、台账已落盘${result.detail !== undefined ? `——${result.detail}` : ''}`)
    return 0
  }
  console.error(`[stop] 回执失败（id=${result.id}）：${result.detail ?? result.reason ?? '未知失败面'}`)
  return 1
}

/** serve 子命令：薄壳转 runServe（配置装载/循环/优雅停语义全在 src/serve.ts） */
async function cmdServe(argv: string[]): Promise<number> {  const parsed = parseArgv(argv, new Set(['config']))
  if ('error' in parsed) {
    console.error(`serve：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`serve：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const configPath = parsed.flags.config
  if (configPath === undefined) {
    console.error('serve：缺少 --config <daemon.yaml>')
    console.error(USAGE)
    return 1
  }
  try {
    const result = await runServe(configPath)
    if (result.stopReason === 'error') {
      console.error(`serve：运行中断（tick 异常）：${result.lastError ?? '未知'}`)
      return 2
    }
    console.log(`serve：已停机（共 ${result.ticks} 拍）`)
    return 0
  } catch (err) {
    // 配置/平台接线/公司目录装载失败：CONFIG_INVALID 形状，如实分类上报
    console.error(`serve 启动失败：${errText(err)}`)
    return 1
  }
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2)
  switch (command) {
    case 'init':
      return cmdInit(rest)
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
