/**
 * ui/ 前端资产语法门禁（2026-10-23 制作人浏览器报障带出——DEV-12 原始交付的
 * 「Vue 模板串内嵌套反引号」四件静默合入：ui/ 资产无测试覆盖，浏览器才炸）。
 *
 * 门禁形态：esbuild transform（纯语法解析，零解析依赖面）逐件扫 packages/panel/ui/**
 * 的 .js/.mjs——任何语法错误（挤行/坏引号/未闭合模板）在本门禁红，不再流到浏览器。
 * 不执行模块（bare import 'vue' 不解析）——语法层就够拦本次事故类。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
// esbuild 为 vite 传递依赖（node_modules 恒在——不新增选型面）
import { transformSync } from 'esbuild'

const UI_ROOT = join(import.meta.dirname, '../../ui')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(p)
  }
  return out
}

describe('ui 资产语法门禁（panel/ui/** 全量 esbuild 解析——浏览器前置闸）', () => {
  it('每件 .js/.mjs 必须语法可解析（违规即本门禁红——修文件而非改门禁）', () => {
    const files = walk(UI_ROOT)
    expect(files.length).toBeGreaterThan(10) // 防误配（ui 树被挪走=门禁失效）
    const bad: string[] = []
    for (const f of files) {
      try {
        transformSync(readFileSync(f, 'utf8'), { loader: 'js', format: 'esm' })
      } catch (err) {
        bad.push(`${relative(UI_ROOT, f)}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
      }
    }
    expect(bad, `ui/ 资产语法破损（生产事故类——2026-10-23 四件反引号嵌套同型）:\n${bad.join('\n')}`).toEqual([])
  })
})
