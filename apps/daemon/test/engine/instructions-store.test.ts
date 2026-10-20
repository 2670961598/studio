/**
 * instructions-store 单测 —— bridge 通道指令临时文件的落点/写盘/清理 + overlay 生成
 *
 * 依据（实现单引用）：docs/25-§3.1 v1.5 裁决#1（STUDIO_NEXT_INSTRUCTIONS 通道）、
 * docs/04-§六（落点规则/生成物标记/exclude 纪律——workspace 外结构性免疫）、
 * docs/34-§3.1 装载法 B（overlay insert 语法铁律）。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  INSTRUCTIONS_DIR,
  instructionsTarget,
  provisionDshBridgeOverlay,
  removeInstructions,
  writeInstructions,
} from '../../src/engine/instructions-store.ts'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-instr-store-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('instructionsTarget：每任务临时文件落点（workspace 外）', () => {
  it('落点 = <rootDir>/tmp/instructions/<单号>.md（task 单号文件名化，同单重派同路径）', () => {
    expect(instructionsTarget('/var/sn', 'LOCAL-1')).toBe(
      path.join('/var/sn', INSTRUCTIONS_DIR, 'LOCAL-1.md'),
    )
    expect(INSTRUCTIONS_DIR).toBe(path.join('tmp', 'instructions'))
  })

  it('落点在 workspace 外（workspaces 段之外——不污染工位、不进 git 仓）', () => {
    const target = instructionsTarget('/var/sn', 'T-9')
    expect(target.startsWith(path.join('/var/sn', 'workspaces'))).toBe(false)
    expect(target.startsWith(path.join('/var/sn', 'tmp'))).toBe(true)
  })
})

describe('writeInstructions / removeInstructions：0600 落盘与幂等清理', () => {
  it('写盘：目录自动建、文件 0600、字节原样（含生成物横幅与层定界）', () => {
    const target = instructionsTarget(root, 'W-1')
    const text = '<!-- Studio Next 生成物：勿手改（每次派发重新生成；分层指纹见下一行） -->\n<!-- LAYER:L0:BEGIN -->\n'
    writeInstructions(target, text)
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe(text) // 不裁不拼不加头
    expect(statSync(target).mode & 0o777).toBe(0o600)
    expect(statSync(path.dirname(target)).mode & 0o777).toBe(0o700)
  })

  it('重派重写同路径：内容更新、mode 不升格（既有 0600 沿用）', () => {
    const target = instructionsTarget(root, 'W-1')
    writeInstructions(target, '第二次派发的组装产物')
    expect(readFileSync(target, 'utf8')).toBe('第二次派发的组装产物')
    expect(statSync(target).mode & 0o777).toBe(0o600)
  })

  it('清理：删除既有文件；已不存在不抛（幂等——收割失败重放面）', () => {
    const target = instructionsTarget(root, 'W-2')
    writeInstructions(target, 'x')
    removeInstructions(target)
    expect(existsSync(target)).toBe(false)
    expect(() => removeInstructions(target)).not.toThrow()
  })
})

describe('provisionDshBridgeOverlay：装载法 B overlay 生成（docs/34-§3.1）', () => {
  it('仓内运行：生成 overlay（insert 铁律形态 + 相对 name 锚定存在的插件源）+ 幂等刷新', () => {
    const out = provisionDshBridgeOverlay(root)
    expect(out).toBeDefined()
    const { overlayPath, bridgeSrc } = out!
    expect(existsSync(bridgeSrc)).toBe(true) // 插件源真实存在（本测试即仓内跑）
    expect(bridgeSrc.endsWith(path.join('packages', 'dsh-bridge', 'src', 'index.ts'))).toBe(true)
    const text = readFileSync(overlayPath, 'utf8')
    // insert 语法铁律：insert 键包完整条目（无 id ≠ 插入——docs/34-§3.1 首跑踩坑实录）
    expect(text).toContain('- insert:')
    expect(text).toContain('- id: studio-next-bridge')
    expect(text).toContain('instructionsEnv: STUDIO_NEXT_INSTRUCTIONS')
    // name 相对路径锚定 overlay 所在目录 → 解析回插件源（存在性=锚定正确）
    const nameLine = text.split('\n').find((l) => l.trim().startsWith('name:'))
    expect(nameLine).toBeDefined()
    const name = nameLine!.trim().slice('name:'.length).trim()
    expect(existsSync(path.resolve(path.dirname(overlayPath), name))).toBe(true)
    // 幂等刷新：同输入同 bytes（确定性内容）
    const again = provisionDshBridgeOverlay(root)
    expect(again?.overlayPath).toBe(overlayPath)
    expect(readFileSync(overlayPath, 'utf8')).toBe(text)
  })

  it('包不在预期位置（bridgeSrc 覆盖注入不存在路径）→ undefined 如实回（调用方明报不静默）', () => {
    expect(provisionDshBridgeOverlay(root, { bridgeSrc: path.join(root, 'no-such-src.ts') })).toBeUndefined()
  })

  it('bridgeSrc 覆盖注入自定义源：name 相对锚定该源（per-deployment 可指向仓外插件包）', () => {
    const customSrc = path.join(root, 'custom-bridge', 'src', 'index.ts')
    mkdirSync(path.dirname(customSrc), { recursive: true })
    writeFileSync(customSrc, 'export const name = "x"\n')
    const out = provisionDshBridgeOverlay(root, { bridgeSrc: customSrc })
    expect(out).toBeDefined()
    const text = readFileSync(out!.overlayPath, 'utf8')
    const name = text.split('\n').find((l) => l.trim().startsWith('name:'))!.trim().slice('name:'.length).trim()
    expect(path.resolve(path.dirname(out!.overlayPath), name)).toBe(customSrc)
  })
})

describe('bridge 通道落点与 workspace 的隔离（结构面）', () => {
  it('指令目录与 workspaces 目录互不嵌套（exclude 纪律结构性免疫——04-§六）', () => {
    const instrDir = path.join(root, INSTRUCTIONS_DIR)
    const wsDir = path.join(root, 'workspaces', 'T-1', 'att1')
    mkdirSync(wsDir, { recursive: true })
    const t1 = instructionsTarget(root, 'T-1')
    expect(t1.startsWith(wsDir)).toBe(false)
    expect(wsDir.startsWith(instrDir)).toBe(false)
  })
})
