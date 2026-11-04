# 公钥 registry 投影（studio-dev-721/722）

本目录是**公钥+元数据投影**，不是私钥托管目录（私钥在公司目录
`<companyDir>/docs/keys/<工号>.key`，600，永不入 git）。

- 由 `scripts/ops/export-key-registry.mjs --keys-dir <companyDir>/docs/keys` 导出：
  只含 `<工号>.pub`（公钥）与 `<工号>.json`（id/name/email/指纹），**绝不复制 `.key`**。
- 用途：GitHub Actions required check 中的 `verify-commit-keys --range`（CI 读不到公司外部目录）。
- 重新导出后需提交本目录变更；校验口径见 `docs/90-§九`/`§十一`。
- 团队 key 尚未生成/导出时本目录为空 → required-checks 将 `verify-commit-keys` 判为 **skip**；
  导出并提交后自动生效。Lead 可在仓库变量/CI env 设 `REQUIRE_COMMIT_KEYS=1` 打开严格模式。
