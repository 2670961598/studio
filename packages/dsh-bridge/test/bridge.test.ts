/**
 * studio-next-bridge 插件单测 —— 纯逻辑（vitest，docs/18-§1.3 分层：单测对分支全覆盖）
 *
 * 覆盖（docs/25-§3.1 v1.5 裁决#1 的验收面）：
 *   - 插件装载形状：name/inject/apply 三导出（cordis host-plugin 约定，dsh 官方参考
 *     host-plugin.md「do not mix forms」）
 *   - resolveBridgeConfig：raw config 归一（null/非对象/非字符串字段丢弃回缺省）
 *   - readInstructions 四态：unset / unreadable / empty / injected（env 与读文件注入）
 *   - apply 接线：agent/created → 读 env 指向文件 → agent.ctx.effect 包
 *     systemPrompt.section（name 唯一 + order 取 DEPLOYMENT_PERSONA_PREFIX 放置位）
 *   - 失败面：required=false 降级不抛；required=true 抛错拦截 agent 创建
 *   - 可分发件形状（dsh.bundle）：package.json 声明 dsh.bundle.patch 指向真实补丁文件；
 *     cordis.patch.yml 的 insert 语法（insert 键包条目 + 相对路径 name 锚定补丁目录 +
 *     config.instructionsEnv 指到 STUDIO_NEXT_INSTRUCTIONS）——零依赖纪律下用文本断言
 *     （补丁文件是冻结工件，YAML 形状由真机冒烟背书）
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_INSTRUCTIONS_ENV,
  SECTION_NAME,
  SECTION_PLACEMENT,
  apply,
  inject,
  name,
  readInstructions,
  resolveBridgeConfig,
} from '../src/index.ts'
import type { AgentContextLike, AgentLike, PluginContextLike } from '../src/index.ts'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const workdir = mkdtempSync(join(tmpdir(), 'dsh-bridge-test-'))
afterAll(() => {
  rmSync(workdir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// 装载形状
// ---------------------------------------------------------------------------

describe('插件装载形状（cordis host-plugin 约定——apply 函数式，不混 service 类）', () => {
  it('name/inject/apply 三导出：name=studio-next-bridge、inject 含 systemPrompt、apply 是函数', () => {
    expect(name).toBe('studio-next-bridge')
    expect(inject).toContain('systemPrompt')
    expect(apply).toBeTypeOf('function')
  })
})

// ---------------------------------------------------------------------------
// 纯逻辑：config 归一
// ---------------------------------------------------------------------------

describe('resolveBridgeConfig（cordis raw config 直通——无 schema 插件的防御性归一）', () => {
  it('undefined/null/非对象 → 空配置（全缺省）', () => {
    expect(resolveBridgeConfig(undefined)).toStrictEqual({})
    expect(resolveBridgeConfig(null)).toStrictEqual({})
    expect(resolveBridgeConfig('garbage')).toStrictEqual({})
    expect(resolveBridgeConfig(42)).toStrictEqual({})
  })

  it('合法字段透传；非字符串/空串字段丢弃；required 只认真布尔 true', () => {
    expect(
      resolveBridgeConfig({ instructionsEnv: 'X', sectionName: 's', required: true }),
    ).toStrictEqual({ instructionsEnv: 'X', sectionName: 's', required: true })
    expect(
      resolveBridgeConfig({ instructionsEnv: 1, sectionName: '', required: 'yes' }),
    ).toStrictEqual({})
    expect(resolveBridgeConfig({ extra: 'ignored' })).toStrictEqual({})
  })
})

// ---------------------------------------------------------------------------
// 纯逻辑：指令解析四态
// ---------------------------------------------------------------------------

describe('readInstructions（env → 文件路径 → 全文；注入 env 与读函数以便纯逻辑测试）', () => {
  const reader = (files: Record<string, string>) => async (p: string): Promise<string> => {
    if (!(p in files)) throw new Error(`ENOENT: no such file: ${p}`)
    return files[p] ?? ''
  }

  it('injected：env 指向的文件全文如实返回（字节不裁不拼）', async () => {
    const r = await readInstructions(
      { [DEFAULT_INSTRUCTIONS_ENV]: '/tmp/x.md' },
      {},
      reader({ '/tmp/x.md': '# 指令\n你是测试工。\n' }),
    )
    expect(r).toStrictEqual({
      status: 'injected',
      text: '# 指令\n你是测试工。\n',
      source: '/tmp/x.md',
    })
  })

  it('unset：变量未设 / 空串 / 纯空白值', async () => {
    expect(await readInstructions({}, {}, reader({}))).toStrictEqual({ status: 'unset' })
    expect(
      await readInstructions({ [DEFAULT_INSTRUCTIONS_ENV]: '' }, {}, reader({})),
    ).toStrictEqual({ status: 'unset' })
    expect(
      await readInstructions({ [DEFAULT_INSTRUCTIONS_ENV]: '   ' }, {}, reader({})),
    ).toStrictEqual({ status: 'unset' })
  })

  it('自定义 instructionsEnv：点名变量生效、缺省变量不看', async () => {
    const r = await readInstructions(
      { OTHER_ENV: '/tmp/y.md' },
      { instructionsEnv: 'OTHER_ENV' },
      reader({ '/tmp/y.md': '指令内容' }),
    )
    expect(r.status).toBe('injected')
    expect(r.text).toBe('指令内容')
  })

  it('unreadable：文件读失败带原因与 source', async () => {
    const r = await readInstructions(
      { [DEFAULT_INSTRUCTIONS_ENV]: '/no/such/file.md' },
      {},
      reader({}),
    )
    expect(r.status).toBe('unreadable')
    expect(r.source).toBe('/no/such/file.md')
    expect(r.detail).toMatch(/ENOENT/)
  })

  it('empty：文件全空白 → 明示（注入空串无意义）', async () => {
    const r = await readInstructions(
      { [DEFAULT_INSTRUCTIONS_ENV]: '/tmp/blank.md' },
      {},
      reader({ '/tmp/blank.md': ' \n\t ' }),
    )
    expect(r).toStrictEqual({ status: 'empty', source: '/tmp/blank.md' })
  })
})

// ---------------------------------------------------------------------------
// apply 接线（伪宿主：捕获 agent/created 监听 + 录制 section/effect 调用）
// ---------------------------------------------------------------------------

/** 伪 agent scoped ctx：录制 effect 与 section 调用 */
function fakeAgentContext(): {
  ctx: AgentContextLike
  sections: Array<{ name: string; order: number; text: string }>
  effects: Array<() => unknown>
  orders: string[]
} {
  const sections: Array<{ name: string; order: number; text: string }> = []
  const effects: Array<() => unknown> = []
  const orders: string[] = []
  const ctx: AgentContextLike = {
    systemPrompt: {
      section(spec) {
        sections.push(spec)
        return 'disposed-token'
      },
      getSectionOrder(placement) {
        orders.push(placement)
        return 42
      },
    },
    effect(fn) {
      effects.push(fn)
      return 'effect-token'
    },
  }
  return { ctx, sections, effects, orders }
}

