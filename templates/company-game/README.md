# 星火游戏工作室 · 上手说明（README）

> 本包是 **Studio Next 行业示例公司包 · 游戏公司**（docs/43-§三）：与
> `templates/company-2-level`、`templates/company-internet` 共用**同一张 org-config
> schema**（`org-config/v1`），行业差异全部表达在**资产**——charter / prompts 战役 /
> jobs 定时岗 / dependencies 依赖清单（「下载即可开一家游戏公司」）。
> 拿来即改即用：改个工作室名就能开工。

## 一、三步开公司（git 网址即公司——docs/43-§一）

1. 把本包推成你自己的 git 仓（或直接用本仓路径试装）。
2. 由**部署者**执行 `studio-next company add`（参数：本包的 git-url、公司名；公司仓工作根由部署面
   指定，**模板不携带本机路径**）——克隆 → 剥离活性 .git 重建本地仓 → schema 校验 → 平台字段
   provision → 信任锚 trust=false → 建 .AIWS 员工工作区 → 依赖清单落位。
3. 制作人批准信任锚后（trust=false → true），daemon 上车开工。

装完的布局（部署面工作根下）：`<公司名>/`=公司 git 目录、`.AIWS/`=员工工作区树、
`var/platform|plugins`=平台盘与隔离插件根（docs/43-§一/§五）。

> 边界注记：本包面向 **git-url 导入通道**（行业模板的主传播面，docs/43-§一）；
> `studio-next init` 模板通道的占位替换当前锚定 `company-2-level`，行业包走 init
> 通道的对齐归后续单。本包声明 `org-config/v1`（与层级模板同一张 schema；schema 字面量
> 是迁移期绑定标识——v2/10 §3.3）。

## 二、包内资产地图（与互联网公司包的差异就在这里）

| 文件 / 目录 | 是什么 | 游戏公司差异点 |
|---|---|---|
| `org-config.yaml` | 组织与编制的拟任声明（拟任≠事实；schema 同一张表——v2/06 §5.1） | 使命 / 部门两轴（研发+内容）/ 定时岗 |
| `charter.md` | 公司章程（改它走最高级批示） | 品质红线（崩溃率）、热更纪律、档期契约 |
| `prompts/company.md` | L1 提示词资产：使命 / 当前方向 / **战役** | S3 赛季 / 新手留存 / 崩溃率与性能 |
| `departments/**/config.yaml` | 部门章程与泳道 | core 泳道（引擎一条道）、content 泳道（内容并行） |
| `departments/**/people/*.md` | 员工档案（六节固定结构） | 岗位画像（主程/测试/关卡设计） |
| `jobs`（org-config 内） | 定时岗：`game-build-smoke` 构建冒烟、`game-feedback-patrol` 反馈巡逻 | 游戏运作节奏（含升级链示例） |
| `dependencies.yaml` | 依赖需求声明（候选生成器：属性命中≠启用权——v2/06 §3.5） | 资源检查 / 本地化文案插件示例 |
| `assets.yaml` | 资产清单（ASSET-01 唯一索引；**目标文件位**——v2/06 §4.1；本波未随模板分发，登记缺口归 v2/16） | 资产面索引（清单先行，目录名不猜） |
| `plugins/dsh-asset-check/` | **资产部 DSH 插件专属资产位**（v2/06 §4.5；84 裁决一：保留不迁出；框架仓以 registry `builtinAssets` 登记，目标执行器=dsh） | 资源完整性检查插件 |
| `docs/` | 公司自述与制度文本 | 赛季节奏手册 |
| `reports/` | 定时岗产出落点（按部门分目录） | — |

## 三、改成自己的工作室（十分钟路线）

1. **改身份**：`org-config.yaml` 的 `company.name` / `slug` / `mission`；README 标题。
2. **改方向**：`prompts/company.md` 的当前方向与战役表（战役=近期的打赢标准）。
3. **改编制**：增删 `departments/` 目录与 `org-config.yaml` 的 departments / people /
   level_distribution 三处（等级分布必须与 people 实数相等）。
4. **改岗位**：`org-config.yaml` jobs 段增删定时岗（cron 或节奏档位恰给其一，
   docs/35-§3；升级链 `escalate` 可选）；部门 `config.yaml` 的 jobs 清单保持一致。
5. **改行为面**：`dependencies.yaml` 调绑定（attr 只收 role/dept/level/skills/
   executor/status 六键——docs/43-§十-5）；自带插件放 `plugins/<名>/`（dsh.bundle
   形态，docs/43-§四）。

## 四、依赖清单示例（本包自带的两个命中面）

| 绑定 | 插件 | 结果 |
|---|---|---|
| `role=主程` | `dsh-asset-check ^1.0` | 命中 GAME-1，包内自带 → 导入即装 |
| `dept=内容部` | `dsh-loc-lint 0.9.0` | 命中 GAME-2，**包内无源** → 进安装报告 missing 面（依赖清单同时是能力声明——docs/43-§十-7 / 51-D-3） |

## 五、纪律（继承框架，不可覆盖）

- 公司包内**唯一允许的代码是 dsh 插件**（`plugins/`），其余一律是配置/提示词/架构文本
  （docs/43-§四）
- 不要提交 `.AIWS/`（员工工作区=本地产物，建司时框架生成——docs/51-A-4）与
  `.studio-next/`（信任锚目录——docs/51-A-5）
- 完成只认落盘证据：终态事件 + 非空输出 + REPORT 落盘 + 闸门 exit=0（docs/17-§6）
