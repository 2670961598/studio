/**
 * yaml —— YAML 资源上限防线（YAML bomb；NEG-ENG-02）
 *
 * 依据（实现单必引章节号——AGENTS §五.1）：
 *   - docs/v2/13 §2.3 DEP-YAML「别名/锚点与规模上限须自建（YAML bomb 负测归 v2/17）」；
 *   - docs/v2/13 §八-5 未证项「YAML bomb 防线：别名/深度/规模上限负测」；
 *   - docs/v2/17 §4.4 NEG-ENG-02「别名/深度/规模超限包 → 上限负测拒收（V1）」。
 *
 * 定位：core 内**唯一** YAML 上限件（纯函数、零 IO、不新增记录类与端口）。解析入口固定四步：
 *   ① `checkYamlSource(text)`——parse **之前**按源文本字符数拒（不为超长输入分配 AST）；
 *   ② 调用方 `parseDocument`（行号面仍归调用方：LineCounter 用法不变）；
 *   ③ `checkYamlDocument(doc.contents)`——parse **之后**遍历 AST：深度/节点数/别名节点数
 *      （显式栈 + 早停：命中上限立即返回，不为深嵌套留递归栈）；
 *   ④ `toJsWithinLimits(doc)`——别名**展开**计数由 yaml 库在 `toJS` 时计（`ToJSOptions.
 *      maxAliasCount`；本件把它从「库默认 100」升为显式冻结常量并映射为上限违规）。
 *
 * 为什么必须自建（〔事实〕对 yaml 2.9.1 实测，2026-10-28）：
 *   - `parseDocument` 只建 AST、**不展开**别名——放大发生在 `toJS`；小源文可放大到指数级
 *     （4 层 × 4 分支即 4^4 次展开，9 层 × 9 分支 ≈ 3.9e8）；
 *   - `toJS` 的 `maxAliasCount` 默认 100，但库**无**深度/节点数/源规模上限，且默认值是
 *     第三方默认值——不显式传参＝判据挂在库的实现细节上；
 *   - `toJS` 递归展开 AST：超深嵌套在展开阶段吃调用栈（先拒比事后 RangeError 可判）。
 *
 * 上限语义（NEG-ENG-02 的「拒收」）：超限＝**明确拒绝**（调用方映射 CONFIG_INVALID 族码），
 * **不截断、不忽略、不静默降级**；上限值＝本件冻结常量，改动＝判据类修订（走提案流）。
 *
 * 出码分工（本件不抛错、不持错误通道）：错误码归各解析入口——
 *   - core pricing：`pricing/yaml-limit:<kind>`（CONFIG_INVALID）；
 *   - company assets：`assets/yaml-limit`（CONFIG_INVALID）。
 *   company ⇸ core 无冻结包间边（`scripts/guards/boundary-rules.mjs` allowedPackageEdges），
 *   故 company 侧本地复制同值常量与小函数（沿 models.ts「本地复制避免跨包依赖」先例，
 *   值须与本文件 YAML_LIMITS 一致）。
 */
import { isAlias, isMap, isNode, isSeq } from 'yaml'
import type { parseDocument } from 'yaml'

/** 解析入口可用的文档形（`parseDocument` 返回；只取 toJS 面，便于测试注入） */
export type ParsedYamlDoc = ReturnType<typeof parseDocument>

/** YAML 资源上限（NEG-ENG-02 冻结值；单位见各字段注释） */
export interface YamlLimits {
  /** 源文本字符数上限（UTF-16 code unit，含注释的原文长度；parse 前检查） */
  readonly maxSourceChars: number
  /** AST 节点数上限（映射键/值、序列项、标量、别名各计 1） */
  readonly maxNodes: number
  /** AST 嵌套深度上限（根节点=1；映射的键与值均计父深度+1） */
  readonly maxDepth: number
  /** 别名上限：AST 别名节点数上限，**并**作 `toJS` 别名展开计数上限（库计） */
  readonly maxAliasCount: number
}

/**
 * 冻结上限（取值口径：远高于任何正常配置需求、远低于资源耗尽——
 * 定价附件/资产清单均为 KB 级、别名罕用；10 万字符≈20 倍正常上限仍留余量。
 */
export const YAML_LIMITS: YamlLimits = Object.freeze({
  maxSourceChars: 1_000_000,
  maxNodes: 10_000,
  maxDepth: 32,
  maxAliasCount: 64,
})

/** 上限种类（=拒绝码后缀；四类均可独立触发，不合并） */
export type YamlLimitKind = 'source-chars' | 'nodes' | 'depth' | 'alias'

/** 上限违规（调用方映射为自身错误通道；`actual` 缺省=库不回报精确值） */
export interface YamlLimitViolation {
  readonly kind: YamlLimitKind
  readonly limit: number
  /** 实测值；`alias` 由库的展开计数判负时无精确值（语义＝「> limit」） */
  readonly actual?: number | undefined
  /** 违规节点在源文中的偏移（调用方换算行号）；源文本超限时无节点可指 */
  readonly offset?: number | undefined
}

