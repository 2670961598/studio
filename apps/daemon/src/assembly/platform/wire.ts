/**
 * wire —— 协作平台接线三件（BC-S2 先拆再增：自 serve.ts 拆出——DEV-48 施工时顺带办理）
 *
 * 规格依据（实现单引用）：docs/23（localfile 协作平台）、docs/30+32（Taiga 推荐+真机
 * 试点——凭据 env 供给/字段映射旁挂文件）、docs/52-§六.1（hr-sync Taiga 面复用本件
 * buildContext 同源配置）。daemon.yaml 平台键 coerce 面仍归 serve.ts（配置事实源单一），
 * 本件只做运行时接线：resolveTaigaAuth（凭据）/ loadTaigaFieldMap（字段映射）/
 * wirePlatform（FlowPlatform 装配——serve 与 hr-sync 装配两处消费）。
 */

import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import type { FieldProvisionMap, FlowPlatform } from '@studio-next/contract'
import { createGateway, CONTROL_TICKET, type SignatureContext } from '@studio-next/gateway'
import { createLocalPlatform } from '@studio-next/localplatform'
import { createTaigaPlatform, type TaigaAuth, type TaigaEntity } from '@studio-next/taiga'
import { createFakePlatform } from '../../engine/fakes.ts'
import { createGatedPlatform } from '../../engine/tools/gated-platform.ts'
import type { ServeConfig } from '../serve.ts'

/**
 * 网关写收口接线（17-§7：engine 直调 platform 是最后一条未收口写路径——本函数收口）。
 * 控制面实例（ticket=CONTROL_TICKET）+ daemon 侧身份署名；gateway: false 时裸 platform
 * 直返（对照/测试用——生产不得关）。身份=共享活对象（serve.ts daemonIdentity 产物——
 * L1 热重载 mutate 面）。130-P3 自 serve.ts 拆出（20-§十五「先拆再增」；逐字搬迁）。
 */
export function wireGatedPlatform(
  raw: FlowPlatform,
  config: ServeConfig,
  identity: { secret: Uint8Array; ctx: SignatureContext; author: string },
  clock: () => number,
  log: (line: string) => void,
): FlowPlatform {
  if (!config.gateway) {
    log('[serve] 警告：gateway=false——平台写路径未过闸（仅测试/对照用；生产不得关，17-§7）')
    return raw
  }
  const { secret, ctx, author } = identity
  const usingDevSecret = config.gatewaySecret === undefined
  const gateway = createGateway({ secret, clock, ticket: CONTROL_TICKET, ctx, author })
  log(
    `[serve] 网关已接：平台写路径全收口（17-§7；控制面 control key，一调用一签发）` +
      `${usingDevSecret ? '——【警告】用开发缺省密钥（生产必配 daemon.yaml gatewaySecret:）' : '（密钥来自 daemon.yaml）'}`,
  )
  return createGatedPlatform(raw, gateway, { ctx, author })
}

/**
 * Taiga 凭据供给（token 供给面）：daemon.yaml 只配形态（taigaAuth: password|token），
 * 值一律经进程 env——TAIGA_USERNAME+TAIGA_PASSWORD（密码态：JWT 自动登录，401 自动
 * 刷新/重登，http.ts）或 TAIGA_TOKEN+TAIGA_REFRESH（token 态：预换 token，有 refresh
 * 才可续）。凭据值永不入 daemon.yaml/日志/台账（红名单，与 gatewaySecret 纪律同源）；
 * 缺键=fail-closed CONFIG_INVALID，只报缺哪个键名、不打印值。文件形态（0600 token
 * 文件，docs/32 冒烟惯例）归部署面装载（systemd EnvironmentFile / docker secrets
 * → env），daemon 只认 env。
 */
export function resolveTaigaAuth(mode: 'password' | 'token'): TaigaAuth {
  if (mode === 'password') {
    const username = process.env['TAIGA_USERNAME']
    const password = process.env['TAIGA_PASSWORD']
    if (username === undefined || username === '' || password === undefined || password === '') {
      throw new Error(
        'CONFIG_INVALID：taigaAuth: password 需 env TAIGA_USERNAME + TAIGA_PASSWORD' +
          '（值不入配置/日志；部署面经 EnvironmentFile/secrets 注入进程 env）',
      )
    }
    return { type: 'password', username, password }
  }
  const token = process.env['TAIGA_TOKEN']
  if (token === undefined || token === '') {
    throw new Error(
      'CONFIG_INVALID：taigaAuth: token 需 env TAIGA_TOKEN（可选 TAIGA_REFRESH 供续期；' +
        '无 refresh 且 token 失效须重启换新——token 态无密码可重登）',
    )
  }
  const refresh = process.env['TAIGA_REFRESH']
  return { type: 'token', token, ...(refresh !== undefined && refresh !== '' ? { refresh } : {}) }
}

