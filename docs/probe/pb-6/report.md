# PB-6 备选 CLI · 真机探针报告（PRB-24/25/26）

> **头注**
> - 日期：2026-11-03（探针采集窗口 `2026-11-03T05:01:06Z`–`2026-11-03T05:02:47Z` UTC；本报告落盘 2026-11-03）
> - git HEAD：`675192cfe1862ff65787b609d1e2d5b90da4c0b9`（分支 `dev`）
> - 工具链/宿主：node **v24.21.0**（`mise exec --`）/ bun **1.4.3**｜DSH **0.2.1-rc.5**（仓内 `LOCKED_VERSION=0.2.0-rc.2`）｜**codex-cli 0.162.1**｜claude **missing**｜kimi **missing**｜macOS **26.3** (25D125) arm64
> - 执行者：DeepSeek-V41-Flash（StudioNext 施工代理；本单 studio-dev-546 / ENG-2）
> - 署名（框架注入）：[StudioNext 开发公司·departments/研发部·程序二·1]
> - 性质：**只读探针＋真实 CLI 版本/帮助/解析面**；不启真实模型会话（无凭据且 app-server 在 seatbelt 下 EPERM）、不改生产码、不写宿主 profile、不发网络、不 git commit；仓库在本工位为只读，产物以 patch 交付
> - 依据：`docs/v2/12-技术细节-宿主平台与工作区绑定.md` §5.1/§5.3（PRB-24/25/26 唯一主表；§3.4 续跑形态表）、`docs/v2/17-验证矩阵与追溯.md` §五（PB-6 批次：入口＝无前置，出口＝三 CLI 形态判定；未证前 session_resume/降级档一律按不支持）、`docs/17-整体技术设计.md` §2（主循环七相位）与 §6（收割四要件）
> - 口径：状态三值（executed｜not-executed｜not-applicable）；**负向结论也用 executed**；未执行行不填「预期通过」；每行正向＋负向同验；原始日志逐字留存（仅脱敏本机绝对路径 → `<repo>`/`<home>`/`<tmp>`）

---

## 一、批次入口判定（先判门，再谈行）

| 入口要件 | 规范原文 | 实测 | 判定 |
|---|---|---|---|
| 无前置 | v2/17 §五 PB-6 入口「无前置（拟稿点独立）」 | 三 CLI 拟稿点在 `packages/adapters/src/{claude,codex,kimi}.ts`；本批可直接探 | **满足** |
| Claude CLI 在机 | PRB-24 形态前提 | `which claude` **EXIT=1**；`claude --version` **EXIT=null ERROR=ENOENT** | **不满足（CLI 缺失）** |
| Codex CLI 在机 | PRB-25 形态前提 | `codex --version` → `codex-cli 0.162.1`；`codex exec --help`/`codex exec resume --help` 原文可读 | **满足** |
| Kimi CLI 在机 | PRB-26 形态前提 | `which kimi` **EXIT=1**；`kimi --version` **EXIT=null ERROR=ENOENT** | **不满足（CLI 缺失）** |
| 真实模型会话 | 续跑/通道/成本腿 | 环境键名扫描未见 `OPENAI_API_KEY`/`ANTHROPIC_*`；`codex exec resume ...` 在 seatbelt 下 `failed to initialize in-process app-server client: Operation not permitted`（`log-02`） | **不可执行（环境）** |

**结论**：PB-6 **入口只对 codex 满足形态探测**；claude/kimi 不在机，三家的续跑/通道/成本腿均未取到。按 v2/17 §五与 v2/12 §5.1，本报告：

1. **不宣布 PB-6 通过**（三 CLI 形态判定只取到 codex 一条）；
2. **不宣布 Claude 权限面/降级档、Codex 续跑、Kimi `-S`/wire 任一成立**；
3. **取到一条负向发现**：codex 真机形态是 `codex exec resume <id>` 子命令，`codex exec --resume` 被 clap 拒收（EXIT=2）；仓内 adapter 仍构造 `--resume` 旗标形——`session_resume: true` 与真机不符（见 §三-PRB-25）。

---

## 二、逐行判定（状态总表）

