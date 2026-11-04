# GitHub required checks / 分支保护 / merge queue 配置清单（studio-dev-722）

> 执行者：**Lead（admin token）**；本文件只给命令，不写入任何 token。
> Token：`<workRoot>/credentials/github-studio-token.txt`（读取方式见下；**不回显**）。
> 仓库：`origin` = `https://github.com/2670961598/studio.git`（以 `git remote get-url origin` 为准；下用 `$OWNER/$REPO`）。
> 先文档后配置：docs/90-§十一 为方案正文；本文件为**可执行命令清单**。配置前先 `GET` 备份现状（§1），失败按 §6 回滚。

## 0. 前置变量（shell）

```sh
OWNER=2670961598 REPO=studio BRANCH=dev
TOKEN=$(cat <workRoot>/credentials/github-studio-token.txt)   # 只读入变量，不 echo
API="https://api.github.com/repos/$OWNER/$REPO"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
```

## 1. 先备份现状（必须；回滚依据）

```sh
gh api "$API/branches/$BRANCH/protection" > /tmp/github-protection-dev.before.json 2>/dev/null || echo "无现有保护"
gh api "$API" > /tmp/github-repo.before.json
```

## 2. 分支保护（REST；dev）

**要求（务实模式，默认；F3 制作人 2026-11-05 拍板；docs/90-§十一）**：
- required status checks：`required-checks`，`strict=false`（不强制基于最新 dev）；
- **管理员可绕过**：`enforce_admins=false`（制作人/管理员可直推应急）；
- 审批：`required_approving_review_count=0`（单成员组织无法自我批准 PR，**禁止设 1**）；
- **不强制线性历史**：`required_linear_history=false`（兼容现 dev merge commit）；
- 仍禁 force push/删除；对话解决。
- **严格模式**（管理员受限 + PR 审批≥1 + strict=true + 线性历史）见 **§7 附录**（需第二账号/机器人 + squash/rebase 流程）。

```sh
curl -sS -X PUT "$API/branches/$BRANCH/protection" "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{
    "required_status_checks": {"strict": false, "contexts": ["required-checks"]},
    "enforce_admins": false,
    "required_pull_request_reviews": {"required_approving_review_count": 0, "dismiss_stale_reviews": false},
    "restrictions": null,
    "required_linear_history": false,
    "allow_force_pushes": false,
    "allow_deletions": false,
    "required_conversation_resolution": true
  }' | tee /tmp/github-protection-dev.after.json
```

核对：

```sh
curl -sS "$API/branches/$BRANCH/protection" "${AUTH[@]}" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print({'strict':d['required_status_checks']['strict'],'contexts':d['required_status_checks']['contexts'],'linear':d['required_linear_history']['enabled'],'force_push':d['allow_force_pushes']['enabled'],'admins_bypass':not d['enforce_admins']['enabled'],'approvals_required':(d.get('required_pull_request_reviews') or {}).get('required_approving_review_count',0)})"
```

## 3. Merge queue（启用条件满足后再开；默认不开）

启用条件（docs/90-§十一）：①dev 保护已生效且 `required-checks` 连绿 ≥10 次；②团队 key registry 已导出
（`verify-commit-keys` 不再 skip）；③PR 并发 ≥5/日或主干排队明显。**当前阶段先不开。**

GitHub merge queue 需 **GraphQL**（REST 无独立字段；`enableMergeQueue` mutation）：

```sh
# 取 dev 的 branchProtectionRule id
RULE_ID=$(curl -sS https://api.github.com/graphql "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"query":"query($o:String!,$r:String!,$b:String!){repository(owner:$o,name:$r){branchProtectionRules(first:50){nodes{id pattern}}}}","variables":{"o":"'$OWNER'","r":"'$REPO'","b":"'$BRANCH'"}}' \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print([n['id'] for n in d['data']['repository']['branchProtectionRules']['nodes'] if n['pattern']=='$BRANCH'][0])")
curl -sS https://api.github.com/graphql "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"query":"mutation($id:ID!){enableMergeQueue(input:{branchProtectionRuleId:$id,mergeMethod:MERGE}){clientMutationId}}","variables":{"id":"'$RULE_ID'"}}'
```

关闭（回滚）：

```sh
curl -sS https://api.github.com/graphql "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"query":"mutation($id:ID!){disableMergeQueue(input:{branchProtectionRuleId:$id}){clientMutationId}}","variables":{"id":"'$RULE_ID'"}}'
```

## 4. 权限清单（admin token 需具备）

- **Classic PAT**：`repo`（私有仓库读写 + 分支保护）；如组织策略限制，`admin:repo_hook` 不需要。
- **Fine-grained PAT**：Repository permissions → **Administration: Read and write**（分支保护/merge queue）、
  **Contents: Read**（读仓库）；Metadata: Read（自动）。
- **Workflow 本身**：`permissions: contents: read`（`.github/workflows/required-checks.yml`），
  **不引用自定义 secret**；所有外部 token 仅用于本文件的手工 API 配置。
- 记录：本次配置使用的 token 指纹/到期时间由 Lead 记台账；不写入仓库。

## 5. 首次推送与验证

```sh
# 推 workflow 与代码（分支 dev；禁止 force push）
git push origin dev
# 看最近一次 check（需 token；公开仓库可 curl 匿名）
# 注意：首推/新分支时 GitHub push event 的 event.before 可能为全 0（before=0）——workflow 已回退用
#       HEAD~1..HEAD 计算 range（见 required-checks.yml），不会因空 range 漏检。
curl -sS "$API/commits/$BRANCH/check-runs" "${AUTH[@]}" | python3 -c "import json,sys;d=json.load(sys.stdin);print([(c['name'],c['status'],c['conclusion']) for c in d['check_runs']])"
# 本地等价一键
node scripts/ops/required-checks.mjs --repo . --range origin/dev...HEAD
```

## 6. 回滚（配置可逆）

```sh
# ① 关分支保护（删除；或 PUT 恢复 before 备份里的字段）
curl -sS -X DELETE "$API/branches/$BRANCH/protection" "${AUTH[@]}"
# ② 删 merge queue（若已开，见 §3 关闭 mutation）
# ③ 删 workflow 文件并提交（git rm .github/workflows/required-checks.yml && git commit）
# ④ 本地 required-checks 不参与运行时——删脚本/钩子即恢复原状（无 daemon/部署面依赖）
```

**影响面**：仅 GitHub 仓库治理面；不动 daemon/部署树/公司目录；workflow 失败只红 check，不改运行态。

## 7. 附录：严格模式（未来可选；需先满足前置）

前置：①已在组织内新增第二账号/机器人（能批准 PR）；②统一 squash/rebase 合并流程（dev 不再产生 merge commit）；
③团队 key registry 已导出，`verify-commit-keys` 稳定运行。满足后再执行：

```sh
curl -sS -X PUT "$API/branches/$BRANCH/protection" "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{
    "required_status_checks": {"strict": true, "contexts": ["required-checks"]},
    "enforce_admins": true,
    "required_pull_request_reviews": {"required_approving_review_count": 1, "dismiss_stale_reviews": true},
    "restrictions": null,
    "required_linear_history": true,
    "allow_force_pushes": false,
    "allow_deletions": false,
    "required_conversation_resolution": true
  }'
```

回滚：按 §6 恢复 before 备份或 `DELETE .../protection` 后重新应用务实模式（§2）。
