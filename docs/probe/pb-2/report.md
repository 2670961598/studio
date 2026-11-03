# PB-2 投影与秘密 · 真机探针报告（PRB-07/08/09）

> **头注**
> - 日期：2026-11-03（探针采集窗口 `2026-11-03T05:01:06Z`–`2026-11-03T05:02:47Z` UTC；本报告落盘 2026-11-03）
> - git HEAD：`675192cfe1862ff65787b609d1e2d5b90da4c0b9`（分支 `dev`）
> - 工具链/宿主：node **v24.21.0**（`mise exec --`）/ bun **1.4.3**｜DSH **0.2.1-rc.5**（仓内 `LOCKED_VERSION=0.2.0-rc.2`，版本漂移如实登记）｜codex **0.162.1**｜macOS **26.3** (25D125) arm64
> - 执行者：DeepSeek-V41-Flash（StudioNext 施工代理；本单 studio-dev-546 / ENG-2）
> - 署名（框架注入）：[StudioNext 开发公司·departments/研发部·程序二·1]
> - 性质：**只读探针＋仓内真实纯函数模块**；不启 daemon、不改生产码、不写宿主 profile、不发网络、不 git commit；仓库在本工位为只读（seatbelt 写域白名单不含仓根），产物以 patch 交付（见 `deliverables/plan.md`）
> - 依据：`docs/v2/12-技术细节-宿主平台与工作区绑定.md` §5.1/§5.2/§5.3（PRB- 唯一主表与旧号映射）、`docs/v2/17-验证矩阵与追溯.md` §五（PB-2 批次：入口＝MIG-07 投影生成器＋秘密 catalog 产物；PRB-08 是 PB-3 HCL-2 锚前置）、`docs/17-整体技术设计.md` §2（主循环七相位）与 §6（收割四要件）
> - 口径：状态三值（executed｜not-executed｜not-applicable）；**负向结论也用 executed**；未执行行不填「预期通过」；每行正向＋负向同验；原始日志逐字留存（仅脱敏本机绝对路径 → `<repo>`/`<home>`/`<tmp>`，探针秘密值不入日志）

---

## 一、批次入口判定（先判门，再谈行）

| 入口要件 | 规范原文 | 实测 | 判定 |
|---|---|---|---|
| MIG-07 投影生成器 | v2/17 §五 PB-2 入口「**MIG-07** 投影生成器」 | `packages/core/src/prm/compile-projection.ts:224` `compileProjection`、`:293` `projectionDigest`、`:307` `projectionGate` 在；纯函数可执行（`log-02` 首个命令） | **满足（组件级）** |
| 秘密 catalog 产物 | v2/17 §五 PB-2 入口「秘密 catalog 产物（PRB-07 需 catalog）」 | `packages/gateway/src/catalog.ts` `createCredentialCatalog`、`catalog-entry.ts` 形状闸在；`register/rows/supply` 实测可跑（`log-01`） | **满足（组件级）** |
| 投影运行时接线 | v2/17 §五 PB-2 出口「fail-closed 拒载证据（篡改一字节→拒载＋不 spawn）」 | `grep -rn "compileProjection\|projectionGate\|projectionDigest" apps packages --include=*.ts` 生产引用只有契约端口声明与 core 自身；`loadProjection/ProjectionLoader/verifyProjection` **零命中**（`log-02`/`log-03`） | **不满足** |
| 签名/验签通道 | v2/15 SEC-SIG-04；v2/12 §1.6 双重校验 | `grep -rn "verifySignature\|verifyProjection\|SEC-SIG-04"` 只命中 `compile-projection.ts` 的两处**自述注释**（“通道未建，PRB-08 未执行”）；无验签实现（`log-02`） | **不满足** |

**结论**：PB-2 **批次入口部分满足**（生成器＋catalog 两个产物在，运行时加载/验签/比对不在）。按 v2/17 §五与 v2/12 §5.1，本报告：

1. **不宣布 PB-2 通过**；
2. **不宣布投影防线成立**（PRB-08 未执行；PRB-07 只到组件级且取到负向发现）；
3. **不解除 PB-3 的 PRB-08 前置阻断**（PB-3 HCL-2 锚仍缺前置）。

---

## 二、逐行判定（状态总表）

- 环境指纹：`sha256:daccda4e3385594c6a07b3c63fd79aa13f40f9c3100bbf83d4605fef43ad545a`
- 采集时间戳：`2026-11-03T05:01:06Z`–`2026-11-03T05:02:47Z`（UTC）
- HEAD：`675192cfe1862ff65787b609d1e2d5b90da4c0b9`

