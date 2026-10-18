/**
 * Taiga 真机冒烟脚本（套外手动跑，不进 vitest、不进类型门禁 include——tsconfig 只含 src）。
 *
 * 用法（真机栈 = docs/32 试点，http://localhost:9000，保持运行中）：
 *   node packages/taiga/test/smoke/taiga-smoke.ts            # 只读面
 *   WRITE_SMOKE=1 node packages/taiga/test/smoke/taiga-smoke.ts  # 追加写面（建1单+流转+评论，落在 probe-co）
 *
 * 凭据纪律：admin token 从 /tmp/taiga-docker/.admin-token 读取（0600，只读用），
 * **永不入仓/入测试/打印**；本脚本只把它放进内存请求头。
 * 自定义属性值写端点（custom-attributes-values）真机未实测——写面里专门覆盖（docs/32 待核项）。
 */
import { readFileSync } from 'node:fs'
import { createTaigaPlatform, readTaigaRoles } from '../../src/index.ts'

const BASE_URL = process.env['TAIGA_URL'] ?? 'http://localhost:9000'
const TOKEN_PATH = process.env['TAIGA_TOKEN_PATH'] ?? '/tmp/taiga-docker/.admin-token'
const PROJECT = process.env['TAIGA_PROJECT'] ?? 'probe-co'
const DO_WRITE = process.env['WRITE_SMOKE'] === '1'

function line(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? '✅' : '❌'} ${label} —— ${detail}`)
}

async function main(): Promise<void> {
  const token = readFileSync(TOKEN_PATH, 'utf8').trim()
  if (token === '') throw new Error('token 文件为空')
  const platform = createTaigaPlatform({
    baseUrl: BASE_URL,
    project: PROJECT,
    auth: { type: 'token', token },
    pageSize: 20,
  })

  // —— 读面 ——
  const schema = await platform.fields.schema()
  const stateField = schema.find((f) => f.name === 'state')
  line('fields.schema', stateField?.type === 'enum', `字段 ${String(schema.length)} 个；state 枚举=${JSON.stringify(stateField?.values)}`)

  const list = await platform.issues.list({})
  line('issues.list', Array.isArray(list), `${String(list.length)} 单；首单=${JSON.stringify(list[0]?.id)} state=${String(list[0]?.state)} updated=${String(list[0]?.updated)}`)

  if (list.length > 0) {
    const first = list[0]
    if (first === undefined) throw new Error('unreachable')
    const got = await platform.issues.get(first.id)
    line('issues.get', got.id === first.id, `${got.id} title=${got.title} description=${got.description === undefined ? '(无)' : '有'}`)

    const comments = await platform.comments.list(first.id)
    line('comments.list', Array.isArray(comments), `${String(comments.length)} 条评论`)

    const history = await platform.issues.get(first.id) // 触发一次完整读
    void history
  }

  const page1 = await platform.activity.since(null)
  line('activity.since(null)', page1.items.length <= 20, `首页 ${String(page1.items.length)} 条（总单 ${String(list.length)}）；建单类缺席=正常（history 不录建单，webhook 主通道负责）`)
  if (page1.nextCursor !== null) {
    const page2 = await platform.activity.since(page1.nextCursor)
    line('activity.since(cursor)', Array.isArray(page2.items), `次页 ${String(page2.items.length)} 条 nextCursor=${page2.nextCursor === null ? 'null(尾页)' : '有'}`)
  }

  const kb = await platform.kb.get('home')
  line('kb.get(home)', kb.length > 0, `${String(kb.length)} 字符`)
  const hits = await platform.kb.search('探针')
  line('kb.search', Array.isArray(hits), `命中 ${String(hits.length)} 页`)

  const roles = await readTaigaRoles({ baseUrl: BASE_URL, project: PROJECT, auth: { type: 'token', token } })
  line('readTaigaRoles', roles.length > 0, `${String(roles.length)} 角色；首角色 ${roles[0]?.name} 权限 ${String(roles[0]?.permissions.length)} 枚`)

  // —— 写面（opt-in）——
  if (DO_WRITE) {
    const created = await platform.issues.create({ title: '适配器冒烟单（可删）', description: 'FlowPlatform-Taiga 首刀冒烟' })
    line('issues.create', created.id !== '', `建单 ${created.id} state=${created.state}`)
    const moved = await platform.issues.transition(created.id, 'Done')
    line('issues.transition', moved.state === 'Done', `${created.id} → ${moved.state}`)
    await platform.comments.add(created.id, { author: 'SMOKE', body: '冒烟评论', signature: '[smoke·平台部·工兵·L2]' })
    const after = await platform.comments.list(created.id)
    line('comments.add+list', after.length === 1, `评论 ${String(after.length)} 条 author=${String(after[0]?.author)}`)
    // custom-attributes-values 写端点真机核验（docs/32 未覆盖——首刀已知边界）。
    // probe-co 只建过「工号」属性（onboard ⑥ 探针），用带映射的第二实例走业务字段 dept→工号。
    if (schema.some((f) => f.name === '工号')) {
      const mapped = createTaigaPlatform({
        baseUrl: BASE_URL,
        project: PROJECT,
        auth: { type: 'token', token },
        fields: { fields: { dept: '工号' }, states: [], stateFlow: {} },
      })
      await mapped.issues.setField(created.id, 'dept', 'AGENT-SMOKE')
      const recheck = await mapped.issues.get(created.id)
      line('setField(custom-attr, dept→工号)', recheck.dept === 'AGENT-SMOKE', `端点通路 OK；读回 dept=${String(recheck.dept)}`)
    } else {
      line('setField(custom-attr)', false, 'probe-co 无「工号」自定义属性，跳过')
    }
    const tail = await platform.activity.since(null)
    line('activity 写后即见', tail.items.length > page1.items.length || tail.items.length === 20, `写后活动 ${String(tail.items.length)} 条`)
  } else {
    console.log('ℹ️  写面跳过（WRITE_SMOKE=1 开启：建单+流转+评论+自定义属性写）')
  }
  console.log('\n冒烟完毕。')
}

main().catch((err: unknown) => {
  console.error('❌ 冒烟失败：', err)
  process.exitCode = 1
})
