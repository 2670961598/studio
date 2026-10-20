# panel vendor —— 前端产物进仓（死文件，零构建直引）

> 依据：docs/37-§5.1 路线 I（vendor 进仓、零构建直引、不依赖公网 CDN）+ DEV-1 方案 §3
> （三件 vendor——docs/37-§6 原文「四件」为勘误，见 DEV-1 §12 回填单）。

## 是什么

`packages/panel/vendor/` 是监控页（:8787）前端壳的**进仓静态产物**：Vue / Naive UI / ECharts
三个 npm 包的官方 dist 单文件。页面经 importmap 直引（`src/shell.ts` 的 `PANEL_IMPORTMAP`），
无构建链、无运行时 npm 依赖、无公网 CDN 依赖——面板能不能开不押在任何外网可达性上。

| 库 | 版本 | 文件 | 字节 | 许可证 |
|---|---|---|---|---|
| Vue | 3.5.44 | `vue.esm-browser.prod.js` | 175,436 | MIT（`LICENSES/vue-MIT.txt`） |
| Naive UI | 2.45.3 | `naive-ui.prod.mjs` | 2,722,579 | MIT（`LICENSES/naive-ui-MIT.txt`） |
| ECharts | 6.1.0 | `echarts.esm.min.js` | 1,121,654 | Apache-2.0（`LICENSES/echarts-Apache-2.0.txt`） |

合计 4,019,669 字节 ≈ 3.83 MiB（gzip 后约 1,008,239 字节）。

产物形状（选型时实查，升级时复核）：

- `vue.esm-browser.prod.js` 是 **full build（含 runtime compiler）**——前端组件允许 `template`
  字符串写法；若换 `vue.runtime.esm-browser.prod.js`，所有模板必须改 render 函数。
- `naive-ui.prod.mjs` 全文件裸导入**仅 `vue` 一个**——importmap 三项映射即够，无需额外
  CSS 文件（Naive UI 是 CSS-in-JS）或 `@css-render` 等裸包。
- `echarts.esm.min.js` 已内联 zrender，**零裸导入**。

## 升级步骤

1. 改 `vendor.lock.json`（version/file/bytes/sha256/source——sha256 用
   `shasum -a 256 <文件>` 实算，**不要抄上游文档**）。
2. 跑取件脚本（零依赖，Node ≥ 24）：

   ```bash
   node packages/panel/scripts/vendor-pull.mjs
   ```

   脚本按 lock 的精确版本 URL 下载 → 校验字节数与 SHA-256 → 不一致即非零退出且**不覆盖
   旧文件**；一致才写入 `vendor/`。
3. 同步换 `src/shell.ts` 里 `PANEL_IMPORTMAP` 的 `?v=<version>`（两处写死是刻意的：页壳
   静态、不引入运行时读 lock 的 IO；忘了换只会丢缓存失效，页面仍可用旧缓存直到重启）。
4. 跑回归：`tsc --noEmit` + `vitest run packages/panel/test` + 真机冒烟（`/vendor/*` 三件
   200、监控页无 importmap 解析错误）。

## 运行时纪律

- `vendor/` 是**死文件**：不进 `node_modules`、不进 tsconfig 门禁、不被任何 `src/**` import；
  唯一消费方是 `src/static.ts` 的 `/vendor/:file` 白名单路由（进程内缓存 ~3.8 MiB）。
- 只在**升级时**手动联网取件；面板运行时零网络。
- 许可证文本随产物入库（`LICENSES/`），升级时一并核对许可未变。
