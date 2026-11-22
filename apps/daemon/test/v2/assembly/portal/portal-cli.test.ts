/**
 * 公司门户 CLI 面回归（docs/plan/11-公司门户-2026-11-23.md §1.4 CLI／§四 验收「缺省关」）。
 *
 * 1. 缺省关：无 --portal 时监控面行为不变（--portal-only 旗标给出即用法错，不静默忽略）
 * 2. --portal 前置 fail-closed：缺公司目录/缺库/目录或库不存在/端口非法→exit 1（拒启不代建）
 * 3. --portal 全装：同端口五页＋API 可达、启动横幅如实、停机优雅（exit 0）
 * 4. 聊天接线：token 只驻内存（日志/页面永不出现 token 值）；socket 缺→告警不拒启
 *
 * 停机信号走 PanelRuntime.waitForStop 注入（vitest worker 自带 SIGTERM 处理，不可打真信号）。
 */
import { createServer } from 'node:net'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cmdPanel } from '../../../../src/cli/panel.ts'
import { SECTION } from '../../../../src/cli/usage.ts'
import { dropTree, makeTree, type PortalTree } from './fixtures.ts'

let out: string[]
let err: string[]
let spies: { mockRestore: () => void }[] = []

beforeEach(() => {
  out = []
  err = []
  spies = [
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out.push(args.map(String).join(' '))
    }) as unknown as { mockRestore: () => void },
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      err.push(args.map(String).join(' '))
    }) as unknown as { mockRestore: () => void },
  ]
  // 聊天 env 隔离：宿主机若配了 WORKBENCH_CHATD_* / PANEL_CHAT_ACTOR 不得渗入用例
  vi.stubEnv('WORKBENCH_CHATD_SOCKET', '')
  vi.stubEnv('WORKBENCH_CHATD_TOKEN', '')
  vi.stubEnv('PANEL_CHAT_ACTOR', '')
})

afterEach(() => {
  for (const s of spies) s.mockRestore()
  vi.unstubAllEnvs()
})

/** 借一个空闲端口（listen(0) 取号即还——微小竞态可接受） */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr === null || typeof addr === 'string') {
        srv.close()
        reject(new Error('no port'))
        return
      }
      srv.close(() => resolve(addr.port))
    })
  })

const joined = (): string => [...out, ...err].join('\n')

describe('缺省关（无 --portal＝监控面原行为）', () => {
  it('缺 --db 仍是原用法错（错误行→stderr、简段→stdout、exit 1）', async () => {
    const code = await cmdPanel([])
    expect(code).toBe(1)
    expect(err).toEqual(['panel：缺少 --db <库路径>'])
    expect(out).toEqual([expect.stringContaining('studio-next panel --db')])
  })

  it('--portal-only 旗标在监控面给出即用法错（不静默忽略）', async () => {
    for (const flag of ['--platform-root', '--portal-port', '--chatd-socket', '--chatd-token-file', '--chat-actor']) {
      out = []
      err = []
      const code = await cmdPanel(['--db', 'x.sqlite', flag, 'v'])
      expect(code, flag).toBe(1)
      expect(err[0], flag).toContain(`panel：--${flag.slice(2)} 仅在 --portal 公司门户态有效`)
      expect(out[0], flag).toContain('studio-next panel --db')
    }
  })

  it('库不存在→启动失败 exit 1（只读不代建库——原判例）', async () => {
    const missing = path.join(path.dirname(makeTree('sn-portal-cli-missing-').root), 'nope.sqlite')
    const code = await cmdPanel(['--db', missing, '--port', String(await freePort())])
    expect(code).toBe(1)
    expect(err[0]).toContain('panel 启动失败')
  })
})

