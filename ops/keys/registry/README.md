# 公钥 registry 投影（studio-dev-722）

本目录是 **公钥+元数据** 投影，由 `scripts/ops/export-key-registry.mjs`
从公司目录 `<companyDir>/docs/keys` 导出，供 CI/GitHub Actions 的 `verify-commit-keys` 使用。

- 只含 `<工号>.pub`（公钥）与 `<工号>.json`（id/name/email/指纹）；**私钥 `.key` 永不入仓**；
- 重新导出：`node scripts/ops/export-key-registry.mjs --keys-dir < companyDir>/docs/keys `（改动需提交）；
- 校验口径见 docs/90-§九（每人 key 与提交签名）与 docs/90-§十一（CI/required checks）。
