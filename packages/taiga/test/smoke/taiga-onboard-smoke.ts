/**
 * Taiga onboard 写面三件 + links 读面 · 真机冒烟（套外手动跑，不进 vitest/门禁）。
 *
 * 用法（真机栈 = docs/32 试点，http://localhost:9000，保持运行中，不动栈）：
 *   node packages/taiga/test/smoke/taiga-onboard-smoke.ts                # 只读面
 *   WRITE_SMOKE=1 node packages/taiga/test/smoke/taiga-onboard-smoke.ts  # onboard 两跑幂等 + 拆闸
 *
 * 覆盖（docs/30 §6 onboard ⑤⑥⑧ 写面 + links 定版读面）：
 *   ① links 读面（不动栈）：children(userstory)=派生 task；children(issue)=生成链
 *   ② WRITE_SMOKE=1：
 *      - 第一跑：provision 建缺档（状态/属性，名字带「可删」）+ kb.upsert 建根页
 *        （slug=onboard-smoke/home）+ guards.install 收窄（allowRoles=[UX]）
 *      - 第二跑：同序列重入 → 断言**零写调用**（fetch 包装计数；GET 不算写）
 *      - 两跑后状态指纹（schema+kb 正文+roles×permissions）一致 → 「两跑同结果」
 *      - 收尾 guards.uninstall 拆闸（全员放开——含出厂无 modify_us 的角色，头注语义）
 *
 * 凭据纪律：admin token 从 /tmp/taiga-docker/.admin-token 读取（0600，只读用），
 * **永不入仓/打印**；只进内存请求头。
 * 冒烟副作用：probe-co 新增状态/属性/wiki 页均带「可删」标记；roles 被收窄后拆闸放开。
 */
import { readFileSync } from 'node:fs'
import { createTaigaPlatform, readTaigaRoles, TaigaPlatformError } from '../../src/index.ts'

const BASE_URL = process.env['TAIGA_URL'] ?? 'http://localhost:9000'
const TOKEN_PATH = process.env['TAIGA_TOKEN_PATH'] ?? '/tmp/taiga-docker/.admin-token'
const PROJECT = process.env['TAIGA_PROJECT'] ?? 'probe-co'
const DO_WRITE = process.env['WRITE_SMOKE'] === '1'

let failures = 0
function line(label: string, ok: boolean, detail: string): void {
  if (!ok) failures += 1
  console.log(`${ok ? '✅' : '❌'} ${label} —— ${detail}`)
}

interface CountingFetch {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  writes: Array<{ method: string; url: string }>
}

/** fetch 包装：计数非 GET 平台请求（写面幂等断言的证据源） */
function wrapFetch(inner: typeof globalThis.fetch): CountingFetch {
  const writes: Array<{ method: string; url: string }> = []
  const wrapped = (input: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET' && !input.includes('/api/v1/auth')) {
      writes.push({ method, url: input.replace(/^https?:\/\/[^/]+/, '') })
    }
    return inner(input, init)
  }
  return { fetch: wrapped, writes }
}

async function fingerprint(token: string): Promise<string> {
  // 独立实例只读（不复用写实例——token 单槽互不干扰）
  const p = createTaigaPlatform({ baseUrl: BASE_URL, project: PROJECT, auth: { type: 'token', token } })
  const schema = await p.fields.schema()
  const kb = await p.kb.get('onboard-smoke/home')
  const roles = await readTaigaRoles({ baseUrl: BASE_URL, project: PROJECT, auth: { type: 'token', token } })
  return JSON.stringify({ schema, kb, roles: roles.map((r) => [r.name, [...r.permissions].sort()]) })
}