describe('--portal 前置 fail-closed（拒启不代建）', () => {
  let tree: PortalTree
  beforeEach(() => {
    tree = makeTree('sn-portal-cli-')
  })
  afterEach(() => {
    dropTree(tree)
  })

  it('缺 --company-dir → 用法错 exit 1', async () => {
    const code = await cmdPanel(['--portal', '--db', tree.dbPath])
    expect(code).toBe(1)
    expect(err[0]).toContain('--portal 需要 --company-dir')
  })

  it('缺 --db → 用法错 exit 1', async () => {
    const code = await cmdPanel(['--portal', '--company-dir', tree.companyDir])
    expect(code).toBe(1)
    expect(err[0]).toContain('缺少 --db')
  })

  it('公司目录不存在 → 拒启 exit 1 且不代建目录', async () => {
    const ghost = path.join(tree.root, 'ghost-company')
    const code = await cmdPanel(['--portal', '--company-dir', ghost, '--db', tree.dbPath])
    expect(code).toBe(1)
    expect(err[0]).toContain('拒启；不代建公司目录')
    expect(out).toEqual([])
  })

  it('库不存在 → 拒启 exit 1 且不代建库', async () => {
    const ghost = path.join(tree.root, 'ghost.sqlite')
    const code = await cmdPanel(['--portal', '--company-dir', tree.companyDir, '--db', ghost])
    expect(code).toBe(1)
    expect(err[0]).toContain('拒启；门户只读不代建库')
  })

  it('--portal-port 非法（0/越界/非整数）→ exit 1，不占端口', async () => {
    for (const bad of ['0', '65536', 'abc']) {
      out = []
      err = []
      const code = await cmdPanel([
        '--portal',
        '--company-dir',
        tree.companyDir,
        '--db',
        tree.dbPath,
        '--portal-port',
        bad,
      ])
      expect(code, bad).toBe(1)
      expect(err[0], bad).toContain('--portal-port 取值非法')
      expect(out, bad).toEqual([])
    }
  })

  it('公司目录校验不过（坏 org-config）→ 启动失败 exit 1，错误清单如实', async () => {
    writeFileSync(path.join(tree.companyDir, 'org-config.yaml'), 'schema: org-config/v1\ncompany: {}\n')
    const code = await cmdPanel([
      '--portal',
      '--company-dir',
      tree.companyDir,
      '--db',
      tree.dbPath,
      '--portal-port',
      String(await freePort()),
    ])
    expect(code).toBe(1)
    expect(err[0]).toContain('portal 启动失败')
    expect(err[0]).toContain('公司目录校验不过')
  })
})

describe('--portal 全装（同端口五读面）', () => {
  let tree: PortalTree
  beforeEach(() => {
    tree = makeTree('sn-portal-cli-up-')
  })
  afterEach(() => {
    dropTree(tree)
  })

  it('启动横幅如实（平台在/聊天未配）、页面与 API 同端口可达、优雅停机 exit 0', async () => {
    const port = await freePort()
    let probed: { status: number; body: string }[] = []
    const code = await cmdPanel(
      ['--portal', '--company-dir', tree.companyDir, '--db', tree.dbPath, '--portal-port', String(port)],
      {
        // 服务已在听（横幅打完才调 waitForStop）：此刻探活，然后停机
        waitForStop: async () => {
          const base = `http://127.0.0.1:${String(port)}`
          for (const p of ['/', '/tickets', '/chat', '/org', '/reports', '/api/stats', '/api/tickets']) {
            const res = await fetch(base + p)
            probed.push({ status: res.status, body: await res.text() })
          }
        },
      },
    )
    expect(code).toBe(0)
    expect(out[0]).toBe(`[portal] 公司门户已监听 → http://127.0.0.1:${String(port)}/（只读，Ctrl-C 退出）`)
    expect(out.join('\n')).toContain('[portal] 单子平台：')
    expect(out.join('\n')).toContain('[portal] 聊天未配置')
    expect(out.join('\n')).toContain('[portal] 已优雅关闭')
    expect(err).toEqual([]) // 平台在、无 socket 告警：零 stderr
    expect(probed.map((p) => p.status)).toEqual([200, 200, 200, 200, 200, 200, 200])
    const stats = JSON.parse(probed[5]?.body ?? '{}') as { ok: boolean; stats: { tickets: { total: number } } }
    expect(stats.ok).toBe(true)
    expect(stats.stats.tickets.total).toBe(3)
    expect(probed[0]?.body).toContain('门户测试公司')
  })

  it('平台根缺（默认 <companyDir>/../platform 不存在）→ 横幅降级行、单子面空列表、仍可服务', async () => {
    const tree2 = makeTree('sn-portal-cli-noplat-', { platform: false })
    try {
      const port = await freePort()
      let body = ''
      const code = await cmdPanel(
        ['--portal', '--company-dir', tree2.companyDir, '--db', tree2.dbPath, '--portal-port', String(port)],
        {
          waitForStop: async () => {
            const res = await fetch(`http://127.0.0.1:${String(port)}/api/tickets`)
            body = await res.text()
          },
        },
      )
      expect(code).toBe(0)
      expect(out.join('\n')).toContain('[portal] 单子平台未接：')
      const api = JSON.parse(body) as { available: boolean; total: number }
      expect(api.available).toBe(false)
      expect(api.total).toBe(0)
    } finally {
      dropTree(tree2)
    }
  })

  it('--platform-root 显式指定优先于默认推导', async () => {
    const tree2 = makeTree('sn-portal-cli-platflag-', { platform: false })
    try {
      const port = await freePort()
      let body = ''
      const code = await cmdPanel(
        [
          '--portal',
          '--company-dir',
          tree2.companyDir,
          '--db',
          tree2.dbPath,
          '--platform-root',
          tree.platformRoot,
          '--portal-port',
          String(port),
        ],
        {
          waitForStop: async () => {
            const res = await fetch(`http://127.0.0.1:${String(port)}/api/tickets`)
            body = await res.text()
          },
        },
      )
      expect(code).toBe(0)
      expect(JSON.parse(body) as { total: number }).toMatchObject({ total: 3 })
    } finally {
      dropTree(tree2)
    }
  })
})

