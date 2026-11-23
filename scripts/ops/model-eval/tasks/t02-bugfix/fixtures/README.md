# ledger-window —— 台账日闭用的窗口工具

日闭（cost close）按**本地自然日**切窗口：`[00:00, 24:00)`，epoch ms 表示。

## 口径

- 窗口是 epoch ms 的**闭开区间** `[since, until)`：含 `since`、不含 `until`。
  这样相邻两天的窗口首尾相接不重叠，一条事件只会落进一个日闭窗口。
- 23:59:59.999 属于当天；次日 00:00.000 属于次日。
- 按小时切片时，切片同样左闭右开，无缝拼回原窗口；末片可短于 1 小时。

## 用法

```ts
import { dayWindow, inWindow } from './src/window.ts'

const w = dayWindow(new Date())
inWindow(w.since, w) // true
inWindow(w.until, w) // false —— 上界开放
```

## 测试

`npm test`（= `node --test`，原生 type-stripping，无构建链）。测试是口径的冻结验收，改口径先改文档。
