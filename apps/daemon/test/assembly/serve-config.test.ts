/**
 * daemon.yaml platform: taiga 配置面测试（DEV-2 taiga 接线刀）：
 *   - 合法 taiga 配置装载（必配键/可选键/缺省实体）
 *   - platform 值收紧：未知值拒绝（不静默降 fake——taiga 误配跑成 demo 假平台=写面黑洞）
 *   - 必配键缺失交叉校验（fail-fast）
 *   - 凭据供给 fail-closed：缺 env TAIGA_* 拒构造（值不入配置/日志——红名单只测键名报错）
 *   - 字段映射文件：非法 JSON / 缺 fields 段明报
 * 构造期零网络（createTaigaPlatform 懒连接——http.ts 头注），全部离线可跑。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseDaemonConfig, wirePlatform, type ServeConfig } from '../../src/assembly/serve.ts'

const TAIGA_YAML = [
  'db: ./var/ledger.sqlite',
  'company: studio-dev',
  'rootDir: ./var',
  'platform: taiga',
  'taigaUrl: http://localhost:9000',
  'taigaProject: studio-dev',
  'taigaAuth: password',
].join('\n')

function baseCfg(over: Partial<ServeConfig> = {}): ServeConfig {
  return {
    db: './var/ledger.sqlite',
    platform: 'taiga',
    company: 'studio-dev',
    rootDir: './var',
    tickMs: 1000,
    maxActionsPerTick: 4,
    maxInflight: 2,
    stallAfterMs: 1,
    // DEV-44：本套测配置面非响置面——刀关（0）保持改动前告警-only 语义
    stallKillAfterAlarms: 0,
    laneTtlMs: 1,
    breakerThreshold: 3,
    autoApprove: false,
    jobs: false,
    jobPollMs: 15,
    matrix: false,
    fileWatch: false,
    cadence: false,
    sla: false,
    reloadWatch: true,
    gateway: true,
    taigaUrl: 'http://localhost:9000',
    taigaProject: 'studio-dev',
    taigaAuth: 'password',
    ...over,
  }
}

const ENV_KEYS = ['TAIGA_USERNAME', 'TAIGA_PASSWORD', 'TAIGA_TOKEN', 'TAIGA_REFRESH'] as const
const saved: Record<string, string | undefined> = {}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
    delete saved[k]
  }
})

function setEnv(vals: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) saved[k] = process.env[k]
    delete process.env[k]
  }
  for (const [k, v] of Object.entries(vals)) process.env[k] = v
}

describe('daemon.yaml platform: taiga 配置面', () => {
  it('合法 taiga 配置装载（必配键齐全，实体缺省 userstory）', () => {
    const cfg = parseDaemonConfig(TAIGA_YAML)
    expect(cfg.platform).toBe('taiga')
    expect(cfg.taigaUrl).toBe('http://localhost:9000')
    expect(cfg.taigaProject).toBe('studio-dev')
    expect(cfg.taigaAuth).toBe('password')
    expect(cfg.taigaEntity).toBeUndefined()
  })

  it('taigaEntity: issue 可选装载', () => {
    const cfg = parseDaemonConfig(`${TAIGA_YAML}\ntaigaEntity: issue`)
    expect(cfg.taigaEntity).toBe('issue')
  })

  it('未知 platform 值拒绝（不静默降 fake——写面黑洞防御）', () => {
    expect(() => parseDaemonConfig('platform: taigaa')).toThrow(/platform 须为 localfile\|taiga\|fake/)
  })

  it('taigaEntity 非法值拒绝', () => {
    expect(() => parseDaemonConfig(`${TAIGA_YAML}\ntaigaEntity: epic`)).toThrow(/taigaEntity 须为 userstory\|issue/)
  })

  it('taigaAuth 非法值拒绝（并提示凭据只经 env）', () => {
    expect(() => parseDaemonConfig(TAIGA_YAML.replace('taigaAuth: password', 'taigaAuth: bearer'))).toThrow(
      /taigaAuth 须为 password\|token/,
    )
  })

  it('platform: taiga 缺必配键交叉校验（fail-fast）', () => {
    expect(() => parseDaemonConfig(['db: ./x.sqlite', 'company: demo', 'platform: taiga'].join('\n'))).toThrow(
      /缺必配键：taigaUrl、taigaProject、taigaAuth/,
    )
    expect(() =>
      parseDaemonConfig(['db: ./x.sqlite', 'company: demo', 'platform: taiga', 'taigaUrl: http://t:9000'].join('\n')),
    ).toThrow(/缺必配键：taigaProject、taigaAuth/)
  })

  it('密码态缺凭据 env → 构造期 fail-closed（只报键名不打印值）', () => {
    setEnv({})
    expect(() => wirePlatform(baseCfg())).toThrow(/TAIGA_USERNAME \+ TAIGA_PASSWORD/)
  })

  it('token 态缺 TAIGA_TOKEN → 构造期 fail-closed', () => {
    setEnv({})
    expect(() => wirePlatform(baseCfg({ taigaAuth: 'token' }))).toThrow(/TAIGA_TOKEN/)
  })

  it('密码态凭据齐全 → 构造成功（零网络：懒连接）', () => {
    setEnv({ TAIGA_USERNAME: 'admin', TAIGA_PASSWORD: 'secret-not-logged' })
    const p = wirePlatform(baseCfg())
    expect(typeof p.issues.create).toBe('function')
    expect(typeof p.fields.provision).toBe('function')
  })

  it('token 态凭据齐全（含 refresh）→ 构造成功', () => {
    setEnv({ TAIGA_TOKEN: 'jwt-not-logged', TAIGA_REFRESH: 'r1' })
    const p = wirePlatform(baseCfg({ taigaAuth: 'token' }))
    expect(typeof p.activity.since).toBe('function')
  })

  it('taigaFieldsFile 非法 JSON / 缺 fields 段 → CONFIG_INVALID 明报', () => {
    setEnv({ TAIGA_USERNAME: 'admin', TAIGA_PASSWORD: 'x' })
    const dir = mkdtempSync(path.join(tmpdir(), 'taiga-fields-'))
    const badJson = path.join(dir, 'bad.json')
    writeFileSync(badJson, '{not json')
    const noFields = path.join(dir, 'nofields.json')
    writeFileSync(noFields, JSON.stringify({ states: ['New'] }))
    expect(() => wirePlatform(baseCfg({ taigaFieldsFile: badJson }))).toThrow(/taigaFieldsFile 不是合法 JSON/)
    expect(() => wirePlatform(baseCfg({ taigaFieldsFile: noFields }))).toThrow(/缺 fields 段/)
  })

  it('合法字段映射文件装载（业务名→平台属性名）', () => {
    setEnv({ TAIGA_USERNAME: 'admin', TAIGA_PASSWORD: 'x' })
    const dir = mkdtempSync(path.join(tmpdir(), 'taiga-fields-'))
    const map = path.join(dir, 'map.json')
    writeFileSync(
      map,
      JSON.stringify({
        fields: { dept: '部门', level: '等级', lane: '泳道', type: '类型' },
        types: { level: 'int' },
        states: ['New', 'In progress', 'Done'],
        stateFlow: { New: ['In progress'], 'In progress': ['Done'] },
      }),
    )
    expect(() => wirePlatform(baseCfg({ taigaFieldsFile: map }))).not.toThrow()
  })
})

// —— 人事同步器配置面（DEV-48，docs/52-§九：缺省关；开=交叉校验 fail-fast） ——

const BASE_YAML = ['db: ./x.sqlite', 'company: demo', 'platform: localfile'].join('\n')

describe('daemon.yaml hrSync 配置面（DEV-48）', () => {
  it('缺省：hrSync=false + 节流/重试缺省值（52-§9.2）', () => {
    const cfg = parseDaemonConfig(BASE_YAML)
    expect(cfg.hrSync).toBe(false)
    expect(cfg.hrMatrix).toBe(false)
    expect(cfg.hrMaxPerTick).toBe(2)
    expect(cfg.hrRetryLimit).toBe(3)
    expect(cfg.hrApplyingTimeoutMs).toBe(0) // 0=装配期按 10×tickMs 推导
    expect(cfg.hrTaigaInvitePolls).toBe(10)
    expect(cfg.hrPeopleWatch).toBe(false) // 129-C：缺省关（模板 hooks 段惰性面）
  })

  it('hrPeopleWatch: true 缺 hrSync → 拒（源挂 hr-sync 分类器出口——无 hrSync 即无 diff 出口，129-C）', () => {
    expect(() => parseDaemonConfig(`${BASE_YAML}\nhrPeopleWatch: true`)).toThrow(/hrPeopleWatch/)
  })

  it('hrSync: true + hrPeopleWatch: true → 过；false 显式过', () => {
    const cfg = parseDaemonConfig(`${BASE_YAML}\nhrSync: true\nhrPeopleWatch: true`)
    expect(cfg.hrPeopleWatch).toBe(true)
    expect(parseDaemonConfig(`${BASE_YAML}\nhrSync: true\nhrPeopleWatch: false`).hrPeopleWatch).toBe(false)
  })

  it('hrPeopleWatch 坏值拒绝（布尔面）', () => {
    expect(() => parseDaemonConfig(`${BASE_YAML}\nhrSync: true\nhrPeopleWatch: 3`)).toThrow(/hrPeopleWatch|布尔/)
  })

  it('hrSync: true + platform: taiga 缺 hrTaigaInviteLog → 拒（令牌只落日志——§6.1）', () => {
    expect(() => parseDaemonConfig(`${TAIGA_YAML}\nhrSync: true`)).toThrow(/hrTaigaInviteLog/)
  })

  it('hrSync: true + platform: taiga 配齐 inviteLog → 过', () => {
    const cfg = parseDaemonConfig(`${TAIGA_YAML}\nhrSync: true\nhrTaigaInviteLog: ./var/taiga-invite.log`)
    expect(cfg.hrSync).toBe(true)
    expect(cfg.hrTaigaInviteLog).toBe('./var/taiga-invite.log')
  })

  it('hrSync: true + hrMatrix: true 缺 hrMatrixRooms（或缺 company= 项）→ 拒（§7.2）', () => {
    expect(() => parseDaemonConfig(`${BASE_YAML}\nhrSync: true\nhrMatrix: true`)).toThrow(/hrMatrixRooms/)
    expect(() => parseDaemonConfig(`${BASE_YAML}\nhrSync: true\nhrMatrix: true\nhrMatrixRooms: 研发部=#rd:srv`)).toThrow(/company=/)
  })

  it('hrMatrixRooms 合法形（company + 部门项）→ 过', () => {
    const cfg = parseDaemonConfig(`${BASE_YAML}\nhrSync: true\nhrMatrix: true\nhrMatrixRooms: company=#co:srv;研发部=#rd:srv`)
    expect(cfg.hrMatrixRooms).toBe('company=#co:srv;研发部=#rd:srv')
  })

  it('数值键坏值拒绝（hrMaxPerTick/hrRetryLimit/hrApplyingTimeoutMs/hrTaigaInvitePolls）', () => {
    expect(() => parseDaemonConfig(`${BASE_YAML}\nhrSync: true\nhrMaxPerTick: 0`)).toThrow(/hrMaxPerTick/)
    expect(() => parseDaemonConfig(`${BASE_YAML}\nhrSync: true\nhrRetryLimit: x`)).toThrow(/hrRetryLimit/)
    expect(() => parseDaemonConfig(`${BASE_YAML}\nhrSync: true\nhrApplyingTimeoutMs: -1`)).toThrow(/hrApplyingTimeoutMs/)
    expect(() => parseDaemonConfig(`${BASE_YAML}\nhrSync: true\nhrTaigaInvitePolls: 0`)).toThrow(/hrTaigaInvitePolls/)
  })
})

// —— 队列闸/排序键配置面（129-§6.2，studio-dev-167 单B：人闸+todo_queue+ageBoost） ——

describe('daemon.yaml 队列键配置面（129-§6.2 R3/R4）', () => {
  it('缺省：四键全不注入（人闸走引擎缺省帽 1；ageBoost 走 60min 步长；无置顶无覆盖）', () => {
    const cfg = parseDaemonConfig(BASE_YAML)
    expect(cfg.maxInflightPerPerson).toBeUndefined()
    expect(cfg.queueAgeStepMs).toBeUndefined()
    expect(cfg.personInflightOverrides).toBeUndefined()
    expect(cfg.pinnedTickets).toBeUndefined()
  })

  it('合法值装载：maxInflightPerPerson / queueAgeStepMs / personInflightOverrides / pinnedTickets', () => {
    const cfg = parseDaemonConfig(
      [
        BASE_YAML,
        'maxInflightPerPerson: 2',
        'queueAgeStepMs: 60000',
        'personInflightOverrides: AGENT-1=2;AGENT-2=3',
        'pinnedTickets: T-1,T-2',
      ].join('\n'),
    )
    expect(cfg.maxInflightPerPerson).toBe(2)
    expect(cfg.queueAgeStepMs).toBe(60000)
    expect(cfg.personInflightOverrides).toBe('AGENT-1=2;AGENT-2=3')
    expect(cfg.pinnedTickets).toBe('T-1,T-2')
  })

  it('数值键坏值拒绝（maxInflightPerPerson/queueAgeStepMs 非正整数）', () => {
    expect(() => parseDaemonConfig(`${BASE_YAML}\nmaxInflightPerPerson: 0`)).toThrow(/maxInflightPerPerson 须为正整数/)
    expect(() => parseDaemonConfig(`${BASE_YAML}\nmaxInflightPerPerson: x`)).toThrow(/maxInflightPerPerson/)
    // -1 会被扁平 YAML 视作列表行（嵌套值拒绝在前）——0 是标量，走本键的正整数闸
    expect(() => parseDaemonConfig(`${BASE_YAML}\nqueueAgeStepMs: 0`)).toThrow(/queueAgeStepMs 须为正整数/)
  })

  it('personInflightOverrides 坏形态拒绝（坏段不静默忽略——写面黑洞防御）', () => {
    expect(() => parseDaemonConfig(`${BASE_YAML}\npersonInflightOverrides: AGENT-1`)).toThrow(/工号=N/)
    expect(() => parseDaemonConfig(`${BASE_YAML}\npersonInflightOverrides: AGENT-1=0`)).toThrow(/正整数/)
  })
})
