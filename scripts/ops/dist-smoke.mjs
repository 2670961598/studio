#!/usr/bin/env node
/**
 * dist-smoke —— 分发 tarball 干净机器烟测（M5-3a 第一刀，2026-11-21；docs/plan/08-§三 里程碑5-3）
 *
 * 流程（解包到 os.tmpdir 临时目录，全链零仓内副作用）：
 *   0) 完整性：边车 <tgz>.sha256（在场即核对）＋包内 dist-manifest.json 结构校验＋treeDigest 复算；
 *   a) `node <tree>/apps/daemon/src/cli/main.ts --help` exit 0；
 *   b) 用该树生成一家公司（init → company create，localfile 默认，daemon.yaml 顺产），
 *      再 `stack doctor --company-dir <公司目录> --config <work>/var/daemon.yaml --json`：
 *      断言 node/company-dir/daemon-yaml/backup-dir/disk-free 五项 PASS；chatd 三件在起服前
 *      可缺（doctor 唯一允许的红项，exit 2 容忍）；
 *   c) 清理临时目录（--keep 保留现场）。
 *
 * 输出：逐步 PASS/FAIL ＋总结；exit 0=全过，1=任一失败。
 *
 * 用法：node scripts/ops/dist-smoke.mjs <tarball.tgz> [--keep] [--node <路径>] [--json]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeTreeDigest, MANIFEST_NAME, sha256File, validateManifest } from './pack-dist.mjs'

export const REQUIRED_PASS_IDS = ['node', 'company-dir', 'daemon-yaml', 'backup-dir', 'disk-free']
/** doctor 六项中起服前允许红的项（chatd 三件由 stack up --apply 首产） */
export const ALLOWED_FAIL_IDS = ['chatd-perms']

/* ------------------------------------------------------------------ */
/* 参数 / 路径校验（纯函数，测试面）                                    */
/* ------------------------------------------------------------------ */

/** 解析 argv：位置参数=tarball；--keep｜--node <路径>｜--json｜--help */
export function parseArgs(argv) {
  const flags = { tarball: '', keep: false, node: process.execPath, json: false, help: false }
  const positionals = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') flags.help = true
    else if (arg === '--keep') flags.keep = true
    else if (arg === '--json') flags.json = true
    else if (arg === '--node') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error('参数 --node 缺值')
      flags.node = value
      i += 1
    } else if (arg.startsWith('--node=')) flags.node = arg.slice('--node='.length)
    else if (arg.startsWith('--')) throw new Error(`未知参数：${arg}`)
    else positionals.push(arg)
  }
  if (positionals.length > 1) throw new Error(`多余的位置参数：${positionals.slice(1).join(' ')}`)
  flags.tarball = positionals[0] ?? ''
  return flags
}

/** tarball 路径校验（存在＋常规文件＋.tgz/.tar.gz 后缀；返回问题清单，空=过） */
export function validateTarballPath(file) {
  const issues = []
  if (file === '') issues.push('缺少 <tarball> 位置参数')
  else {
    if (!/\.(tgz|tar\.gz)$/.test(file)) issues.push('tarball 须为 .tgz/.tar.gz')
    if (!existsSync(file)) issues.push(`文件不存在：${file}`)
    else if (!statSync(file).isFile()) issues.push(`非常规文件：${file}`)
  }
  return issues
}

/** 公司布局推导（init/company create 落位约定：<work>/<slug> 公司 git 目录；daemon.yaml=<work>/var/） */
export function companyLayout(workRoot, slug) {
  const companyDir = path.join(workRoot, slug)
  return { workRoot, companyDir, configPath: path.join(workRoot, 'var', 'daemon.yaml') }
}

/**
 * doctor --json 结果判定（纯函数）：
 * 五项必绿（node/company-dir/daemon-yaml/backup-dir/disk-free），chatd-perms 可红，
 * 其余未知红项=失败；缺 id=失败（防体检面静默缩水）。
 */
