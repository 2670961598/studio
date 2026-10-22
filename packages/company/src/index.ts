/**
 * Studio Next · company —— 公司目录引擎
 *
 * 定位（docs/04，需求 C1/C2）：公司 = 代码外部的一个 git 目录；目录即 API。
 *
 * 职责：
 *   - 目录契约校验：org-config.yaml + departments 嵌套 config.yaml + people 档案 +
 *     reports/ docs/ prompts/ .studio-next.yaml；结构不合法给 **文件:行 + 修法**（04-§九）
 *   - 挂载：`serve --company <dir>`，可挂多家；校验不过拒绝启动
 *   - 模板与建议，不写死：目录结构/部门模板/报表约定/等级映射/定时岗配置全是默认模板，公司可覆盖
 *   - 定时岗调度源（D9 通用模型）：一切唤起都是定时任务，挂在部门节点下；
 *     报表岗/财务审查/人事审查/项目审查/惊动预算检查都只是这个模型的实例（04-§三）
 *   - 报表逐级聚合：叶子 → 部门 → 公司 → 总览，每层只读下层文件按约定归并，不跳级；
 *     数字从 SQLite 台账取，文字由负责 agent 写（零自评指标）
 *   - 配置漂移看门狗：配置 ↔ 代码能力 ↔ 未提交改动，只读确定性、零 LLM
 *   - 公司目录写路径：daemon 唯一写入者（人事变动/报表/配置落盘挂单 commit）
 *
 * 模板：`templates/company-2-level/`（2 级公司，最小可用公司目录）。
 *
 * TODO(骨架阶段)：
 *   [x] zod schema：org-config / 部门 config / 人事档案 front-matter / .studio-next.yaml
 *        （v0.1-M2.2 多文件面——src/multifile.ts，拟稿清单 M2.2-①..⑧ 见其头注）
 *   [x] 校验器：错误定位到 文件:行 + 给出修法（org-config v0；全目录面 v0.1-M2.2）
 *   [ ] 挂载器：加载 → 校验 → 汇总为内存快照 → 供 prompt/store 消费（serve 面挂载壳已用
 *        loadCompanyDirectory 全目录校验；快照消费侧聚合归后续单）
 *   [x] 定时岗装载：org-config.yaml jobs 段 → snapshot.jobs（v0.1-M4，映射表冻结在
 *        validator.ts OrgJobSchema 头注；daemon seedJobs 消费快照播种 jobs 表——18-§三）
 *   [ ] 定时岗热更：目录改动重注册对应岗、不动其他岗（18-§三；daemon 侧收口）
 *   [x] 报表聚合器·月报最小闭环（DEV-36，src/reports.ts）：按 `<date>-<type>-<节点>-
 *        <一句话>.md` 约定归并 + front-matter + 快照 JSON（人→部门→公司逐级聚合、零自评、
 *        台账数字）；月窗/三指标口径拟稿待批；日报/周报产报岗与 daemon 定时接线归后续刀
 *   [x] init 脚手架：从 templates 生成新公司目录（v0.1-M3，src/init.ts）
 *   [ ] schema 版本迁移脚本（migrate，由 daemon 执行、挂单留痕、可 git revert）
 */

/** 包名常量（占位导出） */
export const PACKAGE_NAME = "@studio-next/company";

/** 骨架状态标记：实现落地后改为 "ready" 或直接删除 */
export const PACKAGE_STATUS = "skeleton";

// 目录契约校验器 v0（docs/04-§二/§九；docs/25-§3.5 目录端口）
export * from './validator.ts'

// 岗位运作规格解析面（v0.1-M5，docs/35-§3：档位展开/时长解析/ops 读视图——纯函数）
export * from './cadence.ts'

// 报表聚合管线·月报最小闭环（DEV-36，docs/04-§三 核心契约 / docs/50 断链6：人→部门→
// 公司逐级聚合零自评；月窗/三指标口径/快照 JSON/md 渲染/材料化注入面 + MCP 接口位）
export * from './reports.ts'

// init 脚手架 + 目录读取壳（v0.1-M3，docs/16-§四 验收口径「init 出模板公司并通过自检」）
export * from './init.ts'

// 信任锚（DEV-27 正式化：docs/44 v1 信任锚设计——git-url 导入流复用）
export * from './trust.ts'

// .AIWS 员工工作区树正式化（DEV-28：docs/43-§五+§十9——建树同构+per-company 根守卫不并树
// +随人事增量同步（归档不删）+家内部不下探；排除表单源在 init.ts SCAN_EXCLUDED_NAMES）
export * from './aiws.ts'

// git-url 导入流（DEV-27 正式化：docs/43-§一「git 网址即公司」+ §十1-4 定稿增补——
// 克隆→剥 .git 重建本地仓→schema 写盘前检→provision→锚 trust=false→.AIWS 建树→
// 依赖清单安装挂点；直导通道同核；升级四点语义）
export * from './git-import.ts'

// 公司仓库判定器（DEV-32：docs/51 规范正文的实现面——五契约规则集 A/B/C/D/E 全量；
// `company validate` 与 DEV-27 导入流两遍（源面+产物面）共用同一实现；CLI 物化面
// （路径/git-url/tarball）+ 渲染面（人读/JSON）+ RepoInputError（判定器自身错误，exit 2 面））
export * from './repo-validate.ts'

// 依赖清单与插件绑定引擎（DEV-26 正式化：docs/43-§四「员工的行为面」+ §十5-8 定稿增补；
// 判定 normative 标尺 docs/51-契约 D——纯决策面 planPluginInstalls + 隔离根安装执行面 +
// 契约 subject depsSubject）
export * from './dependencies.ts'

// 公司创建编排内核（DEV-15 / docs/36-§4 M-B 骨架刀：init→provision→全员建号→jobs→
// 插件 provisioning→验收报告，一条命令、幂等、--dry-run；端口注入面——daemon/CLI 组装依赖）
export * from './create.ts'

// 员工花名随机命名器（DEV-14，docs/36-§4 M-A：种子确定性+批内唯一——分级模板消费；
// 词池人工冻结，改池=重新冻结黄金序列，属口味变更）
export * from './namer.ts'

// 分级公司模板规格+生成器（DEV-14，docs/36-§4 M-A：docs/33-§3 逐级部门表单一事实源 →
// company-{3..9}-level 七套骨架；渲染后自检（目录校验+init 占位断言）红即不落盘）
export * from './level-specs.ts'
export * from './gen-template.ts'