/** 伪插件 ctx：捕获 agent/created 监听器 */
function fakePluginCtx(): {
  ctx: PluginContextLike
  listeners: Array<(payload: { agent?: AgentLike }) => void | Promise<void>>
} {
  const listeners: Array<(payload: { agent?: AgentLike }) => void | Promise<void>> = []
  const ctx: PluginContextLike = {
    on(_event, listener) {
      listeners.push(listener)
      return 'on-token'
    },
  }
  return { ctx, listeners }
}

describe('apply 接线（agent/created → 注入 persona 前缀段——v1.5 裁决#1 的行为面）', () => {
  it('注入路径：读 env 指向文件 → agent.ctx.effect 包 systemPrompt.section（name/order/text 三断言）', async () => {
    const instructionsPath = join(workdir, 'instructions.md')
    writeFileSync(instructionsPath, '# Studio Next 指令\n每答必附标记串 MARK-X。\n')
    const saved = process.env[DEFAULT_INSTRUCTIONS_ENV]
    process.env[DEFAULT_INSTRUCTIONS_ENV] = instructionsPath
    try {
      const plugin = fakePluginCtx()
      expect(apply(plugin.ctx, {})).toBe('on-token') // 返回 ctx.on 销毁器（cordis 约定）
      expect(plugin.listeners.length).toBe(1)

      const agent = fakeAgentContext()
      await plugin.listeners[0]?.({ agent: { id: 'session-test-1', ctx: agent.ctx } })

      // section 经 effect 登记（作用域随 agent 生命周期销毁——scoped 注册的正确挂法）
      expect(agent.effects.length).toBe(1)
      expect(agent.effects[0]?.()).toBe('disposed-token') // 执行 effect 体 → section() 返回值直通
      expect(agent.sections).toStrictEqual([
        { name: SECTION_NAME, order: 42, text: '# Studio Next 指令\n每答必附标记串 MARK-X。\n' },
      ])
      expect(agent.orders).toStrictEqual([SECTION_PLACEMENT]) // 官方放置位：persona 前缀
    } finally {
      if (saved === undefined) delete process.env[DEFAULT_INSTRUCTIONS_ENV]
      else process.env[DEFAULT_INSTRUCTIONS_ENV] = saved
    }
  })

  it('自定义 config 透传：sectionName 覆盖 + instructionsEnv 换变量名', async () => {
    const p2 = join(workdir, 'instructions-2.md')
    writeFileSync(p2, '指令 B')
    const plugin = fakePluginCtx()
    apply(plugin.ctx, { sectionName: 'co:my-section', instructionsEnv: 'OTHER_INSTRUCTIONS' })
    const saved = process.env['OTHER_INSTRUCTIONS']
    process.env['OTHER_INSTRUCTIONS'] = p2
    try {
      const agent = fakeAgentContext()
      await plugin.listeners[0]?.({ agent: { ctx: agent.ctx } })
      agent.effects[0]?.() // effect 体执行才落 section（scoped 注册的延迟语义——同首测）
      expect(agent.sections[0]?.name).toBe('co:my-section')
      expect(agent.sections[0]?.text).toBe('指令 B')
    } finally {
      if (saved === undefined) delete process.env['OTHER_INSTRUCTIONS']
      else process.env['OTHER_INSTRUCTIONS'] = saved
    }
  })

  it('env 未设（默认 required=false）：不注册 section、不抛（降级继续）', async () => {
    const saved = process.env[DEFAULT_INSTRUCTIONS_ENV]
    delete process.env[DEFAULT_INSTRUCTIONS_ENV]
    try {
      const plugin = fakePluginCtx()
      apply(plugin.ctx, {})
      const agent = fakeAgentContext()
      await expect(
        plugin.listeners[0]?.({ agent: { ctx: agent.ctx } }),
      ).resolves.toBeUndefined()
      expect(agent.sections).toStrictEqual([])
      expect(agent.effects).toStrictEqual([])
    } finally {
      if (saved !== undefined) process.env[DEFAULT_INSTRUCTIONS_ENV] = saved
    }
  })

  it('required=true + env 未设：监听器抛错（serial agent/created 上抛=agent 创建被拦截）', async () => {
    const saved = process.env[DEFAULT_INSTRUCTIONS_ENV]
    delete process.env[DEFAULT_INSTRUCTIONS_ENV]
    try {
      const plugin = fakePluginCtx()
      apply(plugin.ctx, { required: true })
      const agent = fakeAgentContext()
      await expect(plugin.listeners[0]?.({ agent: { ctx: agent.ctx } })).rejects.toThrow(
        /required=true/,
      )
      expect(agent.sections).toStrictEqual([])
    } finally {
      if (saved !== undefined) process.env[DEFAULT_INSTRUCTIONS_ENV] = saved
    }
  })

  it('宿主形态不符（agent 无 ctx / 缺 systemPrompt 服务）：默认降级不抛；required=true 抛错', async () => {
    const p3 = join(workdir, 'instructions-3.md')
    writeFileSync(p3, '指令 C')
    const saved = process.env[DEFAULT_INSTRUCTIONS_ENV]
    process.env[DEFAULT_INSTRUCTIONS_ENV] = p3
    try {
      const lax = fakePluginCtx()
      apply(lax.ctx, {})
      await expect(lax.listeners[0]?.({ agent: { id: 'bare' } })).resolves.toBeUndefined()

      const strict = fakePluginCtx()
      apply(strict.ctx, { required: true })
      await expect(strict.listeners[0]?.({ agent: { id: 'bare' } })).rejects.toThrow(
        /缺 systemPrompt/,
      )
      const noService = fakeAgentContext()
      const hollow: AgentContextLike = { effect: noService.ctx.effect }
      await expect(strict.listeners[0]?.({ agent: { ctx: hollow } })).rejects.toThrow(
        /缺 systemPrompt/,
      )
    } finally {
      if (saved === undefined) delete process.env[DEFAULT_INSTRUCTIONS_ENV]
      else process.env[DEFAULT_INSTRUCTIONS_ENV] = saved
    }
  })
})