export function evaluateDoctorResult(parsed) {
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.checks)) {
    return { ok: false, redIds: [], missingIds: REQUIRED_PASS_IDS, extraRedIds: [], reason: 'doctor 输出非 {checks:[…]} 形' }
  }
  const byId = new Map(parsed.checks.map((c) => [c.id, c]))
  const missingIds = REQUIRED_PASS_IDS.filter((id) => !byId.has(id))
  const redIds = parsed.checks.filter((c) => !c.ok).map((c) => c.id)
  const extraRedIds = redIds.filter((id) => !ALLOWED_FAIL_IDS.includes(id))
  const ok = missingIds.length === 0 && extraRedIds.length === 0
  return { ok, redIds, missingIds, extraRedIds, reason: ok ? undefined : '必绿项缺红或出现允许面之外的红项' }
}

export function usageText() {
  return [
    '用法：node scripts/ops/dist-smoke.mjs <tarball.tgz> [--keep] [--node <路径>] [--json] [--help]',
    '',
    '  解包 tarball 到临时目录 → CLI --help → init+company create 生成公司 → stack doctor',
    '  五项必绿（chatd 三件可缺）→ 清理。exit 0=PASS，1=FAIL。',
  ].join('\n')
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

function runStep(nodeBin, args, opts = {}) {
  const res = spawnSync(nodeBin, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 180_000, ...opts })
  return { status: res.status, stdout: String(res.stdout ?? ''), stderr: String(res.stderr ?? ''), error: res.error }
}

