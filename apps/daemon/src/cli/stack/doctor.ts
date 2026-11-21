// doctor —— `studio-next stack doctor` 六项体检＋第 7 项可选提示判定纯函数（M5-1 第一刀，2026-11-21；
// M5-4a 增 Docker 退役提示项，2026-11-24）。
//
// 依据：docs/plan/08-M5打包分发-2026-11-20.md §三 里程碑5-1（体检刀）＋§四 验收 #2
// （chat.sock 0700 / chatd.token·chat.db 0600）＋§一 1.B#8（docker 栈退役面）——判定与事实收集分离：
// 本件全部纯函数，事实（存在性/权限/statfs/uid）由 stack.ts 收集注入，测试零真 IO 依赖。
import { accessSync, constants, existsSync } from 'node:fs'
import path from 'node:path'
import { EXPECTED_MODES } from './plists.ts'

/** 磁盘余量下限（2GiB——plan/08 §2.3 备份/DB 面的保守底线） */
export const DISK_MIN_FREE_BYTES = 2 * 1024 ** 3

/* ------------------------------------------------------------------ */
/* doctor：六项体检（判定纯函数 + 事实收集）                             */
/* ------------------------------------------------------------------ */

export interface CheckResult {
  readonly id: string
  readonly name: string
  readonly ok: boolean
  readonly detail: string
  readonly hint: string | undefined
}

/** 1) node ≥24（engines 基线——AGENTS §三） */
export function checkNodeVersion(version: string): CheckResult {
  const major = Number.parseInt(version.split('.')[0] ?? '0', 10)
  const ok = Number.isInteger(major) && major >= 24
  return { id: 'node', name: 'Node ≥24', ok, detail: `v${version}`, hint: ok ? undefined : '升级 Node（engines >=24；生产实测 25.6.1）' }
}

/** 2) companyDir 存在且是目录 */
export function checkCompanyDir(dir: string, stat: { exists: boolean; isDir: boolean }): CheckResult {
  const ok = stat.exists && stat.isDir
  return { id: 'company-dir', name: '公司目录', ok, detail: dir, hint: ok ? undefined : '路径不存在/非目录（studio-next init / company create 先建）' }
}

/** 3) daemon.yaml 可读且 platform=localfile（M5 目标态——plan/08 §1.A#3） */
export function checkDaemonPlatform(found: { path: string; exists: boolean; platform: string | null; error: string | null }): CheckResult {
  if (!found.exists) return { id: 'daemon-yaml', name: 'daemon.yaml', ok: false, detail: found.path, hint: `文件不存在（缺省查 <company-dir>/daemon.yaml＝${found.path}；company create 顺产位 <work-root>/var/daemon.yaml 须 --config 显式指定）` }
  if (found.error !== null) return { id: 'daemon-yaml', name: 'daemon.yaml', ok: false, detail: found.path, hint: `读取失败：${found.error}` }
  const ok = found.platform === 'localfile'
  return {
    id: 'daemon-yaml',
    name: 'daemon.yaml',
    ok,
    detail: `${found.path} platform=${found.platform ?? '(未声明)'}`,
    hint: ok ? undefined : 'M5 目标态 platform: localfile（taiga/matrix 为回滚兼容面——改配置或 --config 指对文件）',
  }
}

/** 4) chatd 三件权限（socket 0700 / db·token 0600——plan/08 §四 验收 #2；缺件=红不猜） */
export function checkChatdPerms(items: readonly { kind: 'socket' | 'db' | 'token'; path: string; exists: boolean; mode: number | null }[]): CheckResult {
  const problems: string[] = []
  for (const item of items) {
    const expected = item.kind === 'socket' ? EXPECTED_MODES.socket : item.kind === 'db' ? EXPECTED_MODES.db : EXPECTED_MODES.token
    const label = item.kind
    if (!item.exists) {
      problems.push(`${label} 缺失（${path.basename(item.path)}）`)
      continue
    }
    const actual = item.mode ?? -1
    const oct = (m: number): string => m.toString(8).padStart(3, '0')
    if (actual !== expected) problems.push(`${label} 权限 ${oct(actual)}≠${oct(expected)}（${path.basename(item.path)}）`)
  }
  return {
    id: 'chatd-perms',
    name: 'chatd 权限',
    ok: problems.length === 0,
    detail: problems.length === 0 ? 'socket 0700 / db 0600 / token 0600' : problems.join('；'),
    hint: problems.length === 0 ? undefined : '缺失=chatd 未装/未启动（stack up --apply 后复检）；权限漂移=chmod 0600/0700 修复',
  }
}

