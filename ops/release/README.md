# 发布控制面（release.mjs）· studio-dev-719

> 依据：docs/90-§七（发布控制面）、施工书 §2。P0；本目录只放说明与证据口径，
> 脚本在 `scripts/ops/release.mjs`（纯 Node 标准库；**只 spawn** 调 `deploy.mjs` CLI，不 import/不改它）。

## 一、角色与边界

- **执行者**（授权操作者）：采集真实 gates 输出、生成 request、执行 execute/rollback。
- **审批人**（制作人或其授权代理人）：对 request 的 version/targetCommit/tree/gatesDigest 全等批准，
  提供 approval 文件（含 `approver/approvedAt/expiresAt/commentRef`）。
- **deploy.mjs**：唯一部署执行面（check/deploy/status；708/717 维护），本工具**不修改**它。
- **daemon/公司目录/契约**：本工具不读写；不改端口/岗位/org-config。

## 二、命令（冻结契约见 release.mjs 头注；exit codes 0/1/2/3/4/5）

```sh
# 1) plan：解析目标 commit/tree、deploy 现状、checklist（gates 可选）
node scripts/ops/release.mjs plan --repo <repo> --deploy <deploy-tree> --ref <sha> --version <v> \
  --gates-file <verify-v2-output.txt> --json

# 2) request：固化请求（gatesDigest=sha256("verify:v2@<commit>:"+verify 最后一条 PASS 行)）
node scripts/ops/release.mjs request --repo <repo> --deploy <deploy-tree> --ref <sha> --version <v> \
  --out /tmp/release-request.json --gates-file <verify-output.txt> --by <操作者> [--notes "..."]

# 3) approve-check：请求↔审批全等绑定 + 未过期（失败 exit 2，不部署）
node scripts/ops/release.mjs approve-check --request /tmp/release-request.json --approval /tmp/release-approval.json --json

# 4) execute：approve-check 通过 → spawn deploy.mjs deploy → docs/releases/<v>.md → 本地 annotated tag（默认不 push）
node scripts/ops/release.mjs execute --repo <repo> --deploy <deploy-tree> \
  --request /tmp/release-request.json --approval /tmp/release-approval.json --json

# 5) 回滚：spawn deploy.mjs deploy --ref <to>，写 docs/releases/rollback-<to>.md
node scripts/ops/release.mjs rollback --repo <repo> --deploy <deploy-tree> --to <prev-sha> [--version <v>] --json

# 6) 记录/tag/状态（独立可复跑）
node scripts/ops/release.mjs record --version <v> --commit <sha> --tree <tree> --request ... --approval ... [--out docs/releases/<v>.md]
node scripts/ops/release.mjs tag --version <v> --commit <sha> [--dry-run] [--push]
node scripts/ops/release.mjs status --repo <repo> --deploy <deploy-tree> --json
```

## 三、审批文件（approval.json）

```json
{
  "schema": "studio-next/release-approval/v1",
  "version": "v0.2.0",
  "targetCommit": "<sha>",
  "tree": "<tree-sha>",
  "gatesDigest": "<sha256-of-verify:v2@commit:lastPASS>",
  "approver": "制作人",
  "approvedAt": "2026-11-04T12:00:00.000Z",
  "expiresAt": "2026-11-05T12:00:00.000Z",
  "commentRef": "Taiga comment #..."
}
```

绑定规则：version/targetCommit/tree/gatesDigest 与 request **全等**；`expiresAt` 过期=拒；`approver` 非空。
不匹配 → exit 2 且**不调用 deploy**。三形状 JSON Schema 见 `scripts/ops/release-request.schema.json`。

## 四、gatesDigest（不伪造）

`gatesDigest = sha256("verify:v2@<commit>:" + <verify:v2 输出最后一条含 PASS 的行>)`。
执行者必须提供真实命令输出（`--gates-file` 或 `--gates-line`）；本工具**不**自己跑 verify、不猜。
`gatesDigest` 写进 request/approval 后，execute 前全等校验——错 commit/错树/错门禁无法放行。

### 4.1 已批可选旗标与默认行为（Lead 2026-11-04 批准）

| 旗标 | 语义 | 默认 |
|---|---|---|
| `--gates-file <f>` / `--gates-line <s>` | 真实 gate 证据输入（verify:v2 输出文本）；用于防 gatesDigest 伪造 | plan=可选（缺→checklist pending，gatesDigest=null）；request=**必需**（缺失即 exit 1） |
| `--push` | 显式推送 annotated tag 到 origin | **默认不推**；execute/tag 输出 `git -C <repo> push origin <tag>` 命令 |
| `--no-record` / `--no-tag` | 演练/单测跳过 record 或 tag | **默认不跳**：`execute` 默认行为 = **部署 + 写 `docs/releases/<v>.md` + 本地 annotated tag（不 push）** |

其余命令/参数/输出形状严格按施工书冻结面；三个旗标不改变默认链路与审批绑定语义。

## 五、证据与记录

- 发布记录：`docs/releases/<version>.md`（含 JSON 代码块：commit/tree/gatesDigest/approver/releasedAt/deploy）。
- 回滚记录：`docs/releases/rollback-<to>.md`（含 rolledBackTo/fromCommit/deploy.health）。
- tag：本地 annotated tag `git tag -a <version> -m "release ..."`；**默认不 push**，execute 输出 push 命令；
  `--push` 显式才推（已推送 tag 的重发需制作人批，禁止 force push）。
- 部署事实仍以 `deploy.mjs` 的 state（`<deploy>.deploy-state.json`）为准；本工具不复制/不改写 state。

## 六、回退

删除 `scripts/ops/release.mjs`/`release-lib.mjs`/`release-request.schema.json`/本 README/`docs/releases` 记录，
回滚 docs/90-§七；无运行时依赖（daemon 不接触本工具）。已打 tag 本地删除；已 push tag 走制作人批（不 force）。