| ID | 本行状态 | 方向 | 证据（原始日志） |
|---|---|---|---|
| PRB-07 | **executed** | 正负同验（组件级） | `log-01-prb-07-secret-context.txt` |
| PRB-08 | **not-executed** | 仅取到 digest 篡改腿 | `log-02-prb-08-projection-signature.txt` |
| PRB-09 | **not-executed** | 仅取到静态面 | `log-03-prb-09-runtime-drift.txt` |

**统计（3 行）**：`executed` **1**（PRB-07，负向发现）｜`not-executed` **2**（PRB-08、PRB-09）｜`not-applicable` **0**。

> 与 v2/12 §5.3 主表现状对账：主表三行均记「未执行」；本批把 PRB-07 推进到 **executed（负向发现）**，PRB-08/09 仍 **not-executed**。主表状态回写属文档面，按「不改契约面」边界不在本单自行改写，登记待 Lead/制作人统一回写。

---

## 三、逐行详录

### PRB-07 · 秘密不进上下文（**executed**，正负同验；组件级）

- **主表行（v2/12 §5.3）**：目的＝秘密不进上下文；形态＝投影只有类别、扫描全部导出文本；正向＝导出物无秘密值；负向＝注入探针秘密验证不出现在日志/证据；锚＝秘密段生效。
- **本行状态：`executed`（负向发现）**。探针秘密值由采集器随机生成并经 `STUDIO_PROBE_SECRET` 只注入子进程；**值本体不入任何日志**（`run-pb246.mjs` 对原始输出做独立泄漏扫描）。
- **正向（合法类别路径）**——`log-01-prb-07-secret-context.txt` 逐字输出：
  - `LEGIT_CONTAINS_SECRET=0`：合法输入 `secretTypes=['per_task_shortlived']` 生成的投影 JSON 不含探针秘密值；
  - `LEGIT_SANDBOX_SOURCE_REFS=["per_task_shortlived","root:probe"]`：sandbox 段只出现类别引用与沙箱根引用；
  - `CATALOG_REGISTER_RESULT=ok`、`CATALOG_ROWS_CONTAINS_SECRET=0`：凭据目录登记只产 `REC-AUTH-04` 引用侧行；
  - `HANDLE_KEYS=["credential","expiresAt","handleId","issuedAt","singleUse"]`、`HANDLE_HAS_VALUE_FIELD=0`：短时句柄无值位；
  - `CATALOG_VALUE_REF_RESULT=err` / `CATALOG_VALUE_REF_SUBCAUSE=catalog-value-rejected`：值形态 `logicalReference` 被目录形状闸拒收；
  - `CATALOG_VALUE_KEY_RESULT=err` / `CATALOG_VALUE_KEY_SUBCAUSE=catalog-value-rejected`：未知值形态键（`rawValue`）被拒收。
- **负向（注入值形态）**：
  - `CASE=injected-value RESULT=ok`；
  - `INJECTED_VALUE_PRESENT=1`；
  - `INJECTED_VALUE_PATHS=["$.segments.sandbox.sourceRefs[1]"]`。
  - **判读**：把探针秘密值冒充 `secretTypes` 类别引用传给生成器时，`readRefList` 只做「非空/无首尾空白/非 latest」检查，**不校验类别形状**；值被原样复制进 `sandbox.sourceRefs`。即：**生成器自身不机械保证「投影只有类别」**，该不变量目前依赖上游输入纪律。
- **target（不在本单修，走批示/实现单）**：在 `normalizeInput` 对 `secretTypes` 加类别白名单（contract `SecretType` 五型）或强制逻辑引用前缀（如 `secret:`）；修前不得宣称「投影只有类别」为机械成立。
- **边界（不升为能力证明）**：本行只跑组件级真实模块，**未接生产链路**（`compileProjection` 生产引用=0）；不宣称投影防线、不宣称秘密段在运行时生效（v2/12 §0.5-3）。采集器对子进程原始输出做独立泄漏扫描：本次日志中无 `LEAK_SCAN=FOUND`（即未命中）。

### PRB-08 · 投影摘要/签名校验 fail-closed（**not-executed**）

- **主表行（v2/12 §5.3）**：形态＝篡改一字节；正向＝拒载＋不 spawn；负向＝过期清单一律拒（不降级宽权限）；锚＝§1.6 双重校验。
- **本行状态：`not-executed`**。整行判据「拒载＋不 spawn」需要投影加载器/启动器与验签通道，本仓均未建。
- **已取到（不构成本行通过）**——`log-02-prb-08-projection-signature.txt`：
  - `DIGEST_MATCH=0`：生成投影后改 `segments.identity.sourceRefs[0]` 一个字符，`projectionDigest` 复算与原 `digest` 不一致——**摘要复算能检出单字节篡改**；
  - `TAMPERED_GATE_LAUNCHABLE=1`：同一篡改件过 `projectionGate` 仍 `launchable=true`——与函数自述一致（生成期门禁只回答「清单是否缺策略面」，**不承担摘要/签名校验**）；
  - `grep -rn "verifySignature\|verifyProjection\|SEC-SIG-04"` 只命中 `compile-projection.ts:30,305` 的自述注释；`loadProjection/ProjectionLoader/verifyProjection` **零命中**；
  - `grep -rn "signature" packages/gateway/src packages/core/src` 命中 `gateway/signature.ts`（**署名**四段落款）与 `wkey` MAC 校验，**均非投影签名/验签通道**——不得拿署名或 wkey 代证 PRB-08。
