/**
 * ui/overview/* 换装页前端模块测试（DEV-12 刀二）。
 * 依据：docs/37-§5.1（路线 I：同套换装——importmap 三项映射 + /ui/* 静态面）。
 *
 * 分两层：
 *   - 纯函数直测：router.js 零 import（node 原生可吃），parseOverviewPath/tabPath 全分支；
 *   - 裸导入纪律扫描：ui/overview 下全部 .js 文件的 import 说明符只许 vue/naive-ui/echarts 三项
 *     （importmap 白名单——超出即浏览器 404，门禁在源文件层面提前拦住）。
 *     同款先例：ui-feed.test.ts（DEV-1）直测纯 JS；theme.js 链上 naive-ui 裸导入
 *     在 node 不可解析，故图表 options 不直测、可达性归 overview.test.ts 的 /ui/* 断言。
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMPANY_TABS, parseOverviewPath, tabPath } from '../ui/overview/router.js'

const overviewDir = fileURLToPath(new URL('../ui/overview', import.meta.url))

// ————————————————————————— parseOverviewPath（路径 → 路由；与服务端路由表同构） —————————————————————————

describe('parseOverviewPath（换装页路由纯函数）', () => {
  it("根路径族：'' | '/' | '///' → companies 视图", () => {
    expect(parseOverviewPath('')).toEqual({ view: 'companies' })
    expect(parseOverviewPath('/')).toEqual({ view: 'companies' })
    expect(parseOverviewPath('///')).toEqual({ view: 'companies' })
  })

  it('公司根：/<slug> 与 /<slug>/（尾斜杠归一）→ company/overview', () => {
    expect(parseOverviewPath('/corp-b')).toEqual({ view: 'company', slug: 'corp-b', tab: 'overview' })
    expect(parseOverviewPath('/corp-b/')).toEqual({ view: 'company', slug: 'corp-b', tab: 'overview' })
  })

  it('tab 页：org/people/progress/finance → company/<tab>', () => {
    for (const tab of ['org', 'people', 'progress', 'finance']) {
      expect(parseOverviewPath(`/corp-b/${tab}`)).toEqual({ view: 'company', slug: 'corp-b', tab })
    }
  })

  it('档案页：/<slug>/people/<工号> → person（工号形状：字母数字起头，可含 _ / -）', () => {
    expect(parseOverviewPath('/corp-b/people/PB-1')).toEqual({ view: 'person', slug: 'corp-b', personId: 'PB-1' })
    expect(parseOverviewPath('/corp-b/people/agent_01')).toEqual({ view: 'person', slug: 'corp-b', personId: 'agent_01' })
  })

  it('null 形状（app 404 视图，与服务端 HTML 404 同口径）：坏 slug/未知 tab/深路径/坏工号', () => {
    // 坏 slug：大写/下划线/连字符起头
    for (const bad of ['/Corp-B', '/corp_b', '/-corp']) {
      expect(parseOverviewPath(bad), bad).toBeNull()
    }
    // 未知 tab 与过深路径
    expect(parseOverviewPath('/corp-b/jobs')).toBeNull()
    expect(parseOverviewPath('/corp-b/org/deeper')).toBeNull()
    expect(parseOverviewPath('/corp-b/people/PB-1/extra')).toBeNull()
    // 坏工号：符号起头
    expect(parseOverviewPath('/corp-b/people/-PB')).toBeNull()
    expect(parseOverviewPath('/corp-b/people/$x')).toBeNull()
  })

  it('空段归一而非拒绝：//corp-b 与 /corp-b//org 按段过滤后走公司路由（服务端不回壳，此宽容无副作用）', () => {
    expect(parseOverviewPath('//corp-b')).toEqual({ view: 'company', slug: 'corp-b', tab: 'overview' })
    expect(parseOverviewPath('/corp-b//org')).toEqual({ view: 'company', slug: 'corp-b', tab: 'org' })
  })

  it('非字符串输入容错：null/undefined → companies（String 归一，不炸流）', () => {
    expect(parseOverviewPath(null)).toEqual({ view: 'companies' })
    expect(parseOverviewPath(undefined)).toEqual({ view: 'companies' })
    expect(parseOverviewPath(123)).toEqual({ view: 'company', slug: '123', tab: 'overview' }) // 数字串=合法 slug 形状
  })

  it('COMPANY_TABS 与 tab 分支一致（overview 隐含在根，其余四 tab 显式路径）', () => {
    expect(COMPANY_TABS).toEqual(['overview', 'org', 'people', 'progress', 'finance'])
  })
})

// ————————————————————————— tabPath（tab → 规范路径） —————————————————————————

describe('tabPath（tab → 规范路径）', () => {
  it('overview 走规范根 /<slug>/，其余 /<slug>/<tab>（与服务端路由表同构）', () => {
    expect(tabPath('corp-b', 'overview')).toBe('/corp-b/')
    expect(tabPath('corp-b', 'org')).toBe('/corp-b/org')
    expect(tabPath('corp-b', 'finance')).toBe('/corp-b/finance')
  })
})

// ————————————————————————— 裸导入纪律（importmap 白名单扫描） —————————————————————————

describe('ui/overview/* 裸导入纪律（importmap 三项之外即浏览器 404）', () => {
  async function collectJsFiles(dir: string): Promise<string[]> {
    const out: string[] = []
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) out.push(...(await collectJsFiles(full)))
      else if (ent.name.endsWith('.js')) out.push(full)
    }
    return out
  }

  it('全部 .js 文件的裸导入 ⊆ {vue, naive-ui, echarts}；包内复用只许相对路径', async () => {
    const files = await collectJsFiles(overviewDir)
    expect(files.length).toBeGreaterThan(8) // main/app/router + charts + components + composables
    const importRe = /(?:^|\n)\s*import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g
    for (const file of files) {
      const src = await readFile(file, 'utf8')
      for (const m of src.matchAll(importRe)) {
        const spec = m[1] ?? ''
        if (spec.startsWith('.') || spec.startsWith('/')) continue // 相对导入=包内复用（theme/format/ChartCard）
        expect(spec, `${path.relative(overviewDir, file)} → ${spec}`).toMatch(/^(vue|naive-ui|echarts)(\/[\w.-]+)?$/)
      }
    }
  })

  it('动态 import 的说明符同受白名单约束', async () => {
    const files = await collectJsFiles(overviewDir)
    const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g
    for (const file of files) {
      const src = await readFile(file, 'utf8')
      for (const m of src.matchAll(dynamicRe)) {
        const spec = m[1] ?? ''
        if (spec.startsWith('.') || spec.startsWith('/')) continue
        expect(`${path.relative(overviewDir, file)} → ${spec}`).toMatch(/^(vue|naive-ui|echarts)(\/[\w.-]+)?$/)
      }
    }
  })
})
