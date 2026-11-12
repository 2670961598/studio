/**
 * prov-report —— provenance trace/impact 渲染与原子落盘（observe-only）
 *
 * JSON 形状：prov-trace/v1 / prov-impact/v1；MD 结论先行。输出默认
 * `<companyDir>/var/reports/provenance/`（不写公司 git 树）；原子写 tmp→rename，
 * 失败零输出/旧报告不破坏；同参数重跑同字节（无 wall-clock/随机字段）。
 */
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ProvImpact, ProvTrace } from './provenance-graph.ts'

export function renderTraceJson(trace: ProvTrace): string {
  return `${JSON.stringify(trace, null, 2)}\n`
}
export function renderTraceMarkdown(trace: ProvTrace): string {
  const lines: string[] = [
    `# Provenance trace · ${trace.ticket}`,
    '',
    `> **结论先行（observe-only）**：${trace.root === null ? '未在派生图中找到该票' : `root=${trace.root}`}；` +
      `nodes=${String(trace.nodes.length)} edges=${String(trace.edges.length)} gaps=${String(trace.gaps.length)}；` +
      `事件默认不作节点，只作边证据（sourceEventId/time/confidence）。`,
    '',
    '## 节点计数',
    '',
    ...Object.entries(trace.nodeCounts).filter(([, n]) => n > 0).map(([k, n]) => `- ${k}: ${String(n)}`),
    '',
    '## 边（confidence=direct|inferred|gap；top 20+计数）',
    '',
    ...(trace.edges.length > 0
      ? trace.edges.slice(0, 20).map((e) => `- ${e.from} -[${e.kind}/${e.confidence}]-> ${e.to}${e.sourceEventId === null ? '' : `（event:${e.sourceEventId.slice(0, 12)}…）`}`)
      : ['- （空）']),
    ...(trace.edges.length > 20 ? [`- …其余 ${String(trace.edges.length - 20)} 条（JSON 全量；truncated=${String(trace.truncated)}）`] : []),
    '',
    `缺口（top ${String(trace.limits.mdTop)}）：${trace.gaps.length > 0 ? trace.gaps.slice(0, trace.limits.mdTop).join('、') + (trace.gaps.length > trace.limits.mdTop ? `…(+${String(trace.gaps.length - trace.limits.mdTop)})` : '') : '无'}`,
    `规模上限：nodes≤${String(trace.limits.traceNodes)}/edges≤${String(trace.limits.traceEdges)}；truncated=${String(trace.truncated)}`,
    '',
    '> 口径/限制：docs/quality/provenance.md；台账事实源 docs/17-§3；note 仅白名单 token 脱敏后展示。',
    '',
  ]
  return lines.join('\n')
}

