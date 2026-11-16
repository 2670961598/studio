/**
 * engine/routing/overlay —— per-source dsh overlay 生成（task-56）
 * 源 overlay 内容与 model-tier 的 tier overlay 同形（agent-default-model patch），
 * 文件名 dsh-tier-<tier>--<source id>.yml；launch 前由 dispatch 路由层写入并 set 到 dsh adapter。
 * 原子写（tmp→rename）；在途 worker 不换源（argv 在 spawn 时快照）。
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ModelSourceSpec, TierId } from '@studio-next/core'

/** per-source overlay 文本（确定性；id 进注释便于审计） */
export function renderSourceOverlay(tier: TierId, source: ModelSourceSpec): string {
  return [
    `# Studio Next daemon 生成（task-56 源路由；生成物勿手改）`,
    `# 模型档 source overlay——tier=${tier}; source=${source.id}；${source.provider}/${source.model}`,
    `- id: agent-default-model`,
    `  config:`,
    `    provider: ${source.provider}`,
    `    model: ${source.model}`,
    ``,
  ].join('\n')
}

/** 原子写源 overlay，返回绝对路径 */
export function provisionSourceOverlay(rootDir: string, tier: TierId, source: ModelSourceSpec): string {
  const dir = path.join(path.resolve(rootDir), 'tmp')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `dsh-tier-${tier}--${source.id.replace(/[^A-Za-z0-9._-]/g, '_')}.yml`)
  const tmp = `${file}.tmp-${String(process.pid)}`
  writeFileSync(tmp, renderSourceOverlay(tier, source), { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file)
  return file
}
