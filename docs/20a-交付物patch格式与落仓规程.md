# 20a · 交付物 patch 格式与落仓规程（studio-dev-578）

> 上位：docs/20-§四（分支与发布流程）／§十（留痕与审计）｜联读：docs/17-§2（主循环七相位）／§6（收割四要件）
> 依据：studio-dev-578「交付面 patch 必须 git 格式」；事故复盘 #530/#535/#537/#538（2026-11-03）
> 状态：现行（随本单落仓生效）｜判据类口径改动走批示流（docs/20-§九/§十三）；本文件只钉**交付证据形态**，不改任何冻结验收口径
> 一句话：**patch 由 git 生成（带 `index` blob 行）、头写 base commit、落仓先 `--3way`、自动合/转人工逐处留痕。**

---

## 一、为什么（实证根因，不推测）

plain unified diff（`diff -u`／复制树对比／自拼）没有 `index <old-blob>..<new-blob>` 行，git 拿不到 base blob：

```text
$ git apply --check --3way object-carriers-537.patch
error: repository lacks the necessary blob to perform 3-way merge.
Falling back to direct application...
error: patch failed: apps/daemon/src/assembly/records/serve-face.ts:0
error: apps/daemon/src/assembly/records/serve-face.ts: patch does not apply
```

实测（2026-11-03，本单复现）：#537 patch `diff --git`=0／`index`=0／`new file mode`=0 → `--3way` rc=1；
#535/#530 同 plain 形态。#566 虽带 `diff --git`+`new file mode`，但缺 `index` 行，`--3way` 同样退化为直贴。
后果：**纯上下文位移也平铺失败**，落仓退回/人工合并成为常态。「base 是 HEAD 祖先」救不了——缺的是格式，不是基线选择。

## 二、适用范围

- 一切 worker 交付到 `deliverables/` 的**代码/文档 patch**（含 rework 单）；
- 人工落仓与 daemon 落仓步（#496 设计位）共用同一格式判据，落仓侧不认自拼 diff；
- 不走 patch 的 `literal-edit`／`file-add` 工件（#496 v1）不受 §三/§四 约束，但落仓入口仍按 §六。

## 三、生成（只许 git 原生）

```bash
BASE=$(git rev-parse dev)                 # 或 origin/dev；必须是目标分支上的 commit
git switch -c work/studio-dev-XXX "$BASE"
# ……改动、自测……
git add -A
git diff --full-index "$BASE"..HEAD > deliverables/studio-dev-XXX.patch
# 或：git format-patch --full-index -1  （单提交交付）
```

- **必须** `--full-index`（40 hex blob，便于落仓侧核对对象是否存在；缩写也可 `--3way`，但 40 hex 是硬要求）。
- **禁止**：`diff -u`、`git diff --no-index`（路径出仓，不可落仓）、复制树逐文件对比、自拼 `---/+++` 头、手改 `index`/`@@` 行。
- 二进制/子模块 v1 不收（`--binary` 仅用于保留 git 形态，落仓侧拒收）。
- 生成后**不再修改** patch 字节；要改=重出并重算摘要。

## 四、形态判据（落仓侧逐条机械检查）

| 场景 | 必有行 |
|---|---|
| 修改 | `diff --git a/<p> b/<p>` ＋ `index <40hex-old>..<40hex-new> <mode>` |
| 新增 | 上两行 ＋ `new file mode 100644` ＋ `--- /dev/null` |
| 删除 | 上两行 ＋ `deleted file mode <mode>` ＋ `+++ /dev/null` |
| 改权限 | `old mode <m>` / `new mode <m>` |
| 改名 | `rename from <p>` / `rename to <p>`（可带 `similarity index`） |

判据：`grep -c '^diff --git ' == 文件数`、每个文件块恰一条 `^index [0-9a-f]{40}\.\.`、新增/删除文件行数与 `new/deleted file mode` 一致。

## 五、patch 头（必写 base）与交付前自测

头块置于第一个 `diff --git` 之前（git apply 忽略前置说明行）：

```text
# base-commit: <40 hex>
# base-branch: dev
# generated-at: 2026-11-03T07:20:00Z
# generated-by: [StudioNext 开发公司·departments/研发部·程序三·1]
# generator: git diff --full-index <base>..<work>
```

- `base-commit` 必须是**目标分支上真实存在的 commit**（40 hex），且是生成时点的最新 HEAD；写成「大概的基线」=不可信交付。
- 交付前自测（命令与 rc 写进 REPORT）：
  ```bash
  git apply --check deliverables/xxx.patch          # 主判据：rc=0（在 base 上零冲突）
  git apply --check --3way deliverables/xxx.patch   # 参考：rc=0 **且** 输出无 with conflicts/does not apply
  ```
  **rc 陷阱（实测 git 2.53）**：`--check --3way` 遇到语义冲突仍打印 `Applied patch ... with conflicts.` 而 **rc=0**——只看 rc 会误判为绿。终判以「实跑应用后 `git ls-files -u` 为空 + 无冲突标记」为准（§六）。
- **base 过期必须 rebase 到最新 HEAD 再出件**；禁止带漂移交付（rebase 冲突=语义冲突，先解决再出件并写明）。
- README／manifest 另记 `patchSha256`（交付字节摘要）与每文件 blob 表——patch 自身不能自含摘要。

## 六、落仓流程（第一步 `--3way`）

1. **收件核对**：`sha256sum` 与 manifest 一致；头 `base-commit` 为 40 hex；`git merge-base --is-ancestor <base> HEAD`（base 是祖先）。
2. **三路预检**：`git apply --check --3way <patch> 2>&1 | tee precheck.log`，判据三看：
   - 输出 `error: repository lacks the necessary blob` → **格式/对象退回**（重出，不带病落仓）；
   - 输出 `with conflicts` 或 `patch does not apply` → 语义冲突，转第 5 步人工；
   - 无以上字样且 rc=0 → 进入第 3 步。

   **不得只看 rc**：实测（git 2.53）`--check --3way` 遇冲突仍 rc=0，必须解析输出并以第 3 步实跑为终判。