export function renderImpactJson(impact: ProvImpact): string {
  return `${JSON.stringify(impact, null, 2)}\n`
}
export function renderImpactMarkdown(impact: ProvImpact): string {
  const a = impact.affected
  const lines: string[] = [
    `# Provenance impact · from=${impact.from}`,
    '',
    `> **结论先行（observe-only，不动作）**：${impact.source === null ? '未知/不在派生图中（空形状）' : `source=${impact.source.id}`}；` +
      `受影响 tickets=${String(a.tickets.length)} persons=${String(a.persons.length)} artifacts=${String(a.artifacts.length)} ` +
      `sessions=${String(a.sessions.length)} commits=${String(a.commits.length)}；` +
      `confidence direct=${String(impact.confidence.direct)} inferred=${String(impact.confidence.inferred)} gap=${String(impact.confidence.gap)}；` +
      `window=${impact.window.since === null ? '-' : new Date(impact.window.since).toISOString()}..${impact.window.until === null ? '-' : new Date(impact.window.until).toISOString()}。`,
    '',
    '## 受影响面（≤2 跳）',
    '',
    `- tickets (${String(a.tickets.length)}/${String(impact.affectedTotals.tickets)}): ${a.tickets.slice(0, impact.limits.mdTop).join('、') || '-'}`,
    `- persons (${String(a.persons.length)}/${String(impact.affectedTotals.persons)}): ${a.persons.slice(0, impact.limits.mdTop).join('、') || '-'}`,
    `- depts (${String(a.depts.length)}/${String(impact.affectedTotals.depts)}): ${a.depts.slice(0, impact.limits.mdTop).join('、') || '-'}`,
    `- artifacts (${String(a.artifacts.length)}/${String(impact.affectedTotals.artifacts)}): ${a.artifacts.slice(0, impact.limits.mdTop).join('、') || '-'}`,
    `- sessions (${String(a.sessions.length)}/${String(impact.affectedTotals.sessions)}): ${a.sessions.slice(0, impact.limits.mdTop).join('、') || '-'}`,
    `- commits (${String(a.commits.length)}/${String(impact.affectedTotals.commits)}): ${a.commits.slice(0, impact.limits.mdTop).join('、') || '-'}`,
    `- alerts (${String(a.alerts.length)}/${String(impact.affectedTotals.alerts)}): ${a.alerts.slice(0, impact.limits.mdTop).join('、') || '-'}`,
    '',
    '## 缺口/置信/hub/truncation',
    '',
    `- gaps(top ${String(impact.limits.mdTop)}): ${impact.gaps.slice(0, impact.limits.mdTop).join('、') || '无'}`,
    `- hubs: ${impact.hubs.length > 0 ? impact.hubs.slice(0, 10).map((h) => `${h.kind}:${h.hub} shown=${String(h.shown)}/${String(h.total)} inferred=${String(h.inferred)}${h.truncated ? '(cap)' : ''}`).join('；') : '无'}`,
    `- truncated=${String(impact.truncated)}；limits nodes≤${String(impact.limits.impactNodes)}/edges≤${String(impact.limits.impactEdges)}/listTop=${String(impact.limits.listTop)}；samples: ${impact.samples.length > 0 ? impact.samples.slice(0, 5).join('；') : '无'}`,
    `- 本报告只给观察结论，不触发隔离/重派/改单；事件证据见 JSON edges.sourceEventId。`,
    '',
    '> 口径/限制：docs/quality/provenance.md；台账事实源 docs/17-§3。',
    '',
  ]
  return lines.join('\n')
}

function safeUnlink(file: string): void {
  try {
    unlinkSync(file)
  } catch {
    /* 不存在=已清理 */
  }
}

/** 原子成对写（同 qa-report/qa-eval 纪律）：失败零输出；旧报告先备份、失败还原 */
export function writeAtomicPair(jsonPath: string, mdPath: string, jsonText: string, mdText: string): void {
  const tmpJson = `${jsonPath}.tmp-${String(process.pid)}`
  const tmpMd = `${mdPath}.tmp-${String(process.pid)}`
  const backups = new Map<string, string>()
  const renamed: string[] = []
  try {
    writeFileSync(tmpJson, jsonText, 'utf8')
    writeFileSync(tmpMd, mdText, 'utf8')
    for (const file of [jsonPath, mdPath]) {
      if (existsSync(file) && !statSync(file).isFile()) throw new Error(`输出目标非普通文件：${file}（拒绝覆盖）`)
    }
    for (const file of [jsonPath, mdPath]) {
      if (!existsSync(file)) continue
      const backup = `${file}.bak-${String(process.pid)}`
      renameSync(file, backup)
      backups.set(file, backup)
    }
    try {
      renameSync(tmpJson, jsonPath)
      renamed.push(jsonPath)
      renameSync(tmpMd, mdPath)
      renamed.push(mdPath)
    } catch (err) {
      for (const file of renamed) safeUnlink(file)
      for (const [file, backup] of backups) if (existsSync(backup) && !existsSync(file)) renameSync(backup, file)
      throw err
    }
    for (const backup of backups.values()) safeUnlink(backup)
  } catch (err) {
    safeUnlink(tmpJson)
    safeUnlink(tmpMd)
    for (const [file, backup] of backups) {
      try {
        if (existsSync(backup) && !existsSync(file)) renameSync(backup, file)
      } catch {
        /* 还原失败不掩盖原错误 */
      }
    }
    throw err
  }
}

/** 写入 trace/impact 成对文件（outDir 缺省由命令面给） */
export function writeProvFiles(kind: 'trace' | 'impact', outDir: string, name: string, jsonText: string, mdText: string): { jsonPath: string; mdPath: string } {
  const safe = name.replace(/[^A-Za-z0-9_.@-]/g, '_').slice(0, 80) || 'unknown'
  mkdirSync(outDir, { recursive: true })
  const jsonPath = path.join(outDir, `prov-${kind}-${safe}.json`)
  const mdPath = path.join(outDir, `prov-${kind}-${safe}.md`)
  writeAtomicPair(jsonPath, mdPath, jsonText, mdText)
  return { jsonPath, mdPath }
}