/** 节点 range 起点（行号换算用；无 range 的节点返回 undefined——不猜行号） */
function offsetOf(node: unknown): number | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const range = (node as { readonly range?: readonly number[] | null }).range
  if (range === null || range === undefined || range.length === 0) return undefined
  const start = range[0]
  return typeof start === 'number' ? start : undefined
}

/**
 * 规模上限·第一步：源文本字符数（parse **之前**调用——超长输入不分配 AST）。
 * 只做长度比较，不解析、不截断。
 */
export function checkYamlSource(text: string, limits: YamlLimits = YAML_LIMITS): YamlLimitViolation | undefined {
  if (text.length <= limits.maxSourceChars) return undefined
  return { kind: 'source-chars', limit: limits.maxSourceChars, actual: text.length }
}

/**
 * 规模上限·第二步：AST 深度/节点数/别名节点数（parse 之后、`toJS` 之前调用）。
 * 显式栈遍历 + 命中即返回：判定开销与违规位置成正比，且**不展开别名**（不物化 JS 值）。
 */
export function checkYamlDocument(
  root: unknown,
  limits: YamlLimits = YAML_LIMITS,
): YamlLimitViolation | undefined {
  if (root === null || root === undefined) return undefined
  const stack: Array<{ readonly node: unknown; readonly depth: number }> = [{ node: root, depth: 1 }]
  let nodes = 0
  let aliases = 0
  while (stack.length > 0) {
    const frame = stack.pop()
    if (frame === undefined) break // 循环条件已保证非空（防御，不改变语义）
    nodes += 1
    if (nodes > limits.maxNodes) {
      return { kind: 'nodes', limit: limits.maxNodes, actual: nodes, offset: offsetOf(frame.node) }
    }
    if (frame.depth > limits.maxDepth) {
      return { kind: 'depth', limit: limits.maxDepth, actual: frame.depth, offset: offsetOf(frame.node) }
    }
    if (isAlias(frame.node)) {
      aliases += 1
      if (aliases > limits.maxAliasCount) {
        return { kind: 'alias', limit: limits.maxAliasCount, actual: aliases, offset: offsetOf(frame.node) }
      }
      continue // 别名不展开：其目标锚点由库在 toJS 阶段展开并计数
    }
    const childDepth = frame.depth + 1
    if (isMap(frame.node)) {
      for (const pair of frame.node.items) {
        if (isNode(pair.key)) stack.push({ node: pair.key, depth: childDepth })
        if (isNode(pair.value)) stack.push({ node: pair.value, depth: childDepth })
      }
      continue
    }
    if (isSeq(frame.node)) {
      for (const item of frame.node.items) {
        if (isNode(item)) stack.push({ node: item, depth: childDepth })
      }
    }
  }
  return undefined
}

/** `toJS` 结果（三态：成功／上限拒（别名展开计数）／toJS 自身报错（如未解析别名）） */
export type YamlToJsResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: 'alias-limit'; readonly violation: YamlLimitViolation }
  | { readonly ok: false; readonly reason: 'tojs-error'; readonly message: string }

/** yaml 2.9.1 的别名展开拒收文案（Alias.js；只认此文案为「上限拒」） */
const EXCESSIVE_ALIAS_MESSAGE = 'Excessive alias count indicates a resource exhaustion attack'

/**
 * 规模上限·第三步：`toJS` 显式传 `maxAliasCount`（别名展开计数＝真正的资源耗尽点）。
 * 库报「Excessive alias count」→ 上限拒（kind=alias，无精确值）；其余 `toJS` 报错
 * （典型：未解析别名/锚点引用在前）→ 原样归类 `tojs-error`，由调用方按语法错拒收——
 * 不让 ReferenceError 裸奔出解析入口。
 */
export function toJsWithinLimits(doc: ParsedYamlDoc, limits: YamlLimits = YAML_LIMITS): YamlToJsResult {
  try {
    return { ok: true, value: doc.toJS({ maxAliasCount: limits.maxAliasCount }) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof ReferenceError && message.includes(EXCESSIVE_ALIAS_MESSAGE)) {
      return { ok: false, reason: 'alias-limit', violation: { kind: 'alias', limit: limits.maxAliasCount } }
    }
    return { ok: false, reason: 'tojs-error', message }
  }
}

/** 违规 → 一句可读说明（各入口的错误通道共用；数值逐字给出，便于对账上限值） */
export function describeYamlLimit(violation: YamlLimitViolation): string {
  const shown = violation.actual === undefined ? `>${violation.limit}` : String(violation.actual)
  switch (violation.kind) {
    case 'source-chars':
      return `YAML 源文本 ${shown} 字符 > 上限 ${violation.limit}（规模上限）`
    case 'nodes':
      return `YAML AST 节点数 ${shown} > 上限 ${violation.limit}（规模上限）`
    case 'depth':
      return `YAML 嵌套深度 ${shown} > 上限 ${violation.limit}（深度上限）`
    case 'alias':
      return violation.actual === undefined
        ? `YAML 别名展开计数 > 上限 ${violation.limit}（toJS maxAliasCount——YAML bomb）`
        : `YAML 别名节点数 ${shown} > 上限 ${violation.limit}（别名上限）`
  }
}
