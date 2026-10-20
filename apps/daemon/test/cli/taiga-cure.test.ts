/**
 * taiga-cure CLI 守门面（DEV-49，docs/52-§十；studio-dev-95）：
 * 三步根治体（@studio-next/taiga factory）已在包内 factory.test.ts 全证（红/绿/幂等/
 * 快照先于 DELETE/失败跳过不中断）；本文件只证 **daemon 侧配置守门**——错配明报不猜、
 * exit 码约定（1=用法/配置错）。真网络面不进测试（FakeTaiga 不出包，daemon 侧不重造桩）。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cmdTaigaCure } from '../../src/cli/taiga-cure.ts'

let dir = ''
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'taiga-cure-cli-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function writeConfig(text: string): Promise<string> {
  const file = path.join(dir, `daemon-${Math.random().toString(36).slice(2)}.yaml`)
  await writeFile(file, text, 'utf8')
  return file
}

describe('taiga-cure CLI 配置守门（错配明报不猜）', () => {
  it('缺 --config：用法错 exit 1', async () => {
    await expect(cmdTaigaCure([])).resolves.toBe(1)
  })

  it('platform 非 taiga：明报「根治是 Taiga 模板复制病」exit 1', async () => {
    const file = await writeConfig(['db: var/x.db', 'platform: fake', 'rootDir: .'].join('\n'))
    await expect(cmdTaigaCure(['--config', file])).resolves.toBe(1)
  })

  it('platform: taiga 缺 taigaFieldsFile：声明集事实源缺失拒不猜 exit 1', async () => {
    const file = await writeConfig(['db: var/x.db', 'platform: taiga', 'rootDir: .'].join('\n'))
    await expect(cmdTaigaCure(['--config', file])).resolves.toBe(1)
  })

  it('taigaFieldsFile 指向非法 JSON：CONFIG_INVALID 形状 exit 1（不静默）', async () => {
    const bad = path.join(dir, 'fields-bad.json')
    await writeFile(bad, '{not-json', 'utf8')
    const file = await writeConfig(['db: var/x.db', 'platform: taiga', 'rootDir: .', `taigaFieldsFile: ${bad}`].join('\n'))
    await expect(cmdTaigaCure(['--config', file])).resolves.toBe(1)
  })
})
