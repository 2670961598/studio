# 发布审批模板与填写纪律（studio-dev-720·REL-1 发布岗）

> 依据：`docs/90-§七`（发布控制面）、`scripts/ops/release-request.schema.json`（三形状冻结面）、
> `ops/release/README.md`（命令/回滚/证据）、`docs/90-§7.1`（REL-1 职责边界）。
> 本模板是**填写指引**，不是审批事实本身；审批事实=审批人签发的 approval JSON + `commentRef` 指向的留痕。

## 一、三件套（发布必须四件：request + approval + record + tag）

| 件 | 文件 | 谁产出 | 工具 |
|---|---|---|---|
| request | `release-request.json` | 执行者/REL-1 准备（**REL-1 不执行**） | `release.mjs request` |
| approval | `release-approval.json` | **审批人**（制作人或授权代理人）亲签 | 人工填写（字段见 §三） |
| release record | `docs/releases/<version>.md` | 执行者 `execute` 自动写（REL-1 只核草稿） | `release.mjs execute` |
| tag | 本地 annotated `git tag -a <version>` | 执行者 `execute`/`tag`（默认不 push） | `release.mjs execute/tag` |

> REL-1 在 P0 只准备 request/record 草稿与 checklist；**approval 必须审批人亲签，REL-1 不得代签**。

## 二、request 字段（`studio-next/release-request/v1`）

| 字段 | 必填 | 口径 |
|---|---|---|
| `schema` | ✓ | 固定 `studio-next/release-request/v1` |
| `version` | ✓ | 版本串（`^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$`；须符合 docs/90-§7.4 版本纪律） |
| `targetCommit` | ✓ | 部署目标 commit（40 hex；须为已验证 commit） |
| `tree` | ✓ | `git rev-parse <targetCommit>^{tree}` |
| `previousCommit` | ✓ | 部署树上一 commit 或 `null` |
| `gatesDigest` | ✓ | `sha256("verify:v2@<commit>:" + verify:v2 输出最后一条 PASS 行)`——**只从真实输出取** |
| `createdAt` | ✓ | ISO-8601（UTC） |
| `requestedBy` | ✓ | 操作者身份（工号/账号；不得假名） |
| `notes` |  | 变更摘要/风险说明（可空） |

## 三、approval 字段（`studio-next/release-approval/v1`）

| 字段 | 必填 | 口径 |
|---|---|---|
| `schema` | ✓ | 固定 `studio-next/release-approval/v1` |
| `version` | ✓ | 与 request **全等** |
| `targetCommit` | ✓ | 与 request **全等** |
| `tree` | ✓ | 与 request **全等** |
| `gatesDigest` | ✓ | 与 request **全等**（禁止用自己重算/改写后的值替代） |
| `approver` | ✓ | 审批人实名（制作人/授权代理人；**非 REL-1、非执行者自签**） |
| `approvedAt` | ✓ | ISO-8601；不早于 request.createdAt、不晚于当前时间（时钟异常须说明） |
| `expiresAt` | ✓ | ISO-8601；建议 ≤24h（发布窗口内有效；过期=拒，不得延期复用） |
| `commentRef` | ✓ | 审批留痕引用（Taiga 评论/批次号等可追溯定位；空=拒） |

## 四、填写纪律（违反任一条=发布流程未完成）

1. **全等绑定**：version/targetCommit/tree/gatesDigest 四项与 request 必须**逐字节相等**；任一项不等 `execute` exit 2 且不部署。
2. **审批不可代签**：approver 须为制作人或其书面授权代理人；REL-1/执行者不得自批；`commentRef` 必须能定位到真实批示。
3. **gatesDigest 不可伪造**：必须来自真实 `verify:v2` 输出文本（`--gates-file`），禁止手写/重算/截断；错误 commit、错误树的 gates 不得复用。
4. **过期即废**：`expiresAt` 到期后 approval 作废；变更任一绑定项须**重新 request + 重新审批**（不得改 approval 文件复用）。
5. **执行与准备分离**：REL-1 只准备材料；`execute` 由授权操作者执行；`git tag`/`push` 同属执行权（push 默认关，已推送 tag 重发需制作人批，禁止 force push）。
6. **记录必留**：`docs/releases/<version>.md` 与本地 tag 缺一=发布未完成；回滚走 `rollback` 写 `docs/releases/rollback-<sha>.md`。

## 五、审批文件示例（approval.json）

```json
{
  "schema": "studio-next/release-approval/v1",
  "version": "v0.2.0",
  "targetCommit": "<40-hex-sha>",
  "tree": "<tree-sha>",
  "gatesDigest": "<sha256-hex>",
  "approver": "制作人",
  "approvedAt": "2026-11-04T12:00:00.000Z",
  "expiresAt": "2026-11-05T12:00:00.000Z",
  "commentRef": "Taiga #<ticket> comment <id>"
}
```

## 六、校验与执行（授权操作者侧）

```sh
# 绑定校验（失败 exit 2、零 deploy 调用）
node scripts/ops/release.mjs approve-check --request /tmp/release-request.json --approval /tmp/release-approval.json --json
# 执行（approve-check 通过 → deploy.mjs deploy → 记录 → 本地 tag；默认不 push）
node scripts/ops/release.mjs execute --repo <repo> --deploy <deploy-tree> \
  --request /tmp/release-request.json --approval /tmp/release-approval.json --json
```

## 七、REL-1 检查清单（准备面；不含执行）

- [ ] `verify:v2` PASS 证据为**该 targetCommit** 的真实输出；gatesDigest 按公式计算并复核。
- [ ] 部署树 `deploy.mjs status` 与 state 一致、clean；`previousCommit` 与 state 对得上。
- [ ] request 字段齐全、version 符合 §7.4；record 草稿字段（commit/tree/gatesDigest/approver/releasedAt/deploy）可填。
- [ ] approval 由审批人亲签、未过期、`commentRef` 可定位；四项绑定全等。
- [ ] tag 计划（annotated、默认不 push）与回滚目标（上一 commit）已列明。
- [ ] 发现任一不一致：**停手升级**（宰相/制作人），不自行放行、不伪造证据。
