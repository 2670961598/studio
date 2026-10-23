/**
 * agent.yaml 装载与接线测试 —— loadAgentConfig 四态 + wireRegistry + 内置捷径覆盖（docs/17-§4）
 *
 * 覆盖：
 *   - loadAgentConfig 四态：合法全文 / 缺 executors 段 / 坏形状（zod 路径定位）/ yaml 语法错
 *     （行号进 detail——docs/16-§二 yaml@2 带行号 AST 的用途）
 *   - 边界：空 executors 段、空条目（`kimi: {}`=用缺省）、顶层未知键（agent.yaml 与
 *     models.yaml 是分文件，17-§4）、agents_md 词汇外（docs 示例 "dsh_home" 疑点用例）
 *   - wireRegistry：builtinResolver 四家接线（注册序=书写序）、cmd 覆盖注入（spy +
 *     fake CLI 端到端 detect）、未知名明报（配置有而代码无）、能力漂移明报（镜像≠伪造）、
 *     双 default 拒收（注册表口径）
 *   - registerBuiltins overrides：cmd 改道端到端（FAKE_VERSION 回放）
 *
 * env 注入说明：适配器 spawn/detect 用 {...process.env} 打底——FAKE_* 旋钮经 process.env
 * 临时注入、finally 还原（withFakeEnv，与 dsh.test.ts 同款），不污染其他用例。
 */
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ClassifiedError } from '@studio-next/contract'
import {
  builtinResolver,
  dshModelFromPatches,
  loadAgentConfig,
  registerBuiltins,
  wireRegistry,
} from '../src/agentconfig.ts'
import type { AdapterResolver } from '../src/agentconfig.ts'
import { ClaudeAdapter } from '../src/claude.ts'
import { DshAdapter } from '../src/dsh.ts'
import { KimiAdapter } from '../src/kimi.ts'
import { createRegistry } from '../src/registry.ts'

const fakeCli = fileURLToPath(new URL('./fake-cli/fake-cli.mjs', import.meta.url))
const join = path.join

