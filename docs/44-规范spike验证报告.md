# 44 · 公司规范 v1 · ⑤验证 spike 报告（提案流第⑤步）

> 位置：40-提案 → ②③探索（41/42）→ ④定稿（43）→ **本文=⑤验证 spike** → ⑥制作人过审 → v1 冻结。
> workspace：`/Volumes/BigDisk/StudioNext-spike`（分支 `spike/spec-v1`，throwaway 原型仓，不回并主仓）。
> 验证对象：docs/43 §二核心层条款（本刀收任务书点名的条款 1/2/3/4/5）；条款 6/10 的导入侧
> 执行面（manifest strictObject）随 import 管线一并落地验证。
>
> 判定纪律执行情况：**零削弱、零放宽**——五恶意样本全部被机制（结构拒收/白名单/指纹）挡下，
> 良性包全链绿；期间发现的所有「跑不通」均以改实现或记录问题方式解决，无一例通过削弱条款解决。

---

## 一、总判定

**⑤通过。建议进入⑥制作人过审。**

- 良性最小包全链绿：import（结构闸+manifest+封闭文件集+落锚 trust=false）→ 校验（全目录面）→
  挂载（快照）→ 指纹批准（trust=true+留痕）→ **一单真实任务闭环**（dsh 适配器真 spawn +
  localfile 真盘平台 + 真验收闸门；证据=DISPATCH / GATE_PASS（四要件齐）/ QA_PASS / MERGE /
  CLOSE + REPORT.md 落盘非空 + 真实 token 账）。
- 五恶意样本全部被机制挡下（§三逐条）；全仓测试 **1490 通过 / 0 失败**（Node 24.21.0；
  基线 1445——新增 45 条 spike 测试全绿且存量零破坏）；`bun run typecheck` 绿。
- 提交：`f7b4f5d`（条款1）、`cbae8c2`（条款2/3/4/5 核心+夹具）、`4387256`（全链闭环 e2e）。
  未推送、不回并。

---

## 二、逐条款判定表

