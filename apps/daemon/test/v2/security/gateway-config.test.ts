/**
 * gateway-config.test.ts —— daemon 装配面 fail-closed（SEC-FC-01/02＋SEC-WD-02）
 *
 * 依据：v2/15 §一 SEC-FC-01（daemon.yaml `gateway:` 键删除；关掉即裸分支不得存在）／SEC-FC-02
 *   （签根无配置＝拒启，dev 常量删除）；v2/15 §三 SEC-WD-02（唯一绑定源＝daemon.yaml；org-config
 *   platform 与部署面不一致＝CONFIG_INVALID 拒启）；v2/17 NEG-SEC-01/N-a（绕网关无路径）、
 *   NEG-SEC-02 启动腿；docs/plan/05 IMPL-07-06「无配置拒启」「绑定不一致拒启」。
 *
 * 断言口径：放行路径必须不存在——旧键出现即拒、缺签根即拒、错绑即拒；无「告警继续」分支。
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SERVE_CONFIG,
  GATEWAY_SECRET_ENV,
  assertPlatformBinding,
  daemonIdentity,
  parseDaemonConfig,
  resolveGatewaySecret,
  type ServeConfig,
} from '../../../src/assembly/serve/config.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'
import type { CompanySnapshot } from '@studio-next/contract'

/** 合法签根（32 ASCII 字节；显式注入，不来自任何仓内常量） */
const SECRET_TEXT = '0123456789abcdef0123456789abcdef'
const FAKE_CONFIG = parseDaemonConfig(['db: ./var/x.sqlite', 'company: demo', 'platform: fake', ''].join('\n'))
const COMPANY_DIR = path.resolve('/tmp/studio-next-test-company')
/** org-config 声明 localfile（真实公司目录形态） */
const ORG_LOCALFILE: CompanySnapshot = { ...DEMO_SNAPSHOT, platform: { platform: 'localfile' } }
/** org-config 未声明 platform → 装载面 validator 缺省 youtrack（company/src/validator.ts） */
const ORG_DEFAULT_YOUTRACK: CompanySnapshot = { ...DEMO_SNAPSHOT, platform: { platform: 'youtrack' } }

function withCompanyDir(base: ServeConfig, over: Partial<ServeConfig> = {}): ServeConfig {
  return { ...base, companyDir: COMPANY_DIR, ...over }
}

