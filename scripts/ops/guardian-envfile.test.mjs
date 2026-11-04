/** 787：guardian 凭据隔离 envFile（node:test；直接 import scripts/guardian.mjs 纯函数） */
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { parseEnvFile, readEnvFile, validateConfig } from '../guardian.mjs'

const roots = []
after(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })
function tempDir() { const d = mkdtempSync(path.join(tmpdir(), 'sn-guardian-env-')); roots.push(d); return d }

function baseConfig(envFile) {
  return {
    daemon: { command: ['/bin/true'], cwd: '/tmp', ...(envFile !== undefined ? { envFile } : {}), env: { PATH: '/usr/bin:/bin', NODE_ENV: 'production' } },
    health: { url: 'http://127.0.0.1:1/healthz' },
    paths: { logDir: '/tmp' },
  }
}

test('parseEnvFile：注释/空行/export/空白归一；非法行抛', () => {
  assert.deepEqual(parseEnvFile('# c\n\n A=1 \nexport B=2\nC=\n'), { A: '1', B: '2', C: '' })
  assert.throws(() => parseEnvFile('NOEQUALS'), /KEY=VALUE/)
  assert.throws(() => parseEnvFile('1A=X'), /key 非法/)
})

test('readEnvFile：0600 读取；缺失/权限 0644/非文件 → 抛', () => {
  const dir = tempDir(); const file = path.join(dir, 'daemon.env')
  writeFileSync(file, 'TAIGA_PASSWORD=fixture\nMATRIX_BOT_PASSWORD=fixture2\n', { mode: 0o600 }); chmodSync(file, 0o600)
  assert.deepEqual(readEnvFile(file), { TAIGA_PASSWORD: 'fixture', MATRIX_BOT_PASSWORD: 'fixture2' })
  chmodSync(file, 0o644)
  assert.throws(() => readEnvFile(file), /权限过宽/)
  assert.throws(() => readEnvFile(path.join(dir, 'missing.env')), /不存在/)
  assert.throws(() => readEnvFile(dir), /不是普通文件/)
})

test('validateConfig：envFile 合并且优先覆盖 inline；0600 才过；缺失/过宽 fail-closed', () => {
  const dir = tempDir(); const file = path.join(dir, 'daemon.env')
  writeFileSync(file, 'TAIGA_PASSWORD=from-file\nSTUDIO_GATEWAY_SECRET=file-secret\n', { mode: 0o600 }); chmodSync(file, 0o600)
  const config = validateConfig(baseConfig(file))
  assert.equal(config.daemon.envFile, file)
  assert.equal(config.daemon.env.TAIGA_PASSWORD, 'from-file')
  assert.equal(config.daemon.env.STUDIO_GATEWAY_SECRET, 'file-secret')
  assert.equal(config.daemon.env.NODE_ENV, 'production') // inline 安全键保留
  // 同名键 envFile 覆盖 inline（迁移期不静默用旧 inline 秘密）
  writeFileSync(file, 'TAIGA_PASSWORD=file-wins\n', { mode: 0o600 }); chmodSync(file, 0o600)
  const cfg2 = validateConfig({ ...baseConfig(file), daemon: { ...baseConfig(file).daemon, env: { PATH: '/usr/bin:/bin', TAIGA_PASSWORD: 'inline-old' } } })
  assert.equal(cfg2.daemon.env.TAIGA_PASSWORD, 'file-wins')
  // 缺失
  assert.throws(() => validateConfig(baseConfig(path.join(dir, 'missing.env'))), /不存在/)
  // 过宽
  chmodSync(file, 0o640)
  assert.throws(() => validateConfig(baseConfig(file)), /权限过宽/)
  // 不配 envFile 的旧配置仍合法（studio-dev 平滑迁移）
  assert.equal(validateConfig(baseConfig(undefined)).daemon.envFile, undefined)
})

test('CLI fail-fast：坏 envFile 配置 exit1 且不启动 daemon', () => {
  const dir = tempDir(); const file = path.join(dir, 'daemon.env')
  writeFileSync(file, 'X=Y\n', { mode: 0o600 }); chmodSync(file, 0o644)
  const configPath = path.join(dir, 'guardian.json')
  writeFileSync(configPath, JSON.stringify(baseConfig(file)), 'utf8')
  const { spawnSync } = process.getBuiltinModule('node:child_process')
  const res = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'guardian.mjs'), '--config', configPath], { encoding: 'utf8' })
  assert.equal(res.status, 1)
  assert.match(res.stderr, /权限过宽/)
})