/**
 * Taiga 字段映射装载（taigaFieldsFile）：扁平 YAML 子集不收嵌套，FieldProvisionMap
 * 形状的映射旁挂 JSON 文件；读不到/非法 JSON/缺 fields 段=CONFIG_INVALID（明报不猜）。
 * 深层形状（值非空、类型枚举）归 TaigaFieldMap/validateProvisionMap 二道校验。同一份
 * 文件在迁移期也是 fields.provision 的输入（单一事实源，见 deliverables/migration.md）。
 */
export function loadTaigaFieldMap(file: string): FieldProvisionMap {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(resolvePath(file), 'utf8'))
  } catch (err) {
    throw new Error(
      `CONFIG_INVALID：taigaFieldsFile 不是合法 JSON（${file}）：${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const fields = (raw as Record<string, unknown> | null)?.['fields']
  if (typeof raw !== 'object' || raw === null || typeof fields !== 'object' || fields === null) {
    throw new Error(`CONFIG_INVALID：taigaFieldsFile 须是 FieldProvisionMap 形状（{fields,types?,states,stateFlow}，缺 fields 段）：${file}`)
  }
  return raw as FieldProvisionMap
}

/**
 * provision 声明态面（studio-dev-126 C2 巡逻核输入，单源计算）：
 * 绑定实体的声明态全集 =（entities[entity] 档案优先，回退 map.states——provision
 * 写入 ctx.desc.statuses 的同域面）∪ typeInbox 值域（类型收件态是绑定实体上的
 * 状态名——建单解析序第二级）。**不含**其它实体的 entities[].states（它们落
 * issue-statuses/task-statuses 别端点，与 schema() 反射的绑定实体状态集不可比——
 * 收进来自会双向假红）。排序输出=确定性（配置指纹可比）。
 */
export function provisionDeclaredStates(map: FieldProvisionMap, entity: TaigaEntity): string[] {
  const profile = map.entities?.[entity]
  const base = profile !== undefined && profile.states.length > 0 ? profile.states : map.states
  const out = new Set<string>(base)
  for (const inbox of Object.values(map.typeInbox ?? {})) out.add(inbox)
  return [...out].sort()
}

/**
 * 平台接线：localfile=@studio-next/localplatform（docs/23 LocalFile 协作平台——真单首跑
 * 用本地文件平台，不依赖 Taiga/YouTrack 写面）；taiga=@studio-next/taiga（docs/30 推荐
 * + docs/32 真机试点——构造期公司作用域绑定 baseUrl/project/entity/字段映射/凭据；
 * 状态集/自定义属性经 fields.provision 建档后才可 transition/setField，缺档
 * unknown-state/unknown-attribute 明报）；fake=demo 内存平台。
 * LocalFile 根=platformDir（缺省 <rootDir>/platform）。**provision（初始态=流表首态）不在此
 * 做**：字段/状态 provision 是公司装载面的一次性运营动作（platform.fields.provision），
 * daemon 不代写——建单初始态定格在 created 事件（packages/localplatform/issues.ts 头注）。
 * taiga 同理：provision 归迁移/onboard 脚本（deliverables/migration.md），daemon 只消费。
 */
export function wirePlatform(config: ServeConfig): FlowPlatform {
  if (config.platform === 'localfile') {
    const root = resolvePath(config.platformDir ?? `${config.rootDir}/platform`)
    return createLocalPlatform(root)
  }
  if (config.platform === 'taiga') {
    if (config.taigaAuth === undefined) {
      // parse 面已交叉校验；直接构造 ServeConfig 的测试面在此兜底（明报不猜）
      throw new Error('CONFIG_INVALID：platform: taiga 需配 taigaAuth（password|token）——凭据值经 env TAIGA_* 供给')
    }
    return createTaigaPlatform({
      baseUrl: config.taigaUrl ?? '',
      project: config.taigaProject ?? '',
      auth: resolveTaigaAuth(config.taigaAuth),
      ...(config.taigaEntity !== undefined ? { entity: config.taigaEntity } : {}),
      ...(config.taigaFieldsFile !== undefined ? { fields: loadTaigaFieldMap(config.taigaFieldsFile) } : {}),
    })
  }
  return createFakePlatform()
}
