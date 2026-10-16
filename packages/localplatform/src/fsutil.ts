/**
 * fs 小工具 —— node:fs 薄封装（零外部 npm 依赖纪律，docs/25-§一.5）。
 *
 * 并发安全 v0 按「单 daemon 写」假设（docs/04 唯一写入者）：无文件锁、append 直写、
 * 全量读。升级路径（出现第二写入者时）：锁文件 / 写队列 + 原子 rename。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { LocalPlatformError } from './errors.ts'

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

export function fileExists(path: string): boolean {
  return existsSync(path)
}

export function readTextIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/** 追加一行（自动补换行）；父目录不存在则创建 */
export function appendLine(path: string, line: string): void {
  ensureDir(dirname(path))
  appendFileSync(path, `${line}\n`, 'utf8')
}

/** 追加一条 jsonl 记录（紧凑 JSON，单行） */
export function appendJsonl(path: string, value: unknown): void {
  appendLine(path, JSON.stringify(value))
}

/** 读整份 jsonl；文件不存在返回 []；存在非法行则抛 corrupt（配置损坏如实上报，不静默跳过） */
export function readJsonl(path: string): unknown[] {
  const text = readTextIfExists(path)
  if (text === null) return []
  const out: unknown[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    try {
      out.push(JSON.parse(line) as unknown)
    } catch (err) {
      throw new LocalPlatformError('CONFIG_INVALID', 'corrupt-jsonl', `${path}: 存在非法 JSON 行：${String(err)}`)
    }
  }
  return out
}

/** 读 JSON 文件；不存在返回 fallback；损坏抛 corrupt */
export function readJson<T>(path: string, fallback: T): T {
  const text = readTextIfExists(path)
  if (text === null) return fallback
  try {
    return JSON.parse(text) as T
  } catch (err) {
    throw new LocalPlatformError('CONFIG_INVALID', 'corrupt-json', `${path}: 不是合法 JSON：${String(err)}`)
  }
}

/** 写 JSON 文件（2 空格缩进，尾换行；meta 落盘用，人可读） */
export function writeJson(path: string, value: unknown): void {
  ensureDir(dirname(path))
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** 未知值收窄为普通对象（运行时数据校验用） */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
