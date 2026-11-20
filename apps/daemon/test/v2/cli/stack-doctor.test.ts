// stack-doctor.test —— doctor 六项体检判定纯函数测试（自 stack.test.ts 拆出——M5-2 行数门禁 600；V2 套件）。
// 覆盖：node>=24／companyDir／daemon.yaml platform=localfile／chatd 三件权限 0700·0600·0600／
// 备份目录可写／磁盘余量≥2GiB 六项绿红分支＋hint 明报＋doctorVerdict 汇总（plan/08-§2.3）。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkBackupDir,
  checkChatdPerms,
  checkCompanyDir,
  checkDaemonPlatform,
  checkDiskFree,
  checkNodeVersion,
  DISK_MIN_FREE_BYTES,
  doctorVerdict,
} from '../../../src/cli/stack/doctor.ts'

// 判定面只吃路径/状态入参——夹具只需路径字符串，无需落盘公司目录
let root = ''
let companyDir = ''
let configPath = ''

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'stack-doctor-test-'))
  companyDir = path.join(root, 'work', 'demo-corp')
  configPath = path.join(companyDir, 'daemon.yaml')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/* ---------------- 3. doctor 六项判定纯函数 ---------------- */

describe('doctor 六项判定纯函数', () => {
  it('1) node：24/25 绿，23 红＋hint', () => {
    expect(checkNodeVersion('24.21.0').ok).toBe(true)
    expect(checkNodeVersion('25.6.1').ok).toBe(true)
    const red = checkNodeVersion('23.11.0')
    expect(red.ok).toBe(false)
    expect((red.hint ?? '').includes('升级')).toBe(true)
  })

  it('2) companyDir：不存在红', () => {
    expect(checkCompanyDir('/abs/nope', { exists: false, isDir: false }).ok).toBe(false)
    expect(checkCompanyDir(companyDir, { exists: true, isDir: true }).ok).toBe(true)
  })

  it('3) daemon.yaml：localfile 绿；taiga/缺失红且 hint 明报', () => {
    const ok = checkDaemonPlatform({ path: configPath, exists: true, platform: 'localfile', error: null })
    expect(ok.ok).toBe(true)
    const taiga = checkDaemonPlatform({ path: configPath, exists: true, platform: 'taiga', error: null })
    expect(taiga.ok).toBe(false)
    expect((taiga.hint ?? '').includes('localfile')).toBe(true)
    expect(checkDaemonPlatform({ path: configPath, exists: false, platform: null, error: null }).ok).toBe(false)
  })

  it('4) chatd 权限：0700/0600/0600 绿；缺件红、权限漂移红', () => {
    const varDir = path.join(companyDir, 'var', 'workbench')
    const item = (kind: 'socket' | 'db' | 'token', exists = true, mode: number | null = kind === 'socket' ? 0o700 : 0o600) => ({
      kind,
      path: path.join(varDir, kind === 'socket' ? 'chat.sock' : kind === 'db' ? 'chat.db' : 'chatd.token'),
      exists,
      mode: exists ? mode : null,
    })
    expect(checkChatdPerms([item('socket'), item('db'), item('token')]).ok).toBe(true)
    const missing = checkChatdPerms([item('socket', false), item('db'), item('token')])
    expect(missing.ok).toBe(false)
    expect(missing.detail.includes('socket 缺失')).toBe(true)
    const drift = checkChatdPerms([item('socket'), item('db', true, 0o644), item('token')])
    expect(drift.ok).toBe(false)
    expect(drift.detail.includes('644≠600')).toBe(true)
  })

  it('5) 备份目录：存在可写绿；不存在但父可写也绿（将建）', () => {
    expect(checkBackupDir(path.join(root, 'backups'), { exists: true, writable: true, parentWritable: true }).ok).toBe(true)
    expect(checkBackupDir(path.join(root, 'backups'), { exists: false, writable: false, parentWritable: true }).ok).toBe(true)
    expect(checkBackupDir(path.join(root, 'backups'), { exists: false, writable: false, parentWritable: false }).ok).toBe(false)
  })

  it('6) 磁盘余量：≥2GiB 绿；低于/无法检测红', () => {
    expect(checkDiskFree(DISK_MIN_FREE_BYTES, DISK_MIN_FREE_BYTES).ok).toBe(true)
    expect(checkDiskFree(DISK_MIN_FREE_BYTES - 1, DISK_MIN_FREE_BYTES).ok).toBe(false)
    expect(checkDiskFree(null, DISK_MIN_FREE_BYTES).ok).toBe(false)
  })

  it('doctorVerdict：任一红即 fail', () => {
    const green = [checkNodeVersion('24.0.0'), checkDiskFree(DISK_MIN_FREE_BYTES, DISK_MIN_FREE_BYTES)]
    expect(doctorVerdict(green)).toEqual({ pass: true, failed: 0 })
    expect(doctorVerdict([...green, checkDiskFree(1, DISK_MIN_FREE_BYTES)])).toEqual({ pass: false, failed: 1 })
  })
})