3. **应用**：`git apply --3way --verbose <patch> 2>&1 | tee apply.log`（`--3way` 隐含 `--index`，冲突在 index 留 `U` 项，便于判定与解决）。
4. **自动合判定**：逐文件输出 `Applied patch <p> cleanly.` = 自动合；`Hunk #N succeeded at ... (offset X lines)`
   = 纯位移自动合；两者都进 `autoMerged`（`offset≠0` 的 hunk 单列 `offsetHunks`）。
5. **转人工判定**：`git ls-files -u` 列出的文件=冲突文件（配 `apply.log` 的 `<path>:<line>` 与文件内 `<<<<<<<` 标记）；
   逐处记 `path`／`hunk`／语义原因。**禁止**静默合错——`U` 项未清零、冲突标记未清不得继续。
6. **反向核验**：base 无漂移用 `git apply -R --check <patch>`；有漂移用 `git apply -R --check --3way <patch>`，
   以 rc=0 为准（漂移场景不得用平铺反查冒充）。
7. **权威树比对**：落仓树 vs 权威 patch 应用树 `diff -rq` 零差异；或逐文件 `git hash-object <p>` == patch 新侧 blob（更强）。
8. **门禁**：`mise exec -- bun run verify:v2` exit=0（失败集空）。
9. **digest 与提交**：verifier 出 `verified-tree digest`；Lead 按 digest 原样 commit，commit message 注明 digest。
10. **留痕**：写落仓记录（§六.1）+ 台账事件 + 归档原 patch。缺一不 commit。

### 六.1 落仓记录模板（`studio-next/landing-record/v2`）

```json
{
  "schema": "studio-next/landing-record/v2",
  "ticket": "studio-dev-578",
  "patch": {
    "path": "deliverables/studio-dev-578.patch",
    "sha256": "<64 hex>",
    "baseCommit": "<40 hex>",
    "baseBranch": "dev"
  },
  "apply": { "mode": "3way", "exit": 0, "fallback": "none" },
  "autoMerged": [
    { "path": "docs/20-工程总规程.md", "hunks": 2, "offsetHunks": [{ "hunk": 2, "offset": 5 }], "how": "3way-clean" }
  ],
  "manualConflicts": [
    { "path": "apps/daemon/src/x.ts", "hunk": "@@ -12,6 +12,9 @@", "line": 12, "semanticReason": "同一行语义相抵（双方改同一判断，取舍归人）" }
  ],
  "verify": { "reverseCheckExit": 0, "diffRq": "zero", "treeDigest": "sha256:<64 hex>" },
  "gate": { "command": "mise exec -- bun run verify:v2", "exit": 0, "failures": [] },
  "appliedAt": "2026-11-03T07:30:00Z",
  "appliedBy": "<落仓人署名>"
}
```

- `manualConflicts` 空数组=零语义冲突（真·纯漂移），不是省略字段。
- `fallback` 只允许 `none`；出现 `direct` 即降级，必须写明原因并按退回处理。
- `apply.exit`／`gate.exit`／`verify.*` 必须与 tee 日志一致，禁止补写。

## 七、冲突判定口径（自动 vs 人工）

| 情形 | 判定 | 处置 |
|---|---|---|
| 上下文行位移，内容可对上 | 自动合（`offsetHunks`） | 继续 |
| 双方改同一文件不同行/不同 hunk | 三路内容合（`how=3way-clean`） | 继续 |
| 双方改同一行且语义相抵 | **语义冲突** | 转人工，记 `manualConflicts` |
| base blob 缺失（plain diff/浅克隆/GC） | 格式缺陷 | 退回重出，不得平铺硬贴 |
| 冲突标记未清/部分文件贴失败 | 失败 | 停手，不 commit |

**禁止**：`-C0`／`--ignore-whitespace`／`--inaccurate-eof`／`--reject`／`git checkout --theirs` 等「让它过去」的开关；禁止先平铺再用编辑器手补（=绕过证据）。

## 八、红→绿验证（本单实测 2026-11-03，git 2.53，可复跑）

```bash
# 红：plain diff 无 blob → 3way 不可用（事故件 object-carriers-537.patch，工位归档）
git apply --check --3way object-carriers-537.patch            # rc=1: lacks the necessary blob
# 绿：git 格式 patch → 旧 base 上 clean
git apply --check deliverables/studio-dev-578.patch           # rc=0
# 漂移绿：另一单改了 hunk 上下文行，平铺失败、--3way 自动合
git apply --check            deliverables/studio-dev-578.patch  # rc=1: patch does not apply
git apply --check --3way     deliverables/studio-dev-578.patch  # 输出 cleanly（注意：冲突时 rc 也可能为 0）
# 语义红：同一锚点另一单插入不同条款 → 实跑 rc=1、index 留 U 项、文件留冲突标记
git apply --3way deliverables/studio-dev-578.patch             # rc=1, U docs/20-工程总规程.md
```

验证记录（命令/rc/树摘要）随交付归档；**不伪造 exit=0**（沙箱 EPERM 等环境限制如实申报）。

## 九、不做什么

- 不引入新合并工具/三方库（只用 git 原生能力）；
- 不改 guard 阈值、不调基线、不动冻结验收口径；
- 不改业务代码、不动在途单、不手改 patch 头；
- 不用 `--reject`/`-C0`/`--ignore-whitespace` 换「落得下去」的假绿。