/** 临时注入 FAKE_* 旋钮到 process.env（适配器 detect 时展开），结束还原 */
async function withFakeEnv(kvs: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const saved = new Map<string, string | undefined>()
  for (const [k, v] of Object.entries(kvs)) {
    saved.set(k, process.env[k])
    process.env[k] = v
  }
  try {
    await fn()
  } finally {
    for (const [k, v] of saved.entries()) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

/** 捕获 CONFIG_INVALID 并断言两级分类形状（category + subcause 机器可比对键） */
function captureConfigInvalid(fn: () => unknown): Error & ClassifiedError {
  try {
    fn()
  } catch (e) {
    const err = e as Error & ClassifiedError
    expect(err.category).toBe('CONFIG_INVALID')
    expect(typeof err.subcause).toBe('string')
    expect(err.subcause.length).toBeGreaterThan(0)
    return err
  }
  throw new Error('期望抛出 CONFIG_INVALID，实际未抛出')
}

/** 合法全文样本（capabilities 镜像与四家代码声明一致——漂移检查的对照基准；
 *  dsh.session_resume=true 随 studio-dev-230 P0 翻转，2026-10-23） */
const legalYaml = `executors:
  dsh:
    default: true
    version: "0.2.0-rc.2"
    cmd: [dsh, --profile, headless, --json]
    capabilities:
      budget_cap: false
      cancel_turn: false
      session_resume: true
      agents_md: user_level
      cost_native: false
    patches:
      prod: { model: high }
      explore: { model: low }
    plugins: [yt-gateway, webbridge]
  claude:
    cmd: [claude]
    capabilities:
      budget_cap: true
      cost_native: true
`

describe('loadAgentConfig：四态与边界', () => {
  it('合法全文：记录结构与书写序如实（patches 透传不解释、plugins 数组、version 档案字段）', () => {
    const config = loadAgentConfig(legalYaml)
    expect(config.executors.map((e) => e.name)).toStrictEqual(['dsh', 'claude'])

    const dsh = config.executors[0]
    expect(dsh?.default).toBe(true)
    expect(dsh?.version).toBe('0.2.0-rc.2')
    expect(dsh?.cmd).toStrictEqual(['dsh', '--profile', 'headless', '--json'])
    expect(dsh?.capabilities).toStrictEqual({
      budget_cap: false,
      cancel_turn: false,
      session_resume: true, // studio-dev-230 P0 翻转（2026-10-23）
      agents_md: 'user_level',
      cost_native: false,
    })
    expect(dsh?.patches).toStrictEqual({ prod: { model: 'high' }, explore: { model: 'low' } })
    expect(dsh?.plugins).toStrictEqual(['yt-gateway', 'webbridge'])

    const claude = config.executors[1]
    expect(claude?.default).toBe(false)
    expect(claude?.cmd).toStrictEqual(['claude'])
    expect(claude?.capabilities.budget_cap).toBe(true)
    expect(claude?.capabilities.cost_native).toBe(true)
    expect(claude?.version).toBeUndefined() // 档案字段缺省=undefined，不伪造
  })

  it('缺 executors 段 → CONFIG_INVALID/agentconfig/missing-section', () => {
    const err = captureConfigInvalid(() => loadAgentConfig('models:\n  tiers: {}\n'))
    expect(err.subcause).toBe('agentconfig/missing-section')
  })

  it('yaml 语法错 → CONFIG_INVALID/agentconfig/parse，detail 带行号（yaml@2 行号 AST）', () => {
    const err = captureConfigInvalid(() => loadAgentConfig('executors: [\n  dsh: {}\n'))
    expect(err.subcause).toBe('agentconfig/parse')
    expect(err.message).toMatch(/第 \d+ 行/)
  })

  it('坏形状：capabilities.budget_cap 传字符串 → shape，路径定位到字段', () => {
    const err = captureConfigInvalid(() =>
      loadAgentConfig('executors:\n  dsh:\n    capabilities:\n      budget_cap: "false"\n'),
    )
    expect(err.subcause).toBe('agentconfig/shape')
    expect(err.message).toContain('capabilities.budget_cap')
  })

  it('坏形状：cmd 非数组 → shape', () => {
    const err = captureConfigInvalid(() => loadAgentConfig('executors:\n  dsh:\n    cmd: dsh\n'))
    expect(err.subcause).toBe('agentconfig/shape')
    expect(err.message).toContain('cmd')
  })

  it('坏形状：agents_md 词汇外（docs/17-§4 示例 "dsh_home"）→ shape（文档疑点用例，见 agentconfig.ts 头注）', () => {
    const err = captureConfigInvalid(() =>
      loadAgentConfig('executors:\n  dsh:\n    capabilities:\n      agents_md: dsh_home\n'),
    )
    expect(err.subcause).toBe('agentconfig/shape')
    expect(err.message).toContain('agents_md')
  })

  it('坏形状：条目未知键 → shape（strictObject 拦截拼写漂移）', () => {
    const err = captureConfigInvalid(() =>
      loadAgentConfig('executors:\n  dsh:\n    capabilitiez: {}\n'),
    )
    expect(err.subcause).toBe('agentconfig/shape')
    expect(err.message).toContain('capabilitiez')
  })

  it('坏形状：根非映射（数组/标量）与 executors 值为 null → shape', () => {
    const arrErr = captureConfigInvalid(() => loadAgentConfig('- dsh\n- claude\n'))
    expect(arrErr.subcause).toBe('agentconfig/shape')
    const nullErr = captureConfigInvalid(() => loadAgentConfig('executors:\n'))
    expect(nullErr.subcause).toBe('agentconfig/shape')
    expect(nullErr.message).toContain('executors')
  })

  it('坏形状：顶层未知键（models 混入 agent.yaml）→ shape（17-§4 分文件口径）', () => {
    const err = captureConfigInvalid(() =>
      loadAgentConfig('executors:\n  dsh: {}\nmodels:\n  tiers: {}\n'),
    )
    expect(err.subcause).toBe('agentconfig/shape')
    expect(err.message).toContain('models')
  })

  it('空 executors 段 → CONFIG_INVALID/agentconfig/no-executors', () => {
    const err = captureConfigInvalid(() => loadAgentConfig('executors: {}\n'))
    expect(err.subcause).toBe('agentconfig/no-executors')
  })

  it('空条目合法：`kimi: {}` = 用适配器缺省命令与声明', () => {
    const config = loadAgentConfig('executors:\n  kimi: {}\n')
    expect(config.executors.length).toBe(1)
    const kimi = config.executors[0]
    expect(kimi?.name).toBe('kimi')
    expect(kimi?.cmd).toBeUndefined()
    expect(kimi?.default).toBe(false)
    expect(kimi?.capabilities).toStrictEqual({})
  })

  it('书写序保留：注册序来源=agent.yaml 键序（yaml@2 保序）', () => {
    const config = loadAgentConfig('executors:\n  kimi: {}\n  dsh: { default: true }\n')
    expect(config.executors.map((e) => e.name)).toStrictEqual(['kimi', 'dsh'])
  })
})

describe('wireRegistry：配置 → 注册表接线', () => {
  it('合法配置 + builtinResolver：四家接入、dsh default、注册序=书写序', () => {
    const registry = wireRegistry(createRegistry(), loadAgentConfig(legalYaml), builtinResolver)
    expect(registry.list().map((e) => e.name)).toStrictEqual(['dsh', 'claude'])
    expect(registry.defaultName()).toBe('dsh')
    expect(registry.resolve('claude')).toBeInstanceOf(ClaudeAdapter)
    // 能力路由可用：要预算帽只剩 claude（镜像一致不折损路由）
    expect(registry.pickAll({ budgetCap: true }).map((a) => a.name)).toStrictEqual(['claude'])
  })

  it('cmd 覆盖注入：工厂收到的 cmd=配置值；无 cmd 的家收 undefined（落适配器缺省）', () => {
    const seen = new Map<string, readonly string[] | undefined>()
    const spyResolver: AdapterResolver = (name) => {
      const base = builtinResolver(name)
      return base === undefined
        ? undefined
        : (cmd) => {
            seen.set(name, cmd)
            return base(cmd)
          }
    }
    const registry = wireRegistry(
      createRegistry(),
      loadAgentConfig('executors:\n  dsh: { default: true }\n  claude: { cmd: [claude-x, --probe] }\n'),
      spyResolver,
    )
    expect(seen.get('claude')).toStrictEqual(['claude-x', '--probe'])
    expect(seen.get('dsh')).toBeUndefined()
    expect(registry.list().map((e) => e.name)).toStrictEqual(['dsh', 'claude'])
  })

  it('cmd 覆盖注入端到端：claude cmd=[node,fake-cli] + FAKE_VERSION → detect ok（注入到达适配器）', async () => {
    const registry = wireRegistry(
      createRegistry(),
      loadAgentConfig(`executors:\n  claude:\n    cmd: [${process.execPath}, ${fakeCli}]\n`),
      builtinResolver,
    )
    await withFakeEnv({ FAKE_VERSION: '2.1.300' }, async () => {
      const det = await registry.resolve('claude').detect()
      expect(det.ok).toBe(true)
      expect(det.version).toBe('2.1.300')
      expect(det.gaps).toStrictEqual([]) // ≥2.1.277 无降级 gap
    })
  })

  it('未知名（配置有而代码无）→ CONFIG_INVALID/agentconfig/unknown-executor', () => {
    const err = captureConfigInvalid(() =>
      wireRegistry(createRegistry(), loadAgentConfig('executors:\n  probe: {}\n'), builtinResolver),
    )
    expect(err.subcause).toBe('agentconfig/unknown-executor')
    expect(err.message).toContain('probe')
  })

  it('能力漂移：配置伪造 dsh budget_cap=true → CONFIG_INVALID/agentconfig/cap-drift', () => {
    const err = captureConfigInvalid(() =>
      wireRegistry(
        createRegistry(),
        loadAgentConfig('executors:\n  dsh:\n    capabilities:\n      budget_cap: true\n'),
        builtinResolver,
      ),
    )
    expect(err.subcause).toBe('agentconfig/cap-drift')
    expect(err.message).toContain('dsh.capabilities.budget_cap')
    expect(err.message).toContain('代码=false')
  })

  it('能力镜像一致（全量与部分）→ 放行：部分镜像只比对给出字段', () => {
    const registry = wireRegistry(
      createRegistry(),
      loadAgentConfig(
        'executors:\n  dsh:\n    default: true\n    capabilities: { session_resume: true }\n  kimi:\n    capabilities:\n      budget_cap: false\n      cancel_turn: false\n      session_resume: true\n      agents_md: native\n      cost_native: false\n',
      ),
      builtinResolver,
    )
    expect(registry.list().map((e) => e.name)).toStrictEqual(['dsh', 'kimi'])
    expect(registry.pick({ sessionResume: true })?.name).toBe('dsh') // 两家皆可续——default（dsh）优先（studio-dev-230 P0 翻转后 dsh 亦满足过滤）
  })

  it('双 default 配置 → wireRegistry 经注册表拒收（CONFIG_INVALID/executor/dup-default）', () => {
    const err = captureConfigInvalid(() =>
      wireRegistry(
        createRegistry(),
        loadAgentConfig('executors:\n  dsh: { default: true }\n  claude: { default: true }\n'),
        builtinResolver,
      ),
    )
    expect(err.subcause).toBe('executor/dup-default')
    expect(err.message).toContain('claude')
  })
})

// —— 132-§6.1 单A·C3 model 接线（studio-dev-168）：patches['agent-default-model'] 声明
//    镜像 → dsh 工厂 → DshAdapter.opts.model → ResultStats.model ——
describe('dshModelFromPatches：agent-default-model 声明解析（dsh 家族专属消费）', () => {
  it('合法声明：{config:{provider,model}} → 归一形 provider/model', () => {
    expect(
      dshModelFromPatches({ 'agent-default-model': { config: { provider: 'glm', model: 'GLM-5.3' } } }),
    ).toBe('glm/GLM-5.3')
    expect(
      dshModelFromPatches({ 'agent-default-model': { config: { provider: 'deepseek', model: 'deepseek-flash' } } }),
    ).toBe('deepseek/deepseek-flash')
  })

  it('缺省面：patches 缺省 / 无该键 → undefined（未声明=无从可知，不猜——legalYaml 的 prod/explore 键不消费）', () => {
    expect(dshModelFromPatches(undefined)).toBeUndefined()
    expect(dshModelFromPatches({})).toBeUndefined()
    expect(dshModelFromPatches({ prod: { model: 'high' } })).toBeUndefined()
  })

  it('坏形状 → CONFIG_INVALID/agentconfig/dsh-model-patch（不静默不猜）', () => {
    const bad = (patches: Record<string, unknown>): void => {
      const err = captureConfigInvalid(() => dshModelFromPatches(patches))
      expect(err.subcause).toBe('agentconfig/dsh-model-patch')
    }
    bad({ 'agent-default-model': 'glm' }) // 非映射
    bad({ 'agent-default-model': ['glm'] }) // 数组
    bad({ 'agent-default-model': {} }) // 缺 config
    bad({ 'agent-default-model': { config: {} } }) // 缺 provider/model
    bad({ 'agent-default-model': { config: { provider: '', model: 'GLM-5.3' } } }) // 空 provider
    bad({ 'agent-default-model': { config: { provider: 'glm', model: 'GLM-5.3/extra' } } }) // '/' 歧义
  })
})

describe('wireRegistry model 接线（C3 端到端：agent.yaml 声明 → 工厂 → ResultStats.model）', () => {
  it('patches 透传：工厂第二参=该家 patches 段（generic 层不解释——解释在 dsh 家族工厂）', () => {
    const seen = new Map<string, Readonly<Record<string, unknown>> | undefined>()
    const spyResolver: AdapterResolver = (name) => {
      const base = builtinResolver(name)
      return base === undefined
        ? undefined
        : (cmd, patches) => {
            seen.set(name, patches)
            return base(cmd)
          }
    }
    wireRegistry(
      createRegistry(),
      loadAgentConfig(
        'executors:\n  dsh:\n    patches: { agent-default-model: { config: { provider: glm, model: GLM-5.3 } } }\n  claude: {}\n',
      ),
      spyResolver,
    )
    expect(seen.get('dsh')).toStrictEqual({
      'agent-default-model': { config: { provider: 'glm', model: 'GLM-5.3' } },
    })
    expect(seen.get('claude')).toBeUndefined() // 未声明 patches 的家收 undefined
  })

  it(
    '端到端：声明镜像经 dsh 内置工厂注入 → resultStats.model=归一形（fake CLI 全链）',
    async () => {
      const registry = wireRegistry(
        createRegistry(),
        loadAgentConfig(
          `executors:\n  dsh:\n    default: true\n    cmd: [${process.execPath}, ${fakeCli}]\n    patches:\n      agent-default-model: { config: { provider: glm, model: GLM-5.3 } }\n`,
        ),
        builtinResolver,
      )
      const adapter = registry.resolve('dsh')
      expect(adapter).toBeInstanceOf(DshAdapter)
      const workdir = mkdtempSync(join(tmpdir(), 'agentconfig-model-'))
      try {
        const briefPath = join(workdir, 'brief.md')
        writeFileSync(briefPath, 'TASK: model 接线探针（agent.yaml 声明镜像 → 工厂注入）')
        // dsh 位 env 收口为 DSH_ 前缀封闭允许集（docs/43-附录A-1）——fake 旋钮走 DSH_FAKE_*
        await withFakeEnv({ DSH_FAKE_ECHO_ARGS: '1' }, async () => {
          const h = await adapter.launch({
            ticket: 'TEST-MODEL',
            attempt: 1,
            briefPath,
            workspace: workdir,
            AGENTS_MD: { channel: 'native', target: join(workdir, 'AGENTS.md') },
          })
          for await (const ev of adapter.stream(h)) void ev
          const stats = await adapter.resultStats(h)
          expect(stats.model).toBe('glm/GLM-5.3')
        })
      } finally {
        rmSync(workdir, { recursive: true, force: true })
      }
    },
    10_000,
  )

  it('坏声明在接线期即拒（fail-fast：wireRegistry 构造适配器时校验，不待收割）', () => {
    const err = captureConfigInvalid(() =>
      wireRegistry(
        createRegistry(),
        loadAgentConfig(
          'executors:\n  dsh:\n    patches: { agent-default-model: { config: { provider: glm } } }\n',
        ),
        builtinResolver,
      ),
    )
    expect(err.subcause).toBe('agentconfig/dsh-model-patch')
  })
})

describe('registerBuiltins：四家内置捷径的 overrides', () => {
  it('dsh cmd 覆盖端到端：detect 走注入的 binary（node 恒在，缺省 dsh 未必安装）', async () => {
    const registry = registerBuiltins(createRegistry(), {
      dsh: { cmd: [process.execPath, fakeCli] },
    })
    const det = await registry.resolve('dsh').detect()
    expect(det.ok).toBe(true) // node --version 可解析——cmd[0] 注入生效
    expect(registry.defaultName()).toBe('dsh') // cmd 覆盖不动 default 旗标
  })

  it('kimi cmd 覆盖端到端：FAKE_VERSION 回放 → detect ok 且版本相符', async () => {
    const registry = registerBuiltins(createRegistry(), {
      kimi: { cmd: [process.execPath, fakeCli] },
    })
    await withFakeEnv({ FAKE_VERSION: '1.2.0' }, async () => {
      const det = await registry.resolve('kimi').detect()
      expect(det.ok).toBe(true)
      expect(det.version).toBe('1.2.0')
    })
    expect(registry.resolve('kimi')).toBeInstanceOf(KimiAdapter)
  })

  it('缺省注册表对已注册表叠加 → 拒收（dup-register，捷径不豁免唯一写入者纪律）', () => {
    const registry = registerBuiltins(createRegistry())
    const err = captureConfigInvalid(() => registerBuiltins(registry))
    expect(err.subcause).toBe('executor/dup-register')
  })
})