function mainSync(argv) {
  let flags
  try {
    flags = parseArgs(argv)
  } catch (err) {
    console.error(`参数错误：${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
  if (flags.help) {
    console.log(usageText())
    return 0
  }
  const pathIssues = validateTarballPath(flags.tarball)
  if (pathIssues.length > 0) {
    console.error(`tarball 路径校验失败：\n  ${pathIssues.join('\n  ')}`)
    return 1
  }
  const tarball = path.resolve(flags.tarball)
  const started = Date.now()
  const results = []
  const record = (id, ok, detail) => {
    results.push({ id, ok, detail })
    console.log(`  ${ok ? '● PASS' : '○ FAIL'}  ${id}${detail === '' ? '' : `——${detail}`}`)
    return ok
  }

  const tmp = mkdtempSync(path.join(tmpdir(), 'sn-dist-smoke-'))
  let exit = 0
  try {
    // 0) 完整性：边车 sha256 ＋包内 manifest 校验＋treeDigest 复算
    const sidecar = `${tarball}.sha256`
    if (existsSync(sidecar)) {
      const expected = readFileSync(sidecar, 'utf8').trim()
      const actual = sha256File(tarball)
      if (!record('0a sha256 边车', expected === actual, expected === actual ? actual : `期望 ${expected} 实得 ${actual}`)) exit = 1
    } else {
      console.log('  ● NOTE  0a sha256 边车不在场（跳过产物级校验——pack-dist 产物自带 <tgz>.sha256）')
    }

    const tree = path.join(tmp, 'tree')
    mkdirSync(tree, { recursive: true })
    const untar = spawnSync('tar', ['-xzf', tarball, '-C', tree], { encoding: 'utf8' })
    if (!record('0b 解包', untar.status === 0, `tar -xzf → ${tree}`)) return finish(1)

    const manifestPath = path.join(tree, MANIFEST_NAME)
    if (!existsSync(manifestPath)) {
      record('0c manifest 在场', false, `包内缺 ${MANIFEST_NAME}`)
      return finish(1)
    }
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (err) {
      record('0c manifest 解析', false, String(err instanceof Error ? err.message : err))
      return finish(1)
    }
    const issues = validateManifest(manifest)
    if (!record('0c manifest 结构', issues.length === 0, issues.length === 0 ? `commit=${manifest.git.short} 件数=${manifest.tree.fileCount}` : issues.join('；'))) exit = 1
    const digest = computeTreeDigest(tree)
    if (!record('0d treeDigest 复算', digest === manifest.tree?.treeDigest, digest === manifest.tree?.treeDigest ? digest : `期望 ${manifest.tree?.treeDigest} 实得 ${digest}`)) exit = 1

    const cli = path.join(tree, 'apps', 'daemon', 'src', 'cli', 'main.ts')
    if (!existsSync(cli)) {
      record('a CLI 入口在场', false, cli)
      return finish(1)
    }

    // a) --help exit 0
    const help = runStep(flags.node, [cli, '--help'])
    if (!record('a CLI --help', help.status === 0 && help.stdout.includes('studio-next'), `exit=${String(help.status)}${help.status !== 0 ? ` stderr=${help.stderr.slice(0, 200)}` : ''}`)) exit = 1

    // b) init 命令面验证（独立目录）→ company create 生成公司（fresh 通道：init 内含＋平台
    //    绑定＋daemon.yaml 顺产）→ stack doctor。create 对既有目录走 adopt（平台绑定沿用
    //    目录事实），fresh 目录才落 localfile 绑定——故 init 与 create 各用各的目录。
    const slug = 'smoke-corp'
    const { workRoot, companyDir, configPath } = companyLayout(path.join(tmp, 'co'), slug)
    const initDir = path.join(tmp, 'co', 'init-check')
    const init = runStep(flags.node, [cli, 'init', slug, '--dir', initDir])
    const initOk = init.status === 0 && existsSync(path.join(initDir, 'org-config.yaml'))
    if (!record('b1 init 公司目录', initOk, initOk ? initDir : `exit=${String(init.status)} ${init.stderr.slice(0, 300)}`)) exit = 1

    const create = runStep(flags.node, [cli, 'company', 'create', slug, '--dir', companyDir, '--work-root', workRoot, '--platform', 'localfile'])
    const createOk = create.status === 0 && existsSync(configPath)
    if (!record('b2 company create（daemon.yaml 顺产）', createOk, createOk ? configPath : `exit=${String(create.status)} ${create.stderr.slice(0, 300)}`)) exit = 1

    if (createOk) {
      const yamlText = readFileSync(configPath, 'utf8')
      if (!record('b3 daemon.yaml platform=localfile', /^platform:\s*localfile$/m.test(yamlText), configPath)) exit = 1
    } else {
      record('b3 daemon.yaml platform=localfile', false, 'b2 失败，跳过')
      exit = 1
    }

    const doctor = runStep(flags.node, [cli, 'stack', 'doctor', '--company-dir', companyDir, '--config', configPath, '--backup-dir', path.join(tmp, 'backups'), '--json'])
    let doctorNote = `exit=${String(doctor.status)}`
    let doctorOk = false
    if (doctor.status === 0 || doctor.status === 2) {
      try {
        const parsed = JSON.parse(doctor.stdout)
        const verdict = evaluateDoctorResult(parsed)
        doctorOk = verdict.ok
        doctorNote += verdict.ok ? `；必绿五项全过${verdict.redIds.length > 0 ? `；可缺红项=${verdict.redIds.join(',')}` : '；六项全绿'}` : `；${verdict.reason ?? ''} missing=[${verdict.missingIds.join(',')}] extraRed=[${verdict.extraRedIds.join(',')}]`
      } catch (err) {
        doctorNote += `；doctor 输出非 JSON：${String(err instanceof Error ? err.message : err).slice(0, 200)}`
      }
    } else {
      doctorNote += ` stderr=${doctor.stderr.slice(0, 300)}`
    }
    if (!record('b4 stack doctor 六项体检', doctorOk, doctorNote)) exit = 1
  } finally {
    // c) 清理临时目录（--keep 保留现场）
    if (flags.keep) {
      console.log(`  ● NOTE  c 保留现场：${tmp}（--keep）`)
    } else {
      rmSync(tmp, { recursive: true, force: true })
      console.log('  ● PASS  c 清理临时目录')
    }
  }
  return finish(exit)

  function finish(code) {
    const pass = results.filter((r) => r.ok).length
    const fail = results.filter((r) => !r.ok).length
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    if (flags.json) {
      console.log(JSON.stringify({ command: 'dist-smoke', tarball, pass, fail, results, elapsedSec: Number(elapsed), verdict: fail === 0 ? 'PASS' : 'FAIL' }, null, 2))
    } else {
      console.log(`结论 ${fail === 0 ? 'PASS' : 'FAIL'}（${String(pass)}/${String(results.length)} 步）——${tarball}｜耗时 ${elapsed}s`)
    }
    return fail === 0 && code === 0 ? 0 : 1
  }
}

const isMain = (() => {
  try {
    return process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (isMain) {
  process.exitCode = mainSync(process.argv.slice(2))
}