describe('聊天接线（token 只驻内存）', () => {
  let tree: PortalTree
  beforeEach(() => {
    tree = makeTree('sn-portal-cli-chat-')
  })
  afterEach(() => {
    dropTree(tree)
  })

  it('--chatd-socket 指向不存在 socket → stderr 告警不拒启；--chatd-token-file 读入内存且值不入日志/页面', async () => {
    const tokenFile = path.join(tree.root, 'chatd.token')
    writeFileSync(tokenFile, 'tok-secret-9f\n')
    const ghostSocket = path.join(tree.root, 'nope.sock')
    const port = await freePort()
    let html = ''
    let chatStatus = 0
    const code = await cmdPanel(
      [
        '--portal',
        '--company-dir',
        tree.companyDir,
        '--db',
        tree.dbPath,
        '--chatd-socket',
        ghostSocket,
        '--chatd-token-file',
        tokenFile,
        '--portal-port',
        String(port),
      ],
      {
        waitForStop: async () => {
          html = await (await fetch(`http://127.0.0.1:${String(port)}/chat`)).text()
          chatStatus = (await fetch(`http://127.0.0.1:${String(port)}/api/chat/rooms`)).status
        },
      },
    )
    expect(code).toBe(0)
    expect(err[0]).toContain(`[portal] chatd socket 不存在：${ghostSocket}`)
    expect(out.join('\n')).toContain('token 由 --chatd-token-file 读入内存')
    expect(joined()).not.toContain('tok-secret-9f')
    expect(html).not.toContain('tok-secret-9f')
    expect(html).toContain('chat-embed')
    // transport 已装但 socket 不在：chatd 面如实 503（不冒充空房间）
    expect(chatStatus).toBe(503)
  })

  it('token 文件不可读 → 不拒启、未配 token 口径', async () => {
    const port = await freePort()
    const code = await cmdPanel(
      [
        '--portal',
        '--company-dir',
        tree.companyDir,
        '--db',
        tree.dbPath,
        '--chatd-socket',
        path.join(tree.root, 'nope.sock'),
        '--chatd-token-file',
        path.join(tree.root, 'missing.token'),
        '--portal-port',
        String(port),
      ],
      { waitForStop: async () => undefined },
    )
    expect(code).toBe(0)
    expect(out.join('\n')).toContain('未配 token')
  })
})

