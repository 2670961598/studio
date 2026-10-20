#!/usr/bin/env node
/**
 * vendor-pull —— vendor 产物取件 + 校验脚本（零依赖：node:fetch + node:crypto）
 *
 * 依据：docs/37-§5.1 路线 I（vendor 进仓、零构建直引）、DEV-1 方案 §3.2。
 *
 * 只在**升级时手动跑**（改 vendor.lock.json 后）；面板运行时零网络。
 * 行为：读 vendor.lock.json → 按精确版本 URL 下载 → 校验字节数与 SHA-256 →
 *       不一致即非零退出且不覆盖旧文件；一致才写入 vendor/。
 * 退出码：0 全部就绪；1 lock 缺失/不可解析/下载失败/校验不过；2 用法错误。
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const vendorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../vendor')

let lock
try {
  lock = JSON.parse(await readFile(path.join(vendorRoot, 'vendor.lock.json'), 'utf8'))
} catch (err) {
  console.error(`vendor-pull：无法读取 vendor.lock.json（${err instanceof Error ? err.message : String(err)}）`)
  process.exit(1)
}

let failed = false
for (const [name, entry] of Object.entries(lock)) {
  const dest = path.join(vendorRoot, entry.file)
  let bytes
  try {
    const res = await fetch(entry.source, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
    bytes = Buffer.from(await res.arrayBuffer())
  } catch (err) {
    console.error(`vendor-pull：${name} 下载失败 ${entry.source}（${err instanceof Error ? err.message : String(err)}）——旧文件未动`)
    failed = true
    continue
  }
  if (bytes.length !== entry.bytes) {
    console.error(`vendor-pull：${name} 字节数不符（期望 ${String(entry.bytes)}，实得 ${String(bytes.length)}）——不写入`)
    failed = true
    continue
  }
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (sha !== entry.sha256) {
    console.error(`vendor-pull：${name} SHA-256 不符（期望 ${entry.sha256}，实得 ${sha}）——不写入`)
    failed = true
    continue
  }
  await writeFile(dest, bytes)
  console.log(`vendor-pull：${name}@${entry.version} → ${entry.file}（${String(bytes.length)} B，sha256 ${sha.slice(0, 12)}…）`)
}

process.exit(failed ? 1 : 0)