- **缺什么 / target**：SEC-SIG-04 签名封套＋信任锚＋单调代次；投影加载器（读清单→验签→摘要/有效期/引用校验→拒载且不 spawn）；过期清单拒绝路径；真实启动器观测。**PRB-08 未过 → PB-3 HCL-2 锚前置仍缺**（v2/17 §五）。

### PRB-09 · 投影与运行时比对（**not-executed**）

- **主表行（v2/12 §5.3）**：形态＝生成后手工改宿主配置；正向＝检出 drift；负向＝差异项逐条列出（非「有差异」一句）；锚＝运行时偏离（13 态）。
- **本行状态：`not-executed`**。无 PRM 策略投影的运行时加载/比对器，也无宿主配置读取面。
- **已做（静态面，不构成本行证据）**——`log-03-prb-09-runtime-drift.txt`：
  - `grep -rn "projection.*drift\|drift.*projection\|reconcileProjection\|compareProjection"` 命中 `apps/daemon/src/engine/records/projection.ts:74 reconcileProjection`——**这是「记录面 ↔ 事件面」对账**（docs/17-§2 记录族；对 REC-WORK-01/06/EVD-01 与 events 做 missing/duplicate/undeterminable 判定），**不是 PRM 策略投影与宿主配置的比对**，不得代证 PRB-09；
  - `packages/company/src/projection/issues.ts:16 legacyFaceDrift` 是公司投影面 drift 词，同样不是 PRM 策略投影；
  - `grep -rn "drift"` 其余命中 `sentinel/sentinels.ts` 的 **status-set drift** 与 `control/hot-reload.ts` 的 **trust-drift**——平台状态/重载信任面，不是策略投影 drift；
  - `grep -rn "loadProjection\|ProjectionLoader"` **零命中**；`ls packages/core/src/prm` 只有生成器/输入/spec 三件，无 PRM 比对器。
- **缺什么 / target**：PRM 策略投影加载器＋运行时暴露面观测＋逐项差异输出（13 态）＋手工改宿主配置的夹具；先有 PRB-08 的加载/验签，才谈运行时比对。

---

## 四、证据索引

| 文件 | 内容 | 支撑行 |
|---|---|---|
| `log-00-environment.txt` | DATE/HEAD/HOST/NODE/BUN/DSH/CODEX/CLAUDE/KIMI、仓库只读、git 不可用、8791/8788/8789 健康码、环境指纹 | 全批环境 |
| `log-01-prb-07-secret-context.txt` | 生成器合法/注入两条路径、catalog 登记/供给/值拒收、日志泄漏扫描 | PRB-07 |
| `log-02-prb-08-projection-signature.txt` | digest 篡改复算、`projectionGate` 对篡改件、验签/加载器静态 grep | PRB-08 |
| `log-03-prb-09-runtime-drift.txt` | 投影 drift/loader 静态 grep、daemon 既有 drift 面区分 | PRB-09 |

**复现命令**（仓根；本工位仓库只读，采集器输出目录用 `--out` 指到可写交付区）：

```bash
STUDIO_PROBE_SECRET="probe-$(openssl rand -hex 16)" \
  mise exec -- bun scripts/probe/run-pb246.mjs --repo <repo> --out <docs/probe> --batch 2
node scripts/verify/probe-ledger.mjs --root <repo>
```

---

## 五、结论与不宣布项

1. **PB-2 不通过**：入口只有生成器＋catalog 两个组件产物，运行时加载/验签/比对未建；出口「篡改一字节→拒载＋不 spawn」未取到。
2. **PRB-07 executed（负向发现）**：合法类别路径不泄漏；但生成器不校验 `secretTypes` 类别形状，注入值形态会原样进入 `sandbox.sourceRefs`——「投影只有类别」目前不是机械不变量。
3. **PRB-08 未执行**：digest 能检出篡改，但无签名/验签通道、无加载器、无 spawn 闸；**不得宣称投影防线成立**。
4. **PRB-09 未执行**：无投影运行时比对器；daemon 既有 status-set/hot-reload drift 不得代证。
5. **PB-3 阻断未解除**：PRB-08 仍是 PB-3 HCL-2 锚的前置（v2/17 §五）。
6. 本报告不产出 PASS、不产出能力结论；探针通过只升到「该版本该形态观察一次」（v2/12 §0.5-3）。
