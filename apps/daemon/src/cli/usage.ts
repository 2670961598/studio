// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L145-L264 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。

export const USAGE = `studio-next —— Studio Next 框架 CLI（v0.1）

用法：
  studio-next init <slug> [--name <公司名>] [--dir <目录>] [--template <模板目录>]
      从模板生成公司目录（默认模板 templates/company-2-level）：复制 → 占位替换 → 自检 → git 首提
  studio-next company add <git-url> [名] [--dir <目录>] [--work-root <根>]
                           [--plugin-root <目录>] [--platform-root <目录>]
                           [--aiws-root <目录>] [--by <动作人>]
      git 网址即公司（DEV-27；docs/43-§一，v1.1）：真实 git clone → 剥离活性 .git 重建
      本地仓 → schema 校验 → 初始化（localfile 字段 provision+信任锚 trust=false+.AIWS
      员工工作区树+依赖清单自动安装到隔离插件根——绝不写 ~/.dsh）。升级=同 url 再跑
      （镜像同步+幂等——§十-2 四点）。布局：<work-root>/<名>=公司 git 目录；.AIWS/ 与
      var/platform|plugins 在 work-root 下
  studio-next company validate <git-url | 本地路径 | tarball> [--json] [--allow-extra] [--product]
       公司仓库判定器（DEV-32；docs/51 规范正文）：五契约规则集全量——A 目录封闭集 /
       B 逐文件 schema 与值域 / C 交叉引用 / D 依赖 / E 卫生（闸跑克隆产物）。合法=
       PASS+摘要+「可初始化」exit 0；不合法=逐条违规 {规则号,文件,位置,违规描述,
       修复建议} exit 1；判定器自身错误（网络/权限/解包失败）exit 2。--json 走机器面；
       --allow-extra 豁免 A-1 封闭集外路径并留痕；--product 按导入产物面判（.studio-next/
       信任锚合法在场——复验已导入公司用）
  studio-next company create <slug> [名] [--name <公司名>] [--dir <目录>]
                              [--template <模板目录>] [--platform localfile]
                              [--work-root <根>] [--db <库路径>] [--plugin-root <目录>]
                              [--platform-root <目录>] [--aiws-root <目录>] [--by <动作人>]
                              [--dry-run]
      公司创建编排（DEV-15 / docs/36-§4 M-B 骨架刀）：init→provision→全员建号→jobs 装载→
      插件 provisioning→验收报告，一条命令串完（幂等——同命令再跑=adopt 收敛不重建；
      --dry-run 全相位只出计划零落盘）。布局与 company add 同款：<work-root>/<slug>=公司
      git 目录；.AIWS/ 与 var/platform|plugins|ledger 在 work-root 下
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
      进化链沙箱执行器（20-§九沙箱环节，src/evolve/sandbox.ts）：临时目录拷贝资产最小集 → 应用
      变更（--file=候选资产整文件替换）→ 跑 --command 冻结验收命令（超时杀进程组）→
      updateVerification 落证据 → proposed 迁移 sandboxed。生产零触碰（结构性保证）；
      判定 PASS/FAIL 均非命令错误（exit 0——红是档案面）；--command 缺省=fail 如实落账；
      --timeout 缺省 60000；--root 缺省当前目录；库不存在即拒（候选必须在库，不代建库）
  studio-next cutover --db <库路径> --candidate <id> --file <新文件> --company <公司slug>
                      [--no-restart] [--no-gray] [--root <资产根目录>] [--actor <actor>]
                      [--dept <部门path>] [--level <1-9>]
      进化链切权执行器（20-§九切权环节，进化链四刀之三，src/evolve/cutover.ts）：approved/promoted
      候选受控上产——双闸（状态∈{approved,promoted} + 判负闸 authorize 写前复跑）→ 备份
      <目标>.bak-<候选id>（回滚锚点保留）→ tmp+rename 原子写 → 读回复核 → approved 迁移
      promoted → SCHEMA_EVOLVE 事件落账（note=候选+资产+旧新 hash）；失败面先回滚再报
      （不留半改态）。切权成功默认开灰度观察窗（kv gray:<候选id>；--no-gray 跳过）。
      --no-restart 抑制重启提示（v0 恒不实际重启——supervisor 看护归运维刀）；
      --root 缺省当前目录；库必须已存在（写面不代建库）
  studio-next gray --db <库路径> --candidate <id> [--check | --close] [--root <资产根目录>]
      灰度观察窗三动作（20-§四灰度零事故；进化链四刀之四收官，src/evolve/gray.ts）：缺省=查窗
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
      复盘归档链（20-§十一复盘→案例库，src/evolve/postmortem.ts）：断路器关联（该单 CIRCUIT_BREAK/
      ESCALATE 台账历史自动进时间线）→ 渲染复盘模板（七节；无「责任人」字段——复盘不追责
      的机制化）→ 写案例库条目（<casebook>/<date>-<slug>.md，缺省案例库=当前目录 docs/casebook；
      条目=现象/根因/解法/预防 + 完整复盘附录）→ 落 POSTMORTEM 事件（note=条目约定路径、
      size、payload_hash）。--input JSON 七件套见 src/evolve/postmortem.ts PostmortemInput；
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
      maxActionsPerTick / maxInflight / stallAfterMs / stallKillAfterAlarms / laneTtlMs / breakerThreshold /
      autoApprove /
      companyDir / jobs / jobPollMs / models / budgetTicketCapUsd / budgetPersonCapUsd / reloadWatch；
      jobs: true 起定时岗调度器（v0.4：cron 到点→schedule 意图→主循环，结果落台账）；
      models: <models.yaml> 装载价目表→派发前预算闸估算校准（态 A；缺省态 B=适配器自报），
      预算预留-结算不落即不派（20-§六.8）；companyDir 给定时接 L1 配置热重载（指纹自动+
      reload 手动，reloadWatch 缺省开）；demo 模式=fake 全家桶零外部依赖
      （真 dsh/YouTrack/网关未接线，见 src/assembly/serve.ts 头注）
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
      从通道面根除）。DEV-41：daemon 消费请求后改名 .consume（去重位落 daemon_kv 跨
      重启）——残留请求不再使重启进程一拍自停；回执文件保留，轮询按 id 匹配不受影响。
      超时无回执 exit 1（daemon 未运行/拍太慢/控制面目录不符）；工位根发现序与 reload 同款。

默认值：--dir 缺省 ./<slug>；--name 缺省 <slug>；--port 缺省 8787（panel）/ 8789（overview）/ 8788（external）
文档：docs/04-公司目录与等级体系.md §二/§七/§九；docs/16-技术实现与里程碑.md §四；docs/02-需求-框架面.md F2-11/F2-12；docs/17-整体技术设计.md §8`