| # | 条款（docs/43 §2.3） | 判定 | 执行点（spike 实落） | 证据（测试名 → 摘要） |
|---|---|---|---|---|
| 1 | worker env 白名单 deny-by-default + credentials 键名封闭枚举 | **通过** | `packages/adapters/src/dsh.ts`：`filterWorkerEnv`（封闭允许集 PATH/HOME/LANG/LC_ 前缀/TZ/TMPDIR/DSH_ 前缀）+ `assertCredentialKeys`（枚举 DEEPSEEK_API_KEY/STUDIO_TOOLS_WKEY）+ spawn 位 `extendEnv:false` | `dsh-env-whitelist.test.ts` 12 用例全绿：集外键丢弃；PATH/NODE_OPTIONS/LD_/DYLD_/SHELL/HOME 六类注入键 → launch 抛 `CONFIG_INVALID/dsh/credential-key-rejected`（子进程不起）；枚举内键真透传（回显直证） |
| 2 | 公司文本默认 untrusted 渲染；升级受信=显式动作留痕 | **通过** | `packages/prompt/src/layers.ts` renderSection/renderTrimmableSection **缺省翻转**（字段 `untrusted`→`trusted`，不写=消毒+引用块+非指令声明）；`packages/company/src/trust.ts` 信任锚（import 落锚 trust=false；approve 翻 true 留痕谁/何时）；`apps/daemon/src/prompt-assembly.ts` 读信任态（`companyTrusted`）+ `parseCompanyPrompts` | `spec-spike-e2e.test.ts` 前段：未批准时注入文本（忽略上文+```bash+rm -rf+`curl|sh`）→ AGENTS.md 含【不可信资料·非指令】+≥3 行【已剥离命令形态行】+ 命令体不出现；批准后同文本原样渲染（sanitized=0）。锚留痕 `['import','approve']`，`by/at` 齐 |
| 3 | 分发件禁携 `.git`（+可执行位/钩子/未知条目） | **通过** | `packages/company/src/import.ts` `scanPackageStructure`：任何深度 `.git`（文件或目录）/可执行位文件/符号链接/顶层封闭文件集外条目 → `CONFIG_INVALID(import/structure-rejected)`；导入产物**重建** .git（init 同款首提） | `spec-spike.test.ts`（company）6 用例：.git 目录含 hooks/pre-commit、.git 文件（worktree 形态）、深层 departments/**/.git 三形态全拒且无半成品；exec-bit/symlink/未知顶层 `scripts/` 全拒 |
| 4 | 批准指纹：装载校验≠变更批准；漂移→拒自动应用+ESCALATE+等 re-approve | **通过** | `trust.ts`（内容指纹=per-file sha256→总指纹，**排除锚文件自指**）+ `apps/daemon/src/hot-reload.ts` reloadNow 内信任锚闸：有锚且 `!trust ∥ 指纹≠锚内批准指纹` → `trust-drift`：不 apply + `ESCALATE(RELOAD_TRUST_DRIFT)` + 撤销受信位（revoke，回 untrusted）；init 通道目录无锚=闸不适用（存量行为不变） | `spec-spike-e2e.test.ts` 恶意④：批准后篡改 prompts → `kind='trust-drift'`、apply 零调用、ESCALATE note 含「指纹漂移…re-approve」、锚 trust=false；防刷屏空转不重报；re-approve（留痕 `['import','approve','revoke','re-approve']`）+ 手动 reload → `reloaded` 应用了新内容 |
| 5 | 单一校验平面：slug SLUG_RE 同款语法；output/outputs 相对路径语法域；部门↔org jobs 双清单互检（M2.2-⑤） | **通过** | `validator.ts`：`SLUG_RE` 上移单表（init/import/manifest/org-config 四通道共表）；`isSafeRelativeOutputPath`（禁绝对/`..` 段/反斜杠/盘符）收 `jobs[].output/outputs`；`multifile.ts` 双向互检（`dept-config/jobs-dangling` + `org-config/jobs-not-in-dept-config`） | `spec-spike.test.ts`：`../../..`、`/etc/passwd`、`C:\evil`、内段 `..` 全拒（文件:行+修法）；`Bad_Slug` 拒；部门私设 `ghost-job` 与 org 绕过清单的 `rogue-job` 双向拒。模板两清单本已一致（hot-reload 存量测试按互检口径补齐了双清单同步——「模板对齐日」落实，模板本体无需改动） |
| 6/10（导入侧） | 插件内容寻址+声明永不作放行输入；executor 解析权归制作人 | **通过（导入面）** | `import.ts` `ImportManifestSchema` 全 strictObject：插件条目只收 name/version/hash(sha256-64hex)/source；executor 段只收 name/min/caps | `spec-spike.test.ts` 恶意⑤：顶层 `harmless: true` / 插件条目自带 `harmless` / executor 夹带 `cmd` → 三形态全结构拒收（manifest-invalid）；manifest slug 大写下划线 → SLUG_RE 拒 |

**良性全链证据摘要**（`spec-spike-e2e.test.ts` 后段）：
- DISPATCH note：`fp=W-v0.5-spike/co.<sha8>/org.<sha8>/p.AGENT-1.<sha8>/t.LOCAL-1.1/ex.dsh@…`、
  `agents=…/tmp/instructions/LOCAL-1.md`（user_level 桥接通道）、work_records.executor=**dsh**（真适配器非 fake）。
- GATE_PASS note：「四要件齐（completed/非空/REPORT/exit0）」；report_ref 落盘且含「## 结论」；
  summary_ref 落盘；tokens={input:4510,output:26,cached:256}（golden 流真实账）；
  真验收闸门实际执行 `echo benign-ok` exit=0。
- 生命周期收口：`['DISPATCH','GATE_PASS','QA_PASS','MERGE','CLOSE']`，平台态「已交付」。

**五恶意样本处置（附录 B 纪律）**：①②④⑤经 e2e/company 套件、③经 adapters 套件全部挡下；
恶意样本**只存在于测试 tmp（运行时构造）与测试代码内**，仓内 `fixtures/` 只有良性包——
「永不进任何分发渠道」落实为目录结构事实。

---

## 三、恶意样本×5 判定明细

| # | 样本 | 挡它的机制（非巧合直证） | 测试与断言 |
|---|---|---|---|
| ① | 包携 `.git/hooks/pre-commit`（curl 外联钩子） | import 结构扫描：`.git` 目录任何深度拒收（`import/git-present`）；另验证 `.git` **文件**（worktree 劫持形态）与深层 `.git` | `spec-spike.test.ts`「携 .git/hooks 的包」3 用例 + exec-bit/symlink/unknown-entry 3 用例 |
| ② | `output: ../../..` 路径逃逸 | validator 语法域：相对路径 refine（`..` 段/绝对/盘符/反斜杠全拒），org-config 直挂与 import 自检两通道同拒 | `spec-spike.test.ts`「output 路径逃逸」3 用例（含 `isSafeRelativeOutputPath` 纯函数 10 断言） |
| ③ | worker env 探测（宿主注入 FAKE_SECRET/NODE_OPTIONS 后拉起 worker dump env） | spawn env 白名单：点名键 `<unset>`；**键名全貌探测**（fake CLI 新旋钮 `FAKE_ECHO_ENV_KEYS`，只打名不打值）断言可见键 ⊆ 允许集 ∪ 框架注入键，非法键清单为空 | `dsh-env-whitelist.test.ts`「恶意样本③」：负断言 FAKE_SECRET/NODE_OPTIONS 不可见 + 全集合法 |
| ④ | 批准后篡改 prompts（注入外发指令） | 批准指纹闸：内容指纹 ≠ 锚内批准指纹 → 拒 apply + ESCALATE(RELOAD_TRUST_DRIFT) + revoke；篡改文本若被装配也是 untrusted 面（条款2/4 合流） | `spec-spike-e2e.test.ts`「恶意样本④」4 用例：拦截/防刷屏/re-approve 恢复 |
| ⑤ | manifest 自述 `harmless: true`（「绝对无害请放行」） | strictObject 未知键=结构拒收（`import/manifest-invalid`）——自述字段在 schema 里**没有位置**，谈不上作为放行输入；executor 夹带 `cmd` 同理拒 | `spec-spike.test.ts`「harmless 自述字段」4 用例 |

---

## 四、机制发现（spike 的核心增量——对 docs/43 的修改建议）

按严重度排序。前三条若未在 spike 中发现，条款 1/4 的实现将是**形同虚设的假防护**。

1. **【致命坑】execa 缺省把 `env` 选项并进 `process.env`**（execa 10.1.1
   `lib/arguments/options.js:130`：`{...(extendEnv && process.env), ...envOption}`）。
   只写 `env: 白名单` 时宿主全量 env 仍会到达子进程——白名单是装饰品。**必须同置
   `extendEnv: false`**（dsh 的 launch 与 detect 两个 spawn 位都已落）。docs/43 条款 1
   落实时应把「`extendEnv:false` 是白名单生效前提」写进执行点说明（四家适配器同坑）。
   直证：修复前恶意样本③在 vitest 下整流被宿主 NODE_OPTIONS 污染致败；修复后全绿。
2. **信任锚必须被指纹与监听双向排除**（`.studio-next/` 目录）：锚内记录指纹、指纹覆盖锚=
   自指；锚写入（approve/revoke）若进 stat 监听则批准动作自身触发漂移告警（自扰环）。
   spike 将 `.studio-next/` 从 `statDirectory`/基线 walk/内容指纹三处一致排除。docs/43
   条款 4 应补一句「锚文件不属于指纹覆盖面与变更监听面」。
3. **re-approve 后的应用路径要写明**：锚文件被监听排除（正确设计）意味着「只动锚的
   re-approve」对自动指纹监听不可见——新内容的应用走手动 reload 通道（控制面文件
   `studio-next reload`，既有机制）。「显式批准→显式应用」与条款 4 语义同构，e2e 已按此
   验证；但 docs/43 应写明，否则实现者会以为 re-approve 后自动面应自行重装载。
4. **`.studio-next.yaml` 一名两义冲突**：docs/43 §2.2 让分发件 manifest 用此文件名
   （`studio-next/company-package@1`），而现行目录契约的同名文件是挂载元信息
   （`org-config/v1`，multifile 校验两处同源）。spike 的解法：import 时**读 manifest →
   写本地 meta（转换）**，manifest 原文存档 `.studio-next/import-manifest.yaml`。建议④改稿
   二选一：(a) 维持一名两义+明文「import=转换步」（本原型做法）；(b) 分发件 manifest 改名
   （如 `package.yaml`），本地 meta 独占 `.studio-next.yaml`——更干净，推荐 (b)。
5. **条款 2 缺省翻转是破坏性 API 变更**：`CompanyPromptSection/PersonFactSection` 的
   `untrusted?: boolean` 改为 `trusted?: boolean`（不写=不可信）。 LayerSource 系已在
   【拟升 contract】清单里，正式落实时需走契约批次。另：**L4 教训 top-k 不属于「公司文本
   资产」**（daemon 侧知识库检索面），spike 保持其受信渲染——条款 2 的覆盖面建议在文中
   点名（prompts/charter/档案正文），避免实现者把 L4 lessons 也翻转。
6. **macOS 运行时注入键 `__CF_USER_TEXT_ENCODING`**：libuv/CoreFoundation 在 spawn 层之下
   自动注入（不经过 execa env 选项），白名单无法抑制。无害（非密钥非注入向量），但条款 1
   的允许集说明应记录此豁免，免得未来审计误判「白名单漏 key」。
7. **jobs 双清单互检的边界口径**：spike 实现「org 段每条岗必须被其 dept（缺省根部门）
   config 的 jobs 清单列出」+「清单里的 id 必须在 org 段」**双向阻断**。含义：部门 config
   无 jobs 键而有 org 岗挂靠该部门 → 也拒（视为清单缺失）。模板现状两清单一致，无需改；
   「规范定稿日=模板对齐日」在 spike 中落实为 hot-reload 存量测试的夹具对齐（测试原本只改
   单侧——正是 M2.2-⑤ 记录的老不一致形态，现已按互检口径改双写）。
8. **测试旋钮的命名空间迁移**（工程注记）：dsh 适配器 env 收口后，fake CLI 的 FAKE_*
   旋钮不再随宿主 env 到达子进程。解法=旋钮迁入 executor 自有命名空间（`DSH_FAKE_<KNOB>`
   → fake-cli 入口折算回 `FAKE_<KNOB>`）——语义诚实：fake CLI 扮演 dsh 本尊，其测试配置
   本就属于 DSH_ 命名空间。kimi/claude/codex 未收口，不受影响。
9. **工程注记两则**：(a) 子进程 CLI 用 `process.stdout.write`+`process.exit` 会在管道下
   截断流（spike executor 首版实踩；fake-cli 的 `writeSync(1,…)` 才是正解）；(b) localfile
   平台建单初始态=provisioned states[0]（缺省 `open`），engine 状态机要 `新单`——onboard
   必须执行 `fields.provision`（docs/23 既有语义，daemon 不代写；e2e 由测试充当 onboard 角色）。
10. **环境基线注记**：Node 25 下 4 个 spawn 冒烟测试因 `node:sqlite` ExperimentalWarning
    污染 stderr 而红（非代码问题）；Node 24.21.0 下全绿。CI 应钉 Node 24 LTS（与 AGENTS.md
    运行时约定一致）。

---

## 五、与 docs/43 判定纪律的对账

- 「良性包全链绿」：✅（§二证据摘要；真 spawn/真平台/真闸门，零 LLM 打桩——执行体是
  回放真机 golden 流的 spike executor，适配器/引擎/台账/平台全是仓内真件）。
- 「五恶意样本全部被机制挡下」：✅（§三；每一项都断言了机制面——结构拒收规则名/键名
  全貌/指纹比对——而非仅仅「测试没崩」）。
- 「任何一项需要削弱条款、放宽断言」：**零发生**。过程中三次「跑不通」（execa env 合并、
  锚自指、re-approve 不可见于自动面）全部以**加强实现或澄清语义**解决（§四 1-3），无一例
  通过放宽断言让测试变绿。
- 「不许 LLM 打桩」：✅。
- 「发现条款表述有误/不可执行如实记录」：✅（§四 4/5/7 三条直接指向 docs/43 文本需改写处）。

---

## 六、留给⑥过审的清单

1. §四-4：manifest 文件名二选一（推荐分发件改名 `package.yaml`）。
2. §四-1/2/3：把 `extendEnv:false` 前提、锚排除面、re-approve 应用通道写进条款 1/4 执行点。
3. §四-5：条款 2 覆盖面点名（公司文本=公司资产，L4 lessons 不翻转）；翻转的契约批次路径。
4. §四-7：jobs 双清单互检的双向阻断口径（含「部门 config 缺 jobs 键=清单缺失」）确认。
5. 撤销语义（revoke-on-drift，fail-closed 回 untrusted）是 spike 的合理外推，docs/43 条款 4
   原文只写了「拒自动应用+ESCALATE+等 re-approve」——建议补写 revoke 或明示不撤销的理由。
6. credentials 键名封闭枚举的正式清单（spike 取 DEEPSEEK_API_KEY/STUDIO_TOOLS_WKEY 两键）
   需与 §2.2 类别枚举（model-key/platform-write/im-post）对表成文。

---

## 七、复现口径（冻结验收命令）

```bash
cd /Volumes/BigDisk/StudioNext-spike
bun install
bun run typecheck                          # 绿
bunx vitest run packages/adapters/test/dsh-env-whitelist.test.ts \
                  packages/company/test/spec-spike.test.ts \
                  apps/daemon/test/spec-spike-e2e.test.ts        # 45 用例全绿