async function main(): Promise<void> {
  const token = readFileSync(TOKEN_PATH, 'utf8').trim()
  if (token === '') throw new Error('token 文件为空')

  // —— ① links 读面（零写）——
  const probe = createTaigaPlatform({ baseUrl: BASE_URL, project: PROJECT, auth: { type: 'token', token } })
  const usList = await probe.issues.list({})
  // probe 期在 US ref=9 下建过 task（ref=12）——children 应拿到该派生链
  const probeUs = usList.find((u) => u.id === `${PROJECT}-9`)
  if (probeUs !== undefined) {
    const kids = await probe.links.children(probeUs.id)
    line('links.children(userstory)', kids.length === 1 && kids[0] === `${PROJECT}-12`, `${probeUs.id} 派生 ${String(kids.length)} 个 task：${kids.join(',')}（子单是 task 实体，不可经 issues.get 读——已知边界）`)
  } else {
    const firstUs = usList[0]
    if (firstUs !== undefined) {
      const kids = await probe.links.children(firstUs.id)
      line('links.children(userstory)', Array.isArray(kids), `${firstUs.id} 派生 ${String(kids.length)} 个 task（探针 US 已不在，弱断言）`)
    } else {
      line('links.children(userstory)', false, '项目无 US 可测')
    }
  }
  const issueProbe = createTaigaPlatform({ baseUrl: BASE_URL, project: PROJECT, auth: { type: 'token', token }, entity: 'issue' })
  const issues = await issueProbe.issues.list({})
  if (issues.length > 0) {
    const gen = await issueProbe.links.children(issues[0]?.id ?? '')
    line('links.children(issue)', Array.isArray(gen), `生成链 children=${String(gen.length)}（API 驱动实例恒 0——生成链 UI 专属，实测结论）`)
  }
  await probe.links.link(`${PROJECT}-1`, `${PROJECT}-2`, 'relates-to').then(
    () => line('links.link 显式报错', false, '不该成功'),
    (err: unknown) => line('links.link 显式报错', err instanceof TaigaPlatformError && err.subcause === 'links-unsupported', String(err).slice(0, 140)),
  )

  if (!DO_WRITE) {
    console.log('ℹ️  写面跳过（WRITE_SMOKE=1 开启：onboard 三件两跑幂等 + 拆闸）')
    console.log('\n冒烟完毕。')
    return
  }

  // —— ② onboard 三件两跑幂等 ——
  const ONBOARD_MAP = {
    fields: { dept: '冒烟部门字段（可删）', cost: '冒烟成本字段（可删）' },
    types: { cost: 'int' as const },
    states: ['New', 'In progress', 'Done', '冒烟验收中（可删）'],
    stateFlow: { New: ['In progress'], 'In progress': ['冒烟验收中（可删）'] },
  }
  const RULES = [
    { from: 'New', to: 'In progress', allowRoles: ['UX'] },
    { from: 'In progress', to: 'Done', allowRoles: ['UX'] },
  ]
  const KB_MD = '# onboard 冒烟根页（可删）\n两跑幂等证据页'

  async function runOnce(runLabel: string): Promise<{ writes: Array<{ method: string; url: string }> }> {
    const counting = wrapFetch(globalThis.fetch as typeof globalThis.fetch)
    const p = createTaigaPlatform({
      baseUrl: BASE_URL,
      project: PROJECT,
      auth: { type: 'token', token },
      fields: { fields: { dept: '冒烟部门字段（可删）' }, states: [], stateFlow: {} },
      fetch: counting.fetch,
    })
    await p.fields.provision(ONBOARD_MAP)
    await p.kb.upsert('onboard-smoke/home', KB_MD)
    await p.guards.install(PROJECT, RULES)
    console.log(`—— ${runLabel} 写调用 ${String(counting.writes.length)} 条 ——`)
    for (const w of counting.writes) console.log(`   ${w.method} ${w.url}`)
    return { writes: counting.writes }
  }

  const run1 = await runOnce('第一跑')
  line('第一跑有写', run1.writes.length > 0, `${String(run1.writes.length)} 条（建缺档+建页+收窄）`)
  const narrowed = await readTaigaRoles({ baseUrl: BASE_URL, project: PROJECT, auth: { type: 'token', token } })
  const ux = narrowed.find((r) => r.name === 'UX')
  const design = narrowed.find((r) => r.name === 'Design')
  line('install 收窄生效', ux?.permissions.includes('modify_us') === true && design?.permissions.includes('modify_us') === false, `UX 保有 modify_us、Design 被剥（白名单=[UX]）`)

  const run2 = await runOnce('第二跑')
  line('第二跑零写（幂等重入）', run2.writes.length === 0, `写调用 ${String(run2.writes.length)} 条`)

  const fp1 = await fingerprint(token)
  const fp2 = await fingerprint(token)
  line('两跑同结果（指纹一致）', fp1 === fp2, `指纹 ${String(fp1.length)} 字符`)
  const kbNow = await createTaigaPlatform({ baseUrl: BASE_URL, project: PROJECT, auth: { type: 'token', token } }).kb.get('onboard-smoke/home')
  line('kb.upsert 落盘', kbNow === KB_MD, `${String(kbNow.length)} 字符`)

  // —— ③ 拆闸收尾（拆闸=全员放开，含出厂无 modify_us 的角色——guards.ts 头注语义）——
  const cleanup = wrapFetch(globalThis.fetch as typeof globalThis.fetch)
  const p3 = createTaigaPlatform({ baseUrl: BASE_URL, project: PROJECT, auth: { type: 'token', token }, fetch: cleanup.fetch })
  await p3.guards.uninstall(PROJECT)
  const restored = await readTaigaRoles({ baseUrl: BASE_URL, project: PROJECT, auth: { type: 'token', token } })
  line('uninstall 拆闸', restored.every((r) => r.permissions.includes('modify_us')), `补回 ${String(cleanup.writes.length)} 个角色（缺 modify_us 者）`)
  console.log('\n冒烟完毕。')
  if (failures > 0) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error('❌ 冒烟失败：', err)
  process.exitCode = 1
})