- 环境指纹：`sha256:daccda4e3385594c6a07b3c63fd79aa13f40f9c3100bbf83d4605fef43ad545a`
- 采集时间戳：`2026-11-03T05:01:06Z`–`2026-11-03T05:02:47Z`（UTC）
- HEAD：`675192cfe1862ff65787b609d1e2d5b90da4c0b9`

| ID | 本行状态 | 方向 | 证据（原始日志） |
|---|---|---|---|
| PRB-24 | **not-executed** | CLI 缺失 | `log-01-prb-24-claude.txt` |
| PRB-25 | **not-executed** | 形态腿负向发现，续跑/通道/成本腿未执行 | `log-02-prb-25-codex.txt` |
| PRB-26 | **not-executed** | CLI 缺失 | `log-03-prb-26-kimi.txt` |

**统计（3 行）**：`executed` **0**｜`not-executed` **3**（PRB-24/25/26）｜`not-applicable` **0**。

> PRB-25 的 `not-executed` 是**整行判据**：主表正向是「续跑真接续（cwd 一致）＋通道生效」，本报告只取到**形态腿**（旗标形被拒、子命令形存在）与 adapter 形态不符的负向发现；续跑/AGENTS.md 通道/成本折算均未执行，故不升整行（与 pb-5 PRB-23「复合正向缺一即不升」同口径）。负向发现单列于 §三，不埋没。

---

## 三、逐行详录

### PRB-24 · Claude 拟稿点（**not-executed**）

- **主表行（v2/12 §5.3）**：形态＝权限面（权限模式/hooks）＋版本门控降级形态；正向＝降级通道实际生效且可观察；负向＝未证前 `agents_md` 降级档按不支持处理；锚＝备选 CLI 契约。
- **本行状态：`not-executed`**。claude CLI 不在机，无法跑 `detect()`、权限面或降级链。
- **已取到（环境事实，不构成本行证据）**——`log-01-prb-24-claude.txt`：
  - `which claude` → **EXIT=1**（无输出）；
  - `claude --version` → **EXIT=null ERROR=ENOENT**（命令不存在）；
  - `grep -n "claude" packages/adapters/src/agentconfig.ts` / `bindcard/cli-cards.ts` 只命中注册/卡片声明，**不是运行期能力证据**。
- **缺什么 / target**：claude CLI 在机＋`--version` 语料＋权限模式/hooks 面＋<2.1.277 降级链实测（P-07/B5 同面）；未证前 `agents_md` 降级档按不支持（v2/12 §3.4/§5.3 负向列）。

### PRB-25 · Codex 拟稿点（**not-executed**；形态腿负向发现）

- **主表行（v2/12 §5.3）**：形态＝`--resume` 旗标/子命令两形＋AGENTS.md 通道＋成本折算；正向＝续跑真接续（cwd 一致）＋通道生效；负向＝形态未证前 `session_resume` 按不支持；锚＝备选 CLI 契约。
- **本行状态：`not-executed`**（整行）。**形态腿已取到，且是负向发现**——`log-02-prb-25-codex.txt` 逐字：
  - `codex --version` → `codex-cli 0.162.1`；
  - `codex exec --help` 的 `Commands:` 段列 `resume  Resume a previous session by id or pick the most recent with --last`；
  - `codex exec resume --help` 的 `Usage:` 段：`codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]`；
  - `codex exec --resume` → `error: unexpected argument '--resume' found`，**EXIT=2**；
  - `codex exec resume 00000000-... probe --skip-git-repo-check` → **解析通过**，随后 `Error: failed to initialize in-process app-server client: Operation not permitted (os error 1)`，**EXIT=1**（失败在 app-server 初始化，不在参数解析）；
  - `grep -n "resume" packages/adapters/src/codex.ts` 命中 `:15` 头注（旗标/子命令两形待探）、`:116` `session_resume: true`、`:186-188` `args.push('--resume', task.resume.sessionId)`。