// ---------------------------------------------------------------------------
// 可分发件形状（dsh.bundle）
// ---------------------------------------------------------------------------

describe('可分发件形状（dsh.bundle 声明——docs/34-§3.1：长期插件带 bundle 入场券）', () => {
  it('package.json：dsh.bundle.patch 指向真实存在的补丁文件；exports 指向插件源', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
      name?: string
      exports?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
      dependencies?: Record<string, string>
    }
    expect(pkg.name).toBe('@studio-next/dsh-bridge')
    expect(pkg.exports?.['.']).toBe('./src/index.ts')
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(existsSync(join(pkgRoot, 'cordis.patch.yml'))).toBe(true)
    expect(existsSync(join(pkgRoot, 'src', 'index.ts'))).toBe(true)
    // 零依赖纪律：插件包不声明任何运行时依赖（node 内置 + loader 解析上下文）
    expect(pkg.dependencies).toBeUndefined()
  })

  it('cordis.patch.yml：insert 键包完整条目（docs/34-§3.1 语法铁律）+ 相对路径 name + env 指名', () => {
    const patch = readFileSync(join(pkgRoot, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('- insert:')
    expect(patch).toContain('id: studio-next-bridge')
    expect(patch).toContain('name: ./src/index.ts') // 相对路径锚定补丁文件目录
    expect(patch).toContain(`instructionsEnv: ${DEFAULT_INSTRUCTIONS_ENV}`)
  })
})
