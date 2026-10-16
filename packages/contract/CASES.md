# cases.json 契约格式规范（v1，冻结面）

> 依据：docs/25-§二、需求 F2-14、docs/08-§三（契约分级）。
> 本文件是契约格式的唯一规范；runner（src/runner.ts）是实现，二者冲突以本文件为准，
> 改本文件 = 改契约，走批示（20-§二：验收口径冻结后禁改）。

## 清单结构

`packages/contract/cases.json`：

```json
{
  "version": 1,
  "cases": [
    {
      "id": "C-dir-001",
      "domain": "dir",
      "docs": "04-§二",
      "title": "一句话人话描述",
      "input": { },
      "expected": { "out": { } }
    }
  ]
}
```

## 冻结规则

1. **稳定 id**：`C-<域>-<序号>`（如 `C-dir-001`）。一经合入**永不复用、永不改义**；
   废弃用例标 `deprecated`（清单级字段，后续版本引入），不物理删除。
2. **恰一期望**：`expected` 必须恰含 `out` 或 `err` 之一。
   - `out`：subject 正常返回，按匹配语义断言
   - `err`：subject 必须抛错，`category` 必须相等；`subcause` 仅在给出时断言
3. **`__NULL__` 哨兵**：期望树中字符串 `"__NULL__"` 表示「实际值必须是显式 null」，
   与「键省略=不关心」构成两种"无值"的正交表达。
4. **匹配语义**（语言无关，任何 runner 实现必须等价）：
   - 对象：expected 的键集是断言集，actual 多出的键不关心
   - 数组：长度相等 + 元素无序双射（每个期望元素恰匹配一个实际元素）
   - 原语：严格相等；期望值禁用 NaN
5. **input 内联**（v1）：小语料直接内联；大语料后续版本走 `file` 指针（schema 已预留扩展位）。
6. **每单必填 docs**：用例必须引用设计文档章节号（20-§二 依据链）。

## 域清单（v0）

| 域 | subject 归属 | 断言侧重 |
|---|---|---|
| `meta` | contract 自身（runner 自证） | 机制本身 |
| `dir` | company 校验器 | 语义（规则命中）；行号定位由 company 单测负责 |
| `evt` / `rpt` | contract 自身（src/schemas/，M1.2 已落：evt 5 条 + rpt 3 条） | 事件记录/REPORT+summary 格式 |
| `exe` / `plat` / `inv` / `mdl` / `gw` | 各泳道 | 端口冒烟 case |

### dir 域 v1 语义增补（v0.1-M2.2，拟稿待批）

> 本节为增补说明，头注明示**拟稿待制作人批示后固化**（改本文件=改契约，20-§二）。

company 校验器自 v0.1-M2.2 起对 `loadCompanyDirectory` 缺省做**多文件全目录校验**
（departments/**/config.yaml、人事档案 front-matter、charter_ref、.studio-next.yaml 交叉——
docs/04-§二 契约全貌；实现 packages/company/src/multifile.ts）。`dir` 域 3 case 的 input
只有 org-config.yaml 单文件（v0 语料），按全检语义 C-dir-001 将因部门/档案/元信息文件缺失翻红；
契约语料单写者纪律（不为本单改 cases.json），故：

- `dir` 域 v1 语义冻结为「**org-config.yaml 单文件校验**」：subject（company 的 `dirSubject`）
  以宽容位 `strictFiles:false` 包装 `loadCompanyDirectory`，既有 3 case 口径零漂移。
- 多文件全目录校验的契约面留给后续批次的 `dir2` 域（开批时落 case，`strictFiles` 宽容位
  届时随契约化收口）；多文件行为面暂由 company 单测（multifile.test.ts）承载。

## 运行方式

```ts
import { runCases } from '@studio-next/contract'
import manifest from '<contract>/cases.json'
const report = await runCases(manifest, { dir: loadCompanyDirectory }, { domains: ['dir'] })
// report.failed 非空 = 契约红
```