bun run test                               # 1490 全绿（Node 24.21.0）
```

（运行环境：Node 24.21.0 经 mise 注入 PATH；bun 1.4.3。）

---

# §v1.1 增量验证（2026-10-20 ｜ 分支 spike/spec-v1.1，提交 b14b9a5）

> 验证对象：docs/43 v1.1 §七 两项新增机制（git-url 导入流 / 依赖清单自动安装）+
> 制作人 2026-10-20 口谕增补（.AIWS 员工工作区树）。
> v1 十条机制的验证记录见上文（§一-§七，spike/spec-v1 分支，1490/1490）；本节为增量，
> 与 v1 结论合并生效。判定纪律不变：良性示例包全链绿 + 每机制端到端证据 +
> 「修到能跑」=不过；零 LLM 打桩；恶意样本只存在于测试 tmp（运行时构造）。

## 一、增量判定表

| # | 机制（docs/43 v1.1） | 判定 | 执行点（spike 实落） | 证据（测试 → 摘要） |
|---|---|---|---|---|
| 1 | §七-1 git-url 导入流：克隆→剥离活性 .git→重建本地仓→schema 校验→初始化全链（含升级=再次导入） | **通过** | `packages/company/src/git-import.ts`：`companyAddGitUrl`（真实 git clone 本地仓路径/file:// 两形态当 git-url，零外网）→ `importCompanyRepo` 导入核（本地路径直导同核——docs/43 §一「同构」）；内容复制排除任何深度 .git → `git init`+首提（干净本地仓）；`loadCompanyDirectory` 全目录面**写盘前先检**；初始化=localfile 字段 provision（FlowPlatform 端口注入，公司声明 `platform: localfile` 才走）+信任锚 trust=false（`trust.ts` 自 v1 spike cbae8c2 移植，语义零改动）+依赖清单自动安装挂点；升级=镜像同步（含删除）+HEAD 不变不产新提交+锚重落 trust=false | `git-import.test.ts` 18 用例：克隆全链（slug/锚/provision/安装/git 首提/工作树净）；**恶意钩子剥离三维负断言**（源仓运行时预埋 `.git/hooks/post-merge` 外联钩子 + `core.hooksPath=./.evil-hooks` 配置劫持 → 目标 hooks 面无 post-merge/配置无 hooksPath/全目录无恶意内容体）；本地路径直导通道同断言（naive 整目录复制会带过——机制面挡）；升级 v2（改 prompts+加岗+删标记文件）→ 内容更新+git 两提交+锚 history 追加+指纹翻新+钩子仍剥离；幂等（同 v2 再导 contentChanged=false 零新提交）；错家公司 slug-mismatch 目标不动；无锚目录拒升级；结构闸四负例（未知顶层/自带锚目录/exec 位/符号链接）+schema 不过拒收无半成品；CLI 冒烟（真 bin 进程 `company add` exit 0+四产物落盘） |
| 2 | §七-2 依赖清单自动安装：dependencies.yaml 解析→属性绑定求值→插件安装/启用/热重载全链（含版本解析与缺失源处理） | **通过** | `packages/company/src/dependencies.ts`：strictObject 解析（`when{attr,is}→plugins[{name,version}]`）；绑定求值（属性候选：dept=path 全量+末段名双候选、skills 逐元素、level 字符串化）；最小语义化版本（^caret 含 ^0.x 锁 minor / 精确版缺 patch 归一 .0；多绑定同名=约束并集全满足才装，冲突不装错版本）；安装=源定位（公司包 plugins/ 优先→PluginSource 外部源接口）→落位（目录复制进**注入的隔离插件根**——引擎无缺省值，结构上不可能写 ~/.dsh）+registry.json 登记+install-log.jsonl 安装清单日志+confirm 确认位（拒装=零落盘只出清单）；缺源=missing 如实可见（failOnMissing=true 严格面）；热重载=配置指纹 sha256(deps 原文+启用集投影) 变化→重算+增量补装、不变→零动作幂等 | `dependencies.test.ts` 22 用例：解析负例 5（未知键/坏 schema/坏 version/未知 attr）；版本表（^1.2 区间/^0.2 锁 minor/精确等值/缺 patch 归一）；三命中面（role 命中/dept 末段名命中/设计师不命中+无人空集）；e2e 双插件安装（落位 dsh.bundle 形态完整随行+registry 两员+日志一行）；幂等重跑 satisfied；多约束并集一次安装；confirm=false 零落盘零登记日志留痕；缺源 missing+failOnMissing 抛；版本冲突不落位；外部源接口第二源真装；无依赖清单=空报告（能力声明语义）；热重载三段（首装→指纹不变零动作日志不增行→deps 变化重算补装+状态落盘）+指纹三态（deps 变/启用面变/双不变）+人员面收缩触发重算（已装保留） |
| 3 | .AIWS 员工工作区树（2026-10-20 口谕增补） | **通过** | `ensureAiwsTree`（git-import.ts）：`.AIWS/<部门路径>/<工号>/` 镜像 org-config（部门文件夹先建、工号文件夹挂 dept.path 下；幂等 mkdir；fresh 与升级同建）；落点=公司根目录（targetDir 同级，**不进公司 git 目录**），可注入 aiwsRoot；排除表三处同步（init.ts readDirectoryFiles / hot-reload.ts statDirectory+基线 walk——与 .git/.DS_Store 同款） | `git-import.test.ts`：建树同构（部门得文件夹/AGENT-1 在工程部下得文件夹/公司 git 目录内无 .AIWS）；排除双证①批准后员工文件夹写任意内容→内容指纹不变→trust 态不被扰动；双证②父级根读面零 .AIWS 键+对照公司内容照常在（排除不是漏读）。`hot-reload.test.ts` 3 用例（daemon 侧）：statDirectory 排除表直证（.AIWS 在扫描根内也不进 stat 面）；**对抗布局**（.AIWS 放进被监听的公司目录内部）写任意内容 check() 全程 null 零 RELOAD 事件；对照组改 org-config 同栈即 reloaded（排除没挡错面） |

**全仓测试 1499 通过 / 0 失败**（基线 1456 + 新增 43：git-import 18 + dependencies 22
+ hot-reload 增 3；存量零破坏）；`bun run typecheck` 绿（Node 24.21.0 / bun 1.4.3，
mise 注入）。判定：**两机制+增补均过，建议随 v1 结论一并进入⑥制作人终审。**

## 二、良性全链证据摘要（一条命令安装）

- CLI 真进程冒烟：`node bin.ts company add <本地 fixture 仓> src-corp --work-root <tmp>`
  → exit 0；stdout 摘要 `slug=src-corp；首次导入`/`trust=false`/`dsh-web-test:install`；
  四产物落盘（公司 git 目录 / `.studio-next/trust.json` / `.AIWS/departments/工程部/AGENT-1/`
  / `var/plugins/dsh-web-test` + `var/platform` 字段盘）。
- 依赖清单三绑定（role 命中 `^1.2` + dept 命中 `1.2.0` 精确 + 设计师不命中 `^9.0`）→
  AGENT-1 启用集=去重后一枚 `dsh-web-test`，双约束并集 `['^1.2','1.2.0']` 同被源 1.2.0
  满足——一次安装；设计师绑定零需求面不安装。
- 升级链：fixture 仓推进 v2（改 prompts+org-config 加 src-night-audit 岗+删
  docs/upgrade-marker-v1.md）→ 再导 → 快照 jobs 两岗、prompts 带 v2 段、标记文件被
  镜像删除、git 两提交、锚 `['import','approve','import']` trust=false（升级把已批准面
  打回未批准——fail-closed）；同 v2 三导 → contentChanged=false 零新提交。

## 三、机制发现与对 docs/43 v1.1 的反馈（spike 核心增量，按重要度）

1. **本地路径直导是剥离开口的主通道，规范须点名**：git clone 本身不携 hooks/config
   （负断言对 clone 通道是「传输层天然不携」）；真正会把 `.git/hooks/post-merge` 与
   `core.hooksPath` 带过来的是**本地路径/tarball 直导被 naive 整目录复制**。spike 落法：
   两通道共用同一导入核（内容复制在任何深度排除 .git 后重建仓）。docs/43 §一「同构
   支持」应补一句：「直导通道必须走与克隆相同的剥离管线，禁止整目录复制」。
2. **升级语义四点需规范定稿**（§一原文只说「升级=同一导入流」）：(a) 幂等口径=内容
   镜像后 HEAD 不变则不产新提交；(b) 信任语义=升级把受信面打回 false（即便升级前已
   approve——与 v1 漂移 fail-closed 语义一致）；(c) `.studio-next.yaml` 盖戳字段
   （created_at/last_validated_at）是 daemon 自管状态，升级不随源回卷（源的 null 桩
   不得抹掉本地值）；(d) 升级通道只认有锚公司+slug 同家（错家/外来目录拒收）。
3. **分发仓自带 `.studio-next/` 锚目录=信任态劫持面，须显式拒**：自带锚可伪造
   `trust:true` 历史与指纹。封闭内容集不含该目录+专则 `import/anchor-present` 拒收
   （v1 结构闸在 v1.1 因「.git 允许但剥离」语义重构，锚目录拒收需重申入附录 A）。
4. **「一名两义」在 v1.1 自然消解但留有尾巴**：v1 spike 发现分发 manifest 与挂载
   meta 同名（§四-4，当时推荐分发件改名 package.yaml）。v1.1 分发仓=公司目录本体，
   `.studio-next.yaml` 以挂载元信息形态随行、无独立 manifest——冲突不复存在。但
   §一「manifest 记 schema 版本」的现状承载=org-config schema 字段+git 历史；若未来
   要独立分发元数据（版本/来源/多模板族），仍应取名 package.yaml 而非复用
   `.studio-next.yaml`。
5. **依赖清单 attr 域应收封闭枚举，dept 匹配面须写明**：示例 `is: 研发部` 是部门名
   而 person.dept 是 path（`departments/研发部`）——spike 落「path 全量+末段名双候选」
   匹配；attr 收档案已知键封闭枚举（role/dept/level/skills/executor/status，未知拒收）。
   §四应补：「绑定域=档案已知键；档案正文自由字典不参与绑定」——§二「属性面=自由
   字典」与 §四「行为面=插件绑定」的边界由此定清。
6. **版本解析最小面与并集语义**：只收 `^x.y(.z)` 与精确两形态（`~/>=/通配` 不收）；
   缺 patch 归一 `.0`；`^0.x` 锁 minor（标准 caret 表）；多绑定命中同一插件=约束并集，
   源版本须满足全部约束，否则 conflict 如实上报**不装错版本**。§四「可指定版本号」
   应写明这两种形态与并集语义。
7. **缺源处理双面语义**：默认 missing 进安装报告如实可见、不阻断导入（依赖清单同时
   是能力声明——§五「非 dsh 损失哪些能力」的同源数据）；`failOnMissing=true` 为导入侧
   fail-fast 严格面。外部源=PluginSource 接口（公司包 plugins/ 优先，按序询问）——
   §四「可指定来源」的落地形态，npm/registry 落位归正式单。
8. **热重载不卸载**：启用集收缩时已装插件保留（registry 是追加事实，卸载语义归正式
   单）；配置指纹=sha256(dependencies.yaml 原文 ‖ 排序后启用集投影)——deps 内容与
   命中面任一变化都触发重算。dsh 侧 profile patch 指向隔离根即装载（insert 条目随
   插件 cordis.patch.yml 旅行——docs/34-§3.1 形态不破坏）。
9. **.AIWS 根归属待定稿**：口谕「与 company git 目录/var 平级」→ spike 落缺省
   `<targetDir 同级>/.AIWS`+可注入 aiwsRoot。多公司共享同一 work-root 时 .AIWS 并树
   （同 dept path 会合流）——正式单需定：per-company 根或 work-root 级共享+slug 段；
   派发时 worker cwd 固定到员工文件夹属后续实现单（口谕已界定不在本 spike）。
10. **两条工程注记**：(a) simple-git 的 block-unsafe-operations 插件拦 `core.hooksPath`
    配置（库侧同认此为危险面——夹具须直写 .git/config 植入；佐证 hooksPath 劫持是
    真实攻击面）；(b) **exec 位经 git clone 可旅行**（git 记录 mode 100755，克隆产物
    保有）——结构闸必须跑在**克隆产物**上而非源仓工作树，spike 按此实现。

## 四、复现口径（v1.1 增量冻结验收命令）

```bash
cd /Volumes/BigDisk/StudioNext-spike && git checkout spike/spec-v1.1
bun install
bun run typecheck                                                       # 绿
bunx vitest run packages/company/test/git-import.test.ts \
                  packages/company/test/dependencies.test.ts \
                  apps/daemon/test/hot-reload.test.ts                   # 67 用例全绿（新增 43）
bun run test                                                            # 1499 全绿（Node 24.21.0）
```

（提交 `b14b9a5`；未推送、不回并——throwaway 原型仓纪律同 v1 spike。）
