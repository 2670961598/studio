# workbench-core (vendored)

Workbench `packages/issues` + `packages/collab` 的**离线源码快照**（Phase0 PoC）。

- 用法：`import { issues, collab } from './vendor/workbench-core/index.ts'`（调用方经薄包装；不依赖宿主路径）。
- 上游来源/授权/快照 hash 见 `PROVENANCE.md`。
- 本目录不含 `node_modules`；零外部运行时依赖（node:sqlite 等均为 Node 内置）。
- 升级方式：用新快照整目录替换 + 更新 PROVENANCE，不在 vendor 内局部 fork。
