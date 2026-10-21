// ✦ DEV-49 出厂态 New 根治（studio-dev-95）：A1-A3 的 onboard 运营入口（docs/52-§十）。
// daemon 不代写 provision（serve.ts wirePlatform 头注：provision 归迁移/onboard 脚本，
// daemon 只消费）——根治三步同属一次性运营动作，走 CLI 一命令（与 ledger drill 同款
// 一次性命令面）。A4（未知态哨）在引擎内，非本命令面。
/**
 * taiga-cure --config <daemon.yaml>
 *     Taiga 出厂态根治三步（docs/52-§十 A1→A2→A3；幂等重跑零写零删）：
 *       A1 项目默认态重指（default_*_status → 各实体声明集收件态）
 *       A2 存量出厂态单归化（transition 到收件态）
 *       A3 出厂状态退役（**先落全实体状态集快照进 <rootDir>/var/** 再 DELETE）
 *     前置：daemon.yaml platform: taiga + taigaFieldsFile（声明集事实源，缺=拒）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildContext, cureFactoryStatuses, type FactoryStatusSnapshot } from '@studio-next/taiga'
import { loadTaigaFieldMap, parseDaemonConfig, resolveTaigaAuth } from '../assembly/serve.ts'
import { errText, parseArgv } from './argv.ts'
import { CONCISE, SECTION } from './usage.ts'
import { helpOk, usageFail, wantsHelp } from './help.ts'

export async function cmdTaigaCure(argv: string[]): Promise<number> {
  if (wantsHelp(argv)) return helpOk(SECTION['taiga-cure']) // S1b 预检：先于解析与一切副作用
  const parsed = parseArgv(argv, new Set(['config']))
  if ('error' in parsed) {
    return usageFail('taiga-cure', parsed.error, CONCISE['taiga-cure'])
  }
  const configPath = parsed.flags.config
  if (configPath === undefined) {
    return usageFail('taiga-cure', '缺少 --config <daemon.yaml>', CONCISE['taiga-cure'])
  }
  try {
    const config = parseDaemonConfig(readFileSync(path.resolve(configPath), 'utf8'))
    if (config.platform !== 'taiga') {
      console.error(`taiga-cure：platform 须为 taiga（当前：${config.platform}——出厂态根治是 Taiga 模板复制病，其余平台无此面）`)
      return 1
    }
    if (config.taigaFieldsFile === undefined) {
      console.error('taiga-cure：daemon.yaml 缺 taigaFieldsFile（声明集事实源——无声明集无从定收件态/退役面，不猜）')
      return 1
    }
    const map = loadTaigaFieldMap(config.taigaFieldsFile)
    const ctx = buildContext({
      baseUrl: config.taigaUrl ?? '',
      project: config.taigaProject ?? '',
      auth: resolveTaigaAuth(config.taigaAuth ?? 'password'),
      ...(config.taigaEntity !== undefined ? { entity: config.taigaEntity } : {}),
      fields: map,
    })
    // 快照入档（roles 快照同款先例，docs/52-§十 A3）：任何 DELETE 之前落 <rootDir>/var/
    const varDir = path.resolve(config.rootDir, 'var')
    const persistSnapshot = (snapshot: FactoryStatusSnapshot): void => {
      mkdirSync(varDir, { recursive: true })
      const file = path.join(varDir, `taiga-status-snapshot-${new Date().toISOString().replaceAll(':', '')}.json`)
      writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`)
      console.log(`taiga-cure：A3 前置快照已入档 ${file}`)
    }
    const report = await cureFactoryStatuses(ctx, map, { persistSnapshot })
    for (const r of report.defaults) console.log(`taiga-cure：A1 重指 ${r.entity} ${r.field}：${r.from} → ${r.to}`)
    for (const r of report.defaultsKept) console.log(`taiga-cure：A1 保持 ${r.entity} ${r.field}（已指 ${r.current}）`)
    for (const r of report.defaultsSkipped) console.log(`taiga-cure：A1 跳过 ${r.entity} ${r.field}：${r.reason}`)
    for (const n of report.normalized) console.log(`taiga-cure：A2 归化 ${n.ticket}：${n.from} → ${n.to}`)
    if (report.normalizedKept > 0) console.log(`taiga-cure：A2 保持 ${report.normalizedKept} 单（已在声明集内）`)
    for (const f of report.normalizeFailed) console.error(`taiga-cure：A2 失败 ${f.ticket}（${f.from}）：${f.reason}`)
    for (const r of report.retired) console.log(`taiga-cure：A3 退役 ${r.entity} 状态「${r.status}」（引用单据自动迁 ${r.moveTo}）`)
    for (const s of report.retireSkipped) console.log(`taiga-cure：A3 跳过 ${s.entity}「${s.status}」：${s.reason}`)
    const writes = report.defaults.length + report.normalized.length + report.retired.length
    const problems = report.normalizeFailed.length
    console.log(
      `taiga-cure：根治完成（A1 改指 ${report.defaults.length}/保持 ${report.defaultsKept.length}/跳过 ${report.defaultsSkipped.length}；` +
        `A2 归化 ${report.normalized.length}/保持 ${report.normalizedKept}/失败 ${problems}；` +
        `A3 退役 ${report.retired.length}/跳过 ${report.retireSkipped.length}）——幂等重跑零写${writes === 0 ? '（本跑已零写=已根治态）' : ''}`,
    )
    return problems > 0 ? 2 : 0
  } catch (err) {
    // 配置/平台接线/根治执行失败：如实分类上报（不伪造证据面）
    console.error(`taiga-cure 失败：${errText(err)}`)
    return 1
  }
}
