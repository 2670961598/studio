/** task-56 wiring 纯面测试：per-source overlay、fingerprint 含 sources、source 价目计算。 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fingerprint, modelSourcesOf, parseModelsYaml } from '@studio-next/core'
import { provisionSourceOverlay, renderSourceOverlay } from '../../../src/engine/routing/overlay.ts'
import { estimateSourceCost } from '../../../src/engine/routing/router.ts'
import { DshAdapter } from '../../../../../packages/adapters/src/dsh.ts'

const A = `tiers:
  high:
    sources:
      - id: primary
        provider: glm
        model: GLM-5.3
        priority: 10
        price: {inputPerM: 1, outputPerM: 2}
      - id: secondary
        provider: opencode-go
        model: kimi-k3.1-pro
        priority: 20
        price: {inputPerM: 2, outputPerM: 10}
  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1, outputPerM: 0.4}}
roles: {main_worker: mid, verifier: high}
`
const B = A.replace('priority: 20', 'priority: 30')

describe('task-56 routing wiring pure', () => {
  it('per-source overlay 文本/原子落盘含 source id+provider/model', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sn-route-overlay-'))
    try {
      const parsed = parseModelsYaml(A)
      const source = modelSourcesOf(parsed, 'high')[1]!
      expect(renderSourceOverlay('high', source)).toContain('source=secondary')
      expect(renderSourceOverlay('high', source)).toContain('provider: opencode-go')
      const file = provisionSourceOverlay(dir, 'high', source)
      expect(path.basename(file)).toBe('dsh-tier-high--secondary.yml')
      expect(readFileSync(file, 'utf8')).toContain('model: kimi-k3.1-pro')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('fingerprint 覆盖 sources（改 priority 变指纹；单源旧格式行为不变）', () => {
    const a = parseModelsYaml(A)
    const b = parseModelsYaml(B)
    expect(fingerprint(a)).not.toBe(fingerprint(b))
    const legacy = `tiers:
  high: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}
  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1, outputPerM: 0.4}}
roles: {main_worker: mid}
`
    expect(modelSourcesOf(parseModelsYaml(legacy), 'high')[0]?.id).toBe('default')
  })
  it('source 价目估算按实际源（budget/归属同源公式）', () => {
    const parsed = parseModelsYaml(A)
    const high = modelSourcesOf(parsed, 'high')
    expect(estimateSourceCost(high[0]!, { input: 1_000_000, output: 100_000 })).toBeCloseTo(1.2)
    expect(estimateSourceCost(high[1]!, { input: 1_000_000, output: 100_000 })).toBeCloseTo(3)
  })

  it('F1：默认 cmd 含 --json 时 per-source --patch 必须插在 --json 之前', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sn-dsh-argv-'))
    const ws = path.join(dir, 'ws'); mkdirSync(ws, { recursive: true })
    const p01 = path.resolve(process.cwd(), 'packages/adapters/test/fixtures/dsh/P01-真成功流.ndjson')
    const worker = path.join(dir, 'worker.mjs')
    writeFileSync(worker, `#!/usr/bin/env node\nimport { readFileSync, appendFileSync } from 'node:fs'\nif (process.argv.includes('--version')) { console.log('0.2.1-rc.5'); process.exit(0) }\nappendFileSync('${dir}/argv.log', JSON.stringify(process.argv.slice(2))+'\\n')\nconst raw=readFileSync('${p01}','utf8'); console.log(raw.split('\\n').filter(l=>l.trim()!==''&&!l.trimStart().startsWith('#')).join('\\n'))\n`, 'utf8')
    chmodSync(worker, 0o755)
    writeFileSync(path.join(dir, 'overlay.yml'), '# source=secondary\n- id: agent-default-model\n  config: {provider: p, model: m}\n')
    writeFileSync(path.join(dir, 'brief.md'), 'x')
    try {
      const a = new DshAdapter([worker, '--profile', 'headless', '--json'], {})
      a.setSourceOverlay(path.join(dir, 'overlay.yml'))
      const h = await a.launch({ ticket: 'T', attempt: 1, briefPath: path.join(dir, 'brief.md'), workspace: ws, AGENTS_MD: { channel: 'native', target: path.join(dir, 'AGENTS.md') } })
      for await (const _ of a.stream(h)) void _
      const argv = JSON.parse(readFileSync(path.join(dir, 'argv.log'), 'utf8').trim()) as string[]
      expect(argv.indexOf('--patch')).toBeGreaterThan(-1)
      expect(argv.indexOf('--patch')).toBeLessThan(argv.indexOf('--json'))
      expect(argv[argv.length - 1]).toBe('x') // `--` 任务串收尾
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
