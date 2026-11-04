#!/usr/bin/env node
/**
 * export-key-registry —— 公钥 registry 投影导出（studio-dev-722）
 *
 * 背景：721 的密钥托管在公司目录 `<companyDir>/docs/keys`（**在 company git 仓之外**，私钥永不入仓）；
 * CI（GitHub Actions）无法读该外部目录，故把**仅公钥+元数据**投影到仓库 `ops/keys/registry/` 供 required
 * check 使用（公钥非秘密；私钥/`.key` 一律不复制、不打印）。
 *
 * 用法：
 *   node scripts/ops/export-key-registry.mjs --keys-dir <companyDir>/docs/keys [--out ops/keys/registry] [--json]
 *
 * 纪律：
 *   - 只复制 `<工号>.pub` 与 `<工号>.json`（元数据不含私钥）；绝不复制/读取 `<工号>.key` 的内容；
 *   - 输出前用 ssh-keygen 实算指纹并与 json 比对（registery 自校验，模式同 verify-commit-keys）；
 *   - 输出目录默认 `<repo>/ops/keys/registry`；先清后写（避免旧工号残留），写 README 说明公钥投影来源。
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { readRegistry } from './worker-key-lib.mjs'

const USAGE = `用法：node scripts/ops/export-key-registry.mjs --keys-dir <companyDir>/docs/keys [--out ops/keys/registry] [--json]

只复制公钥（<工号>.pub）+ 元数据（<工号>.json）到仓库投影目录；私钥 .key 永不复制/打印。
用途：CI（722）在无外部 keys 目录时用仓库投影跑 verify-commit-keys。`

const EXIT = { ok: 0, usage: 1, fail: 2 }

function parseArgs(argv) {
  const opts = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') return { help: true, opts }
    if (token === '--json') {
      opts.json = true
      continue
    }
    if (!token.startsWith('--')) throw new Error(`未知参数：${token}`)
    const key = token.slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`参数缺值：${token}`)
    opts[key] = value
    i += 1
  }
  return { help: false, opts }
}

function main(argv) {
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`export-key-registry：${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`)
    return EXIT.usage
  }
  if (args.help === true) {
    process.stdout.write(USAGE)
    return EXIT.ok
  }
  const opts = args.opts
  if (typeof opts['keys-dir'] !== 'string' || opts['keys-dir'] === '') {
    process.stderr.write(`export-key-registry：缺 --keys-dir <companyDir>/docs/keys\n\n${USAGE}`)
    return EXIT.usage
  }
  const keysDir = realpathOrResolved(opts['keys-dir'])
  const outDir = realpathOrResolved(typeof opts.out === 'string' && opts.out !== '' ? opts.out : path.join(process.cwd(), 'ops', 'keys', 'registry'))
  try {
    // F1（verifier 修复）：--out 与 --keys-dir 重叠会先把私钥目录当投影清空 → 拒绝（realpath 规范化比较）
    if (outDir === keysDir) {
      throw new Error(`--out 不得等于 --keys-dir（${outDir}）——清理投影会删掉私钥目录内容；请用独立目录（如仓库 ops/keys/registry）`)
    }
    if (outDir.startsWith(`${keysDir}${path.sep}`)) {
      throw new Error(`--out 不得位于 --keys-dir 内（${outDir} ⊂ ${keysDir}）——清理投影会碰到私钥；请用独立目录`)
    }
    if (keysDir.startsWith(`${outDir}${path.sep}`)) {
      throw new Error(`--keys-dir 不得位于 --out 内（${keysDir} ⊂ ${outDir}）——清理投影有误删私钥风险；请用独立目录`)
    }
    const registry = readRegistry(keysDir) // 校验 json 与 pub 实算指纹一致（fail-closed）
    mkdirSync(outDir, { recursive: true })
    // F1-a（verifier 残余）：清理面=**只删「与本次导出 registry 工号匹配」的 <id>.pub/<id>.json**
    // 以及按内容标记识别的本工具 README；其它任何文件（含 package.json/data.json/notes.pub/
    // .key/隐藏文件/子目录）一律保留并 stderr 告警。**不按扩展名泛删、不递归**。
    const projectionNames = new Set()
    for (const entry of registry.values()) {
      projectionNames.add(`${entry.id}.pub`)
      projectionNames.add(`${entry.id}.json`)
    }
    for (const name of readdirSync(outDir)) {
      if (name === '.gitkeep') continue
      const full = path.join(outDir, name)
      const stat = lstatSync(full)
      if (!stat.isFile()) {
        process.stderr.write(`[export-key-registry] 警告：保留非投影子目录（不递归删除）：${name}\n`)
        continue
      }
      if (projectionNames.has(name)) {
        rmSync(full, { force: true })
        continue
      }
      if (name === 'README.md') {
        const text = readFileSync(full, 'utf8')
        if (text.includes('公钥 registry 投影')) {
          rmSync(full, { force: true })
          continue
        }
      }
      // 不匹配本次 registry 工号/非本工具 README → 保留（可能是业务文件/恶意误指目录；宁留勿删）
      process.stderr.write(`[export-key-registry] 警告：保留非投影文件（不删除）：${name}\n`)
    }
    const exported = []
    for (const entry of [...registry.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!/^[A-Za-z0-9._-]+$/.test(entry.id)) throw new Error(`registry 工号非法（含路径字符，拒绝投影）：${JSON.stringify(entry.id)}`)
      const pubSrc = path.join(keysDir, `${entry.id}.pub`)
      const jsonSrc = path.join(keysDir, `${entry.id}.json`)
      if (!existsSync(pubSrc)) throw new Error(`registry 有 ${entry.id} 但缺 ${entry.id}.pub`)
      copyFileSync(pubSrc, path.join(outDir, `${entry.id}.pub`))
      if (existsSync(jsonSrc)) copyFileSync(jsonSrc, path.join(outDir, `${entry.id}.json`))
      else writeFileSync(path.join(outDir, `${entry.id}.json`), `${JSON.stringify({ schema: 'studio-next/worker-key/v1', id: entry.id, name: entry.name, email: entry.email, fingerprint: entry.fingerprint }, null, 2)}\n`, 'utf8')
      exported.push({ id: entry.id, fingerprint: entry.fingerprint })
    }
    writeFileSync(
      path.join(outDir, 'README.md'),
      `# 公钥 registry 投影（studio-dev-722）\n\n本目录是 **公钥+元数据** 投影，由 \`scripts/ops/export-key-registry.mjs\`\n从公司目录 \`<companyDir>/docs/keys\` 导出，供 CI/GitHub Actions 的 \`verify-commit-keys\` 使用。\n\n- 只含 \`<工号>.pub\`（公钥）与 \`<工号>.json\`（id/name/email/指纹）；**私钥 \`.key\` 永不入仓**；\n- 重新导出：\`node scripts/ops/export-key-registry.mjs --keys-dir < companyDir>/docs/keys \`（改动需提交）；\n- 校验口径见 docs/90-§九（每人 key 与提交签名）与 docs/90-§十一（CI/required checks）。\n`,
      'utf8',
    )
    if (opts.json === true) process.stdout.write(`${JSON.stringify({ ok: true, keysDir, outDir, exported }, null, 2)}\n`)
    else {
      process.stdout.write(`[export-key-registry] 已导出 ${String(exported.length)} 个公钥 → ${outDir}\n`)
      for (const item of exported) process.stdout.write(`  ${item.id}  ${item.fingerprint}\n`)
    }
    return EXIT.ok
  } catch (err) {
    process.stderr.write(`export-key-registry：${err instanceof Error ? err.message : String(err)}\n`)
    return EXIT.fail
  }
}

function realpathOrResolved(target) {
  // 已存在→realpath；不存在→取父目录 realpath 再拼 basename（/tmp→/private/tmp 归一，F2-①）
  try {
    return realpathSync(target)
  } catch {
    const resolved = path.resolve(target)
    try {
      return path.join(realpathSync(path.dirname(resolved)), path.basename(resolved))
    } catch {
      return resolved
    }
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && realpathOrResolved(process.argv[1]) === realpathOrResolved(new URL(import.meta.url).pathname)
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)))
}