/** 5) 备份目录可写（platform-backup.sh 落点——存在即可写；不存在=最近存在祖先可写即可建） */
export function checkBackupDir(dir: string, info: { exists: boolean; writable: boolean; parentWritable: boolean }): CheckResult {
  const ok = info.exists ? info.writable : info.parentWritable
  return {
    id: 'backup-dir',
    name: '备份目录',
    ok,
    detail: info.exists ? `${dir}（可写）` : `${dir}（不存在，将建于${info.parentWritable ? '可写' : '不可写'}父目录）`,
    hint: ok ? undefined : '目录/父目录不可写（--backup-dir 显式指定，或挂载备份盘——docs/quality/backup-restore.md）',
  }
}

/** 6) 磁盘余量（companyDir 所在卷；null=无法检测=红） */
export function checkDiskFree(freeBytes: number | null, minBytes: number): CheckResult {
  const gib = (n: number): string => `${(n / 1024 ** 3).toFixed(1)}GiB`
  if (freeBytes === null) return { id: 'disk-free', name: '磁盘余量', ok: false, detail: '无法检测（公司目录不存在？）', hint: '先修第 2 项' }
  return { id: 'disk-free', name: '磁盘余量', ok: freeBytes >= minBytes, detail: `free=${gib(freeBytes)}（下限 ${gib(minBytes)}）`, hint: freeBytes >= minBytes ? undefined : '清理或换盘（SQLite/备份增长面）' }
}

/** 7) Docker 退役提示（M5-4a，plan/08 §一 1.B#8）：恒绿——提示面不是体检项；只提示、不自动卸载 */
export const DOCKER_RETIRED_ENV = 'STUDIO_NEXT_DOCKER_RETIRED'

export function checkDockerRetired(facts: { dockerCliExists: boolean; retiredDeclared: boolean; source: string | null }): CheckResult {
  const id = 'docker-retired'
  const name = 'Docker 退役'
  if (!facts.dockerCliExists) return { id, name, ok: true, detail: 'docker CLI 不在（干净机器形态）', hint: undefined }
  if (!facts.retiredDeclared) return { id, name, ok: true, detail: 'Docker CLI 在位；未声明退役', hint: undefined }
  return {
    id,
    name,
    ok: true,
    detail: `Docker CLI 在位＋已声明退役（${facts.source ?? '来源未记录'}）`,
    hint: 'Docker 已退役，可卸载（watchdog 已自动跳过 docker 栈探测——plan/08 §1.B#8；卸载前按 docs/quality/backup-restore.md 保卷数据备份；本提示不代卸载）',
  }
}

export function doctorVerdict(checks: readonly CheckResult[]): { pass: boolean; failed: number } {
  const failed = checks.filter((c) => !c.ok).length
  return { pass: failed === 0, failed }
}

/** 备份目录可写事实（walk-up：最近存在祖先的 W_OK——doctor 只读不建目录） */
export function probeWritableDir(dir: string): { exists: boolean; writable: boolean; parentWritable: boolean } {
  const target = path.resolve(dir)
  if (existsSync(target)) {
    try {
      accessSync(target, constants.W_OK)
      return { exists: true, writable: true, parentWritable: true }
    } catch {
      return { exists: true, writable: false, parentWritable: false }
    }
  }
  let cur = path.dirname(target)
  for (let hops = 0; hops < 128; hops += 1) {
    if (existsSync(cur)) {
      try {
        accessSync(cur, constants.W_OK)
        return { exists: false, writable: false, parentWritable: true }
      } catch {
        return { exists: false, writable: false, parentWritable: false }
      }
    }
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return { exists: false, writable: false, parentWritable: false }
}
