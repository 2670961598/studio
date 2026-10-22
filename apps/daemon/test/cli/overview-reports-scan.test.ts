/**
 * overview 子命令报表目录扫描测试（127-B v1，studio-dev-176）。
 *
 * scanReportFiles 是面板报表 tab 的目录读面数据源（唯一磁盘读点——panel 零 IO 纪律的
 * wiring 侧）：公司目录 reports/ 树 → 元数据清单（relPath/sizeBytes/mtimeMs——辅助列；
 * 时序权威=台账事件）。钉死：
 *   - 两部门跨日多件：relPath 前缀 reports/、部门子目录递归、公司级根件并列；
 *   - 占位件过滤（.gitkeep/.DS_Store——与 harvest-recon deliverablesOf 同口径）；
 *   - 目录不存在=空清单（如实，不臆造、不抛——公司还没落过报表件）。
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scanReportFiles } from '../../src/cli/overview.ts'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-reports-scan-'))
  // 两部门子目录 + 公司级根件 + 占位件（过滤面）
  await mkdir(path.join(root, 'reports', '研发部'), { recursive: true })
  await mkdir(path.join(root, 'reports', '综合部'), { recursive: true })
  await writeFile(path.join(root, 'reports', '研发部', '2026-10-20-report-研发部-CB-100.md'), 'x'.repeat(1200))
  await writeFile(path.join(root, 'reports', '研发部', '.gitkeep'), '')
  await writeFile(path.join(root, 'reports', '综合部', '2026-10-22-report-综合部-CB-200.md'), 'x'.repeat(800))
  await writeFile(path.join(root, 'reports', '2026-09-monthly.json'), '{}')
  await writeFile(path.join(root, 'reports', '.DS_Store'), 'junk')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('scanReportFiles（报表目录元数据扫描——辅助列数据源）', () => {
  it('reports/ 树递归：relPath 带 reports/ 前缀、大小实 stat、占位件过滤', () => {
    const out = scanReportFiles(root)
    const rels = out.map((f) => f.relPath).sort()
    // scan 顺序=readdir 序（平台不定）——断言按码点排序后清单（'2' < 研 U+7814 < 综 U+7EFC）
    expect(rels).toEqual([
      'reports/2026-09-monthly.json',
      'reports/研发部/2026-10-20-report-研发部-CB-100.md',
      'reports/综合部/2026-10-22-report-综合部-CB-200.md',
    ])
    const rd = out.find((f) => f.relPath === 'reports/研发部/2026-10-20-report-研发部-CB-100.md')
    expect(rd?.sizeBytes).toBe(1200)
    expect(typeof rd?.mtimeMs).toBe('number')
    expect(rd!.mtimeMs).toBeGreaterThan(0)
  })

  it('目录不存在=空清单（如实降级，不抛——归档缺失判定归台账事件对账，不靠本扫描）', () => {
    expect(scanReportFiles(path.join(root, 'no-such-company'))).toEqual([])
  })
})
