// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L1251-L1381 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。
import path from 'node:path'
import { loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import { serveExternal } from '@studio-next/panel/external'
import type { ExternalCompanySource } from '@studio-next/panel/external'
import type { CompanySnapshot } from '@studio-next/contract'
import { CONTROL_TICKET, createGateway } from '@studio-next/gateway'
import type { SignatureContext } from '@studio-next/gateway'
import { DEV_GATEWAY_SECRET } from '../serve.ts'
import { createFakePlatform } from '../engine/fakes.ts'
import { createGatedPlatform } from '../engine/gated-platform.ts'
import { ENGINE_CONFIG_DEFAULTS } from '../engine/engine.ts'
import { USAGE } from './usage.ts'
import { errText, parseArgv } from './argv.ts'

export async function cmdExternal(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv, new Set(['company', 'db', 'port', 'token', 'requests-per-minute']), new Set(['company']), new Set(['lan']))
  if ('error' in parsed) {
    console.error(`external：${parsed.error}`)
    console.error(USAGE)
    return 1
  }
  if (parsed.positionals.length > 0) {
    console.error(`external：多余的位置参数：${parsed.positionals.join(' ')}`)
    console.error(USAGE)
    return 1
  }
  const companyDirs = parsed.multi.company ?? []
  if (companyDirs.length === 0) {
    console.error('external：至少给一个 --company <公司目录>（可重复给多家）')
    console.error(USAGE)
    return 1
  }
  let port = 8788
  if (parsed.flags.port !== undefined) {
    port = Number.parseInt(parsed.flags.port, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`external：--port 取值非法：${parsed.flags.port}（须为 1-65535 整数）`)
      return 1
    }
  }
  let requestsPerMinute: number | undefined
  if (parsed.flags['requests-per-minute'] !== undefined) {
    requestsPerMinute = Number.parseInt(parsed.flags['requests-per-minute'], 10)
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1) {
      console.error(`external：--requests-per-minute 取值非法：${parsed.flags['requests-per-minute']}（须为正整数）`)
      return 1
    }
  }

  const companies: ExternalCompanySource[] = []
  let firstSnapshot: CompanySnapshot | undefined
  for (const dir of companyDirs) {
    const resolved = path.resolve(dir)
    let files: Record<string, string>
    try {
      files = await readDirectoryFiles(resolved)
    } catch (err) {
      console.error(`external：读取公司目录失败 ${resolved}：${errText(err)}`)
      return 1
    }
    const mounted = loadCompanyDirectory(files)
    if (!mounted.ok) {
      console.error(`external：公司目录校验不通过（拒绝挂载，docs/04-§九）：${resolved}`)
      for (const issue of mounted.issues) console.error(`  ${issue.file}:${issue.line} [${issue.rule}] ${issue.fix}`)
      return 1
    }
    const snapshot = mounted.snapshot
    if (firstSnapshot === undefined) firstSnapshot = snapshot
    companies.push({
      slug: snapshot.slug,
      snapshotProvider: () => snapshot,
      listReports: () =>
        Object.entries(files)
          .filter(([p]) => p.startsWith('reports/'))
          .map(([file, content]) => ({ file: file.slice('reports/'.length), bytes: content.length }))
          .filter((r) => !r.file.startsWith('.') && r.file !== ''), // 点文件（.gitkeep 占位）与目录本身不出清单
    })
  }

  // 触发面平台装配（拟稿）：fake 平台 + 真网关闸（issues.create 过 comment 动作词收口）。
  // 身份取首家快照（控制面无人员档案——与 serve daemonIdentity 同拟稿）；开发密钥+警告。
  const snapshotForIdentity = firstSnapshot as CompanySnapshot
  const ctx: SignatureContext = {
    company: snapshotForIdentity.name,
    dept: snapshotForIdentity.departments[0]?.path ?? 'departments/未挂部门',
    role: 'daemon',
    level: Math.max(1, snapshotForIdentity.level),
  }
  const author = ENGINE_CONFIG_DEFAULTS.actor
  const gateway = createGateway({
    secret: new TextEncoder().encode(DEV_GATEWAY_SECRET),
    clock: () => Date.now(),
    ticket: CONTROL_TICKET,
    ctx,
    author,
  })
  const platform = createGatedPlatform(createFakePlatform(), gateway, { ctx, author })
  console.warn('[external] 警告：触发面平台为 fake demo 骨架，网关密钥用开发缺省值（生产装配必配强密钥——17-§7；真平台接线归 daemon 后续刀）')

  const token = parsed.flags.token
  if (token === undefined && parsed.flags.db !== undefined) {
    console.warn('[external] 警告：给了 --db 但未给 --token——触发面全 401（fail-closed），只读信息面可用')
  }

  let handle
  try {
    handle = await serveExternal(port, companies, {
      ...(parsed.flags.db !== undefined ? { ledgerPath: path.resolve(parsed.flags.db) } : {}),
      ...(token !== undefined ? { token } : {}),
      platform,
      ...(requestsPerMinute !== undefined ? { requestsPerMinute } : {}),
      ...(parsed.booleans.has('lan') ? { hostname: '0.0.0.0' } : {}),
    })
  } catch (err) {
    // 重复 slug / 库不存在 / 端口占用等：CONFIG_INVALID 形状，如实分类上报
    console.error(`external 启动失败：${errText(err)}`)
    return 1
  }
  console.log(
    `[external] :8788 对外 API 已监听 → http://${handle.hostname}:${String(handle.port)}/v1/agent-card` +
      `${parsed.booleans.has('lan') ? '' : '（默认只绑本机——对局域网开放须 --lan，D4 拟稿反转）'}`,
  )
  console.log(
    `[external] 已挂载：${companies.map((c) => c.slug).join('、')}；` +
      (parsed.flags.db !== undefined ? `台账：${path.resolve(parsed.flags.db)}（触发面 kv 幂等写；信息面零写）` : '无台账（issues/finance 如实降级；触发面 501）') +
      (token !== undefined ? '' : '；触发面未配令牌（POST /v1/requests 全 401——fail-closed）'),
  )
  console.log('[external] 端面：/v1/agent-card｜/v1/company｜/v1/org｜/v1/people｜/v1/projects｜/v1/issues｜/v1/finance｜/v1/reports｜POST /v1/requests（token）｜/v1/events（501 占位）')
  await new Promise<void>((resolve) => {
    const stop = (): void => resolve()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  await handle.close()
  console.log('[external] 已优雅关闭')
  return 0
}

/**
 * reload 子命令：L1 配置热重载手动触发薄壳（执行体全在 daemon 侧 src/control/hot-reload.ts——
 * 本命令只写控制面请求 + 轮询回执）。工位根发现序：--root > --config（缺省 ./daemon.yaml，
 * 读其 rootDir）> 缺省 ./var。退出码：0=重载成功或幂等 unchanged；1=回执失败
 * （company-mismatch/no-company-dir/config-invalid/apply-failed）或超时（daemon 不在跑/
 * 拍太慢——--timeout 可调，缺省 15000ms）。
 */