function catchError(run: () => unknown): string {
  try {
    run()
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  throw new Error('期望 CONFIG_INVALID 拒启，实际放行（fail-open 路径仍在）')
}

describe('SEC-FC-01 daemon.yaml `gateway:` 键删除（旧的「关掉即裸」开关不得回来）', () => {
  it('`gateway: false` / `gateway: true` 均＝CONFIG_INVALID/gateway-key-removed（键已删除，非未知键泛化）', () => {
    expect(catchError(() => parseDaemonConfig('platform: fake\ngateway: false\n'))).toMatch(/CONFIG_INVALID\/gateway-key-removed/)
    expect(catchError(() => parseDaemonConfig('platform: fake\ngateway: true\n'))).toMatch(/CONFIG_INVALID\/gateway-key-removed/)
  })

  it('`gatewaySecret:` 值键同样删除（值永不入 daemon.yaml——SEC-FC-02）', () => {
    expect(catchError(() => parseDaemonConfig(`platform: fake\ngatewaySecret: ${SECRET_TEXT}\n`))).toMatch(
      /CONFIG_INVALID\/gateway-key-removed/,
    )
    // 报错文本不得回显被拒的值（密钥扫描面）
    expect(catchError(() => parseDaemonConfig(`platform: fake\ngatewaySecret: ${SECRET_TEXT}\n`))).not.toContain(SECRET_TEXT)
  })

  it('收口位恒开（类型事实＋缺省事实）：无配置键可关，DEFAULT.gateway 恒 true', () => {
    expect(DEFAULT_SERVE_CONFIG.gateway).toBe(true)
    expect(parseDaemonConfig('platform: fake\ncompany: demo\n').gateway).toBe(true)
  })
})

describe('SEC-FC-02 签根只从秘密源注入（无仓内缺省）', () => {
  it('env 注入优先：origin=env，材料=env 值 UTF-8 字节', () => {
    const resolved = resolveGatewaySecret(FAKE_CONFIG, { env: { [GATEWAY_SECRET_ENV]: SECRET_TEXT } })
    expect(resolved.origin).toBe('env')
    expect(Buffer.from(resolved.secret).toString('utf8')).toBe(SECRET_TEXT)
  })

  it('env 已设但为空串 → CONFIG_INVALID/gw-secret-empty（不落 demo 兜底）', () => {
    const message = catchError(() =>
      resolveGatewaySecret(FAKE_CONFIG, { env: { [GATEWAY_SECRET_ENV]: '' }, random: (): Uint8Array => new Uint8Array(32).fill(3) }),
    )
    expect(message).toMatch(/CONFIG_INVALID\/gw-secret-empty/)
    expect(message).toContain(GATEWAY_SECRET_ENV)
  })

  it('无公司目录 demo（platform: fake）→ 进程内临时签根（origin=demo-ephemeral，32 字节，可注入随机源）', () => {
    let randomCalls = 0
    const resolved = resolveGatewaySecret(FAKE_CONFIG, {
      env: {},
      random: (bytes: number): Uint8Array => {
        randomCalls += 1
        return new Uint8Array(bytes).fill(3)
      },
    })
    expect(resolved.origin).toBe('demo-ephemeral')
    expect(resolved.secret.byteLength).toBe(32)
    expect(randomCalls).toBe(1)
  })

  it('非 demo（有公司目录）缺签根 → CONFIG_INVALID/gw-secret-missing（消息含 env 键名，不含值）', () => {
    for (const config of [withCompanyDir(FAKE_CONFIG), { ...FAKE_CONFIG, platform: 'localfile' as const }]) {
      const message = catchError(() => resolveGatewaySecret(config, { env: {} }))
      expect(message).toMatch(/CONFIG_INVALID\/gw-secret-missing/)
      expect(message).toContain(GATEWAY_SECRET_ENV)
    }
  })

  it('daemonIdentity：env 形态标记 secretSource=env；身份四件从快照取', () => {
    const identity = daemonIdentity(withCompanyDir(FAKE_CONFIG, { platform: 'localfile' }), ORG_LOCALFILE, {
      env: { [GATEWAY_SECRET_ENV]: SECRET_TEXT },
    })
    expect(identity.secretSource).toBe('env')
    expect(identity.author).toBe('daemon')
    expect(identity.ctx.company).toBe('Demo 公司')
    expect(identity.ctx.level).toBe(2)
    expect(Buffer.from(identity.secret).toString('utf8')).toBe(SECRET_TEXT)
  })

  it('daemonIdentity：demo 形态标记降级来源（secretSource=demo-ephemeral）', () => {
    const identity = daemonIdentity(FAKE_CONFIG, DEMO_SNAPSHOT, { env: {}, random: (n: number): Uint8Array => new Uint8Array(n).fill(5) })
    expect(identity.secretSource).toBe('demo-ephemeral')
  })

  it('daemonIdentity：非 demo 缺签根＝拒启（启动腿，不产出身份对象）', () => {
    expect(catchError(() => daemonIdentity(withCompanyDir(FAKE_CONFIG, { platform: 'localfile' }), ORG_LOCALFILE, { env: {} }))).toMatch(
      /CONFIG_INVALID\/gw-secret-missing/,
    )
  })
})

describe('SEC-WD-02 绑定唯一源与一致性校验（org-config platform vs daemon.yaml platform）', () => {
  it('不一致 → CONFIG_INVALID/platform-binding-mismatch（拒绝静默错绑）', () => {
    const config = withCompanyDir(FAKE_CONFIG, { platform: 'taiga' })
    expect(catchError(() => assertPlatformBinding(config, ORG_LOCALFILE))).toMatch(/CONFIG_INVALID\/platform-binding-mismatch/)
    // org-config 未声明时 validator 缺省 youtrack＝视为声明 → 与部署面不同即拒
    expect(catchError(() => assertPlatformBinding(withCompanyDir(FAKE_CONFIG, { platform: 'localfile' }), ORG_DEFAULT_YOUTRACK))).toMatch(
      /CONFIG_INVALID\/platform-binding-mismatch/,
    )
  })

  it('一致（含大小写/空白归一）→ 放行；绑定比对先于签根解析（错绑即拒，不必先配密钥）', () => {
    const config = withCompanyDir(FAKE_CONFIG, { platform: 'localfile' })
    expect(() => assertPlatformBinding(config, ORG_LOCALFILE)).not.toThrow()
    expect(() => assertPlatformBinding(config, { ...DEMO_SNAPSHOT, platform: { platform: ' LocalFile ' } })).not.toThrow()
    // 错绑 + 无签根：抛的是绑定错误（启动序①先于②），不是「缺签根」噪声
    expect(catchError(() => daemonIdentity(withCompanyDir(FAKE_CONFIG, { platform: 'taiga' }), ORG_LOCALFILE, { env: {} }))).toMatch(
      /CONFIG_INVALID\/platform-binding-mismatch/,
    )
  })

  it('无公司目录（demo/夹具装配）＝无 org-config 声明面，绑定比对跳过（不错绑即不误伤）', () => {
    expect(() => assertPlatformBinding({ ...FAKE_CONFIG, platform: 'localfile' }, ORG_DEFAULT_YOUTRACK)).not.toThrow()
    expect(() => daemonIdentity(FAKE_CONFIG, DEMO_SNAPSHOT, { env: {}, random: (n: number): Uint8Array => new Uint8Array(n).fill(7) })).not.toThrow()
  })
})
