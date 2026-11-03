/**
 * boot-secret-declarations.test.ts —— 组合根读部署秘密声明（PORT-TRUST 登记输入）
 *
 * 依据：docs/v2/14 §1.7（PORT-TRUST）、docs/v2/15 §4.1（五型/值只经 env/短命句柄通道）、
 *   §4.5（三不入：声明文件只含引用侧字段）；docs/17-§2（装配在组合根，不新增主循环相位）。
 *
 * 断言口径（缺证即拒）：未配置 env＝目录空置（undefined，不造缺省声明）；文件不可读/非
 *   JSON/形状非法＝CONFIG_INVALID 拒启；`SEC-MX-BOT-PASSWORD` 的 allowedUses 与
 *   provision.ts 唯一源漂移＝拒启（不静默取一边）。日志只报条数，不报值。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SECRET_DECLARATIONS_ENV, readSecretDeclarationsFromEnv } from '../../src/boot.ts'

const WINDOW = { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }
const ROOT = {
  secretId: 'SEC-GW-ROOT',
  secretType: 'signing_root_control',
  credentialClass: 'root',
  logicalReference: 'cred-root@company',
  boundGrant: { recordId: 'grant-root-1', refVersion: '1.0.0' },
  allowedUses: ['gateway-sign'],
  validWindow: WINDOW,
  exposureScope: 'position:PRIME-0',
  valueProvider: { type: 'broker-ref', secretId: 'SEC-GW-ROOT', profile: 'root-broker' },
}
const BOT = {
  secretId: 'SEC-MX-BOT-PASSWORD',
  secretType: 'platform_credential',
  credentialClass: 'scoped',
  logicalReference: 'mx-bot@company',
  boundGrant: { recordId: 'grant-root-1', refVersion: '1.0.0' },
  parentCredentialRef: 'SEC-GW-ROOT',
  allowedUses: ['platform-auth', 'outbound-redaction'],
  validWindow: WINDOW,
  exposureScope: 'deployment:studio-dev',
  valueProvider: { type: 'env-ref', name: 'MATRIX_BOT_PASSWORD' },
}

const dirs: string[] = []

function writeDeclarations(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'studio-boot-secrets-'))
  dirs.push(dir)
  const file = path.join(dir, 'declarations.json')
  writeFileSync(file, content)
  return file
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('readSecretDeclarationsFromEnv：缺证即拒', () => {
  it('未配置 env → undefined（目录空置，不造缺省声明）', () => {
    expect(readSecretDeclarationsFromEnv({})).toBeUndefined()
  })

  it('合法引用侧 JSON → 返回声明并只报条数（不报值）', () => {
    const lines: string[] = []
    const file = writeDeclarations(JSON.stringify([ROOT, BOT]))
    const declarations = readSecretDeclarationsFromEnv({ [SECRET_DECLARATIONS_ENV]: file }, (line) => lines.push(line))
    expect(declarations).toHaveLength(2)
    expect(lines.join('\n')).toContain('秘密声明已装载：2 条')
    expect(lines.join('\n')).not.toContain('MATRIX_BOT_PASSWORD=')
  })

  it('文件不可读 → CONFIG_INVALID 拒启（不回落空目录）', () => {
    expect(() => readSecretDeclarationsFromEnv({ [SECRET_DECLARATIONS_ENV]: '/nonexistent/declarations.json' })).toThrow(
      /CONFIG_INVALID：秘密声明文件不可读\/非 JSON/,
    )
  })

  it('非 JSON/非数组/项缺 secretId → CONFIG_INVALID 拒启', () => {
    const invalidJson = writeDeclarations('{not-json')
    expect(() => readSecretDeclarationsFromEnv({ [SECRET_DECLARATIONS_ENV]: invalidJson })).toThrow(/CONFIG_INVALID/)
    const notArray = writeDeclarations(JSON.stringify({ secretId: 'SEC-GW-ROOT' }))
    expect(() => readSecretDeclarationsFromEnv({ [SECRET_DECLARATIONS_ENV]: notArray })).toThrow(
      /CONFIG_INVALID\/trust-declarations-invalid/,
    )
    const missingId = writeDeclarations(JSON.stringify([{ ...ROOT, secretId: '' }]))
    expect(() => readSecretDeclarationsFromEnv({ [SECRET_DECLARATIONS_ENV]: missingId })).toThrow(
      /CONFIG_INVALID\/trust-declarations-invalid/,
    )
  })

  it('BOT_PASSWORD allowedUses 漂移 → CONFIG_INVALID 拒启（唯一源=provision.ts）', () => {
    const file = writeDeclarations(JSON.stringify([ROOT, { ...BOT, allowedUses: ['platform-auth'] }]))
    expect(() => readSecretDeclarationsFromEnv({ [SECRET_DECLARATIONS_ENV]: file })).toThrow(
      /CONFIG_INVALID：SEC-MX-BOT-PASSWORD 的 allowedUses 与 provision.ts BOT_PASSWORD_SECRET 不一致/,
    )
  })
})