- **判读（负向）**：真机形态是 **`codex exec resume <id>` 子命令**；仓内 adapter 构造的是 **`codex exec --json --resume <id>` 旗标形**，会被 clap 拒收。故：
  1. `codex.ts` 的 `capabilities.session_resume: true` **与真机形态不符**；按 v2/12 §5.3 负向列「形态未证前 session_resume 按不支持」，在 adapter 改形并复验前应降为 `false`；
  2. 合并跑/relay-resume 依赖 `session_resume=true` 的分支（`engine/merge/merge-run.ts:186`、`engine/intents/relay-resume.ts:209`）会把 codex 误判为可续跑——**风险登记，不在本单改码**；
  3. target：adapter 改 `codex exec resume <id> [--json]` 形（`--json` 位置需按 0.162.1 帮助面复核）＋真机续跑复验；走批示/实现单，不在本单改契约/生产码。
- **缺什么（整行不升 executed）**：续跑真接续（前情携带、cwd 一致）＋AGENTS.md 通道生效＋成本折算；本机环境键名扫描未见 `OPENAI_API_KEY`/`ANTHROPIC_*`（环境日志只列键名），且 codex app-server 在 seatbelt 下 EPERM（`log-02` 的 `failed to initialize in-process app-server client: Operation not permitted`），真实会话不可执行。`~/.codex/auth.json` 未在本单采集面，不作断言。

### PRB-26 · Kimi 拟稿点（**not-executed**）

- **主表行（v2/12 §5.3）**：形态＝`-S` 形态＋wire 路径＋模式互斥；正向＝续跑＋事件流可用；负向＝拟稿按不支持；锚＝备选 CLI 契约。
- **本行状态：`not-executed`**。kimi CLI 不在机，`-S` 取值形态/wire 路径/模式互斥均不可探。
- **已取到（环境事实，不构成本行证据）**——`log-03-prb-26-kimi.txt`：
  - `which kimi` → **EXIT=1**；
  - `kimi --version` → **EXIT=null ERROR=ENOENT**；
  - `grep -n "resume\|-S\|wire" packages/adapters/src/kimi.ts` 只命中拟稿注记/构造，**不是真机形态证据**。
- **缺什么 / target**：kimi CLI 在机＋`-S` 两形实测（原生会话 id vs 文件路径）＋wire.jsonl 真实布局/时序＋`-p` 与 yolo/auto/plan 互斥实测；未证前 `session_resume`/wire 路径按不支持。

---

## 四、证据索引

| 文件 | 内容 | 支撑行 |
|---|---|---|
| `log-00-environment.txt` | DATE/HEAD/HOST/NODE/BUN/DSH/CODEX/CLAUDE/KIMI、仓库只读、git 不可用、8791/8788/8789 健康码、环境指纹 | 全批环境 |
| `log-01-prb-24-claude.txt` | `which claude`/`claude --version` 缺失、adapter/card 静态命中 | PRB-24 |
| `log-02-prb-25-codex.txt` | codex 版本、`exec --help`、`exec resume --help`、`--resume` 拒收 EXIT=2、子命令形解析通过后 EPERM、adapter resume 构造 grep | PRB-25 |
| `log-03-prb-26-kimi.txt` | `which kimi`/`kimi --version` 缺失、adapter 拟稿注记 | PRB-26 |

**复现命令**（仓根；本工位仓库只读，采集器输出目录用 `--out` 指到可写交付区）：

```bash
mise exec -- bun scripts/probe/run-pb246.mjs --repo <repo> --out <docs/probe> --batch 6
node scripts/verify/probe-ledger.mjs --root <repo>
```

---

## 五、结论与不宣布项

1. **PB-6 不通过**：三 CLI 形态判定只取到 codex 一条；claude/kimi 不在机。
2. **PRB-24 未执行**：claude 缺失；权限面/降级链无证据；降级档按不支持。
3. **PRB-25 未执行（形态腿负向）**：真机形态是 `codex exec resume <id>` 子命令；`codex exec --resume` EXIT=2；adapter `--resume` 旗标形与 `session_resume: true` 不符——adapter 改形/降声明前，codex 续跑按不支持。
4. **PRB-26 未执行**：kimi 缺失；`-S`/wire/模式互斥无证据。
5. 本报告不产出 PASS、不产出能力结论；探针通过只升到「该版本该形态观察一次」（v2/12 §0.5-3）。
