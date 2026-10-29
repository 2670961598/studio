'use strict'

/**
 * require-reject.cjs —— CJS 拒绝面（NEG-ENG-01 / DEC-13-13 / v2/13 §1.6-6）
 *
 * 本包 ESM-only。CJS 消费者 `require('@studio-next/company')` 时，package.json 的
 * exports.require 条件命中本文件：只抛 ERR_ESM_ONLY，不执行其它逻辑，
 * 也不提供 dist/CJS 构建。正确用法：ESM `import` / `await import('@studio-next/company')`。
 */
const packageName = '@studio-next/company'
const error = new Error(
  `${packageName} is ESM-only: CommonJS require is not supported; use import() instead.`,
)
error.code = 'ERR_ESM_ONLY'
throw error
