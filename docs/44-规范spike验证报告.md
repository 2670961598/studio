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