describe('--chat-actor 缺省操作者（面板包缺省 panel 非 chatd 房间成员——门户换在册工号）', () => {
  let tree: PortalTree
  beforeEach(() => {
    tree = makeTree('sn-portal-cli-actor-')
  })
  afterEach(() => {
    dropTree(tree)
  })

  it('非法值（空白/内嵌空白/超 64 字符）→ 用法错 exit 1，不占端口', async () => {
    for (const bad of [' ', 'a b', 'x'.repeat(65)]) {
      out = []
      err = []
      const code = await cmdPanel([
        '--portal',
        '--company-dir',
        tree.companyDir,
        '--db',
        tree.dbPath,
        '--chat-actor',
        bad,
        '--portal-port',
        String(await freePort()),
      ])
      expect(code, JSON.stringify(bad)).toBe(1)
      expect(err[0], JSON.stringify(bad)).toContain('--chat-actor 取值非法')
      expect(out[0], JSON.stringify(bad)).toContain('studio-next panel --db')
    }
  })

  it('无 flag 无 env → 内置缺省 PRIME-0：横幅如实，/chat 页 CONFIG 同值', async () => {
    const port = await freePort()
    let html = ''
    // 给个不存在的 socket：transport 装上（页面才注入 CONFIG），chatd 面如实 503
    const code = await cmdPanel(
      ['--portal', '--company-dir', tree.companyDir, '--db', tree.dbPath, '--chatd-socket', path.join(tree.root, 'nope.sock'), '--portal-port', String(port)],
      {
        waitForStop: async () => {
          html = await (await fetch(`http://127.0.0.1:${String(port)}/chat`)).text()
        },
      },
    )
    expect(code).toBe(0)
    expect(out.join('\n')).toContain('缺省操作者 PRIME-0，内置缺省')
    expect(html).toContain('"actor":"PRIME-0"')
    expect(html).not.toContain('"actor":"panel"')
  })

  it('env PANEL_CHAT_ACTOR 兜底；--chat-actor 显式旗标优先于 env', async () => {
    vi.stubEnv('PANEL_CHAT_ACTOR', 'ENG-9')
    const ghost = path.join(tree.root, 'nope.sock')
    const port = await freePort()
    let fromEnv = ''
    const envCode = await cmdPanel(
      ['--portal', '--company-dir', tree.companyDir, '--db', tree.dbPath, '--chatd-socket', ghost, '--portal-port', String(port)],
      {
        waitForStop: async () => {
          fromEnv = await (await fetch(`http://127.0.0.1:${String(port)}/chat`)).text()
        },
      },
    )
    expect(envCode).toBe(0)
    expect(out.join('\n')).toContain('缺省操作者 ENG-9，来自 env PANEL_CHAT_ACTOR')
    expect(fromEnv).toContain('"actor":"ENG-9"')

    out = []
    const port2 = await freePort()
    let fromFlag = ''
    const flagCode = await cmdPanel(
      ['--portal', '--company-dir', tree.companyDir, '--db', tree.dbPath, '--chatd-socket', ghost, '--chat-actor', 'QA-2', '--portal-port', String(port2)],
      {
        waitForStop: async () => {
          fromFlag = await (await fetch(`http://127.0.0.1:${String(port2)}/chat`)).text()
        },
      },
    )
    expect(flagCode).toBe(0)
    expect(out.join('\n')).toContain('缺省操作者 QA-2，来自 --chat-actor')
    expect(out.join('\n')).not.toContain('ENG-9')
    expect(fromFlag).toContain('"actor":"QA-2"')
  })
})

describe('help 面（§1.4：--help 更新且监控面首行不变）', () => {
  it('SECTION.panel 首行仍为 studio-next panel --db；含 --portal 用法行', async () => {
    expect(SECTION.panel.trimStart().startsWith('studio-next panel --db <库路径>')).toBe(true)
    expect(SECTION.panel).toContain('--portal --company-dir <公司目录>')
    expect(SECTION.panel).toContain('--portal-port')
    expect(SECTION.panel).toContain('--chat-actor <工号>')
    expect(SECTION.panel).toContain('PRIME-0')
    const code = await cmdPanel(['--portal', '--help'])
    expect(code).toBe(0)
    expect(out[0]).toBe(SECTION.panel)
    expect(err).toEqual([])
  })
})
