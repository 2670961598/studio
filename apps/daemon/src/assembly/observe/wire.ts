/**
 * assembly/observe/wire —— 观察面（OBS）生产装配：观察位置解析＋写面/端口/拍内步骤接线
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/17-§2（主循环七相位：观察面挂相位 1 采集尾——装配不改相位、不新增事件名）；
 *   - docs/17-§6（收割四要件：观察写入不参与收割判定；写失败原样进拍错误面）；
 *   - docs/v2/14 §1.8（PORT-OBS：只读投影＋reportFault 唯一写槽）／§二（实现域 engine/observe）；
 *   - docs/v2/11 §0.2-1（具名决定者：观察位置不得写成框架/daemon/监控——contract 会拒收）；
 *   - docs/v2/08 §4.4（监控故障是一等观察）／§5.3（观察结束不是遗忘）；
 *   - 公司目录 org-config.yaml（综合部 运维岗 OPS-1＝观察位置；本件按 role 解析、不硬编码工号）；
 *   - studio-dev-539（差距项 #13：只读投影生产消费=0＋reportFault 无实现）。
 *
 * 装配纪律（fail-closed，不冒名）：
 *   - 观察位置**必须在册**：公司快照里找 role 含「运维/巡查」的在岗人员；解析不到＝观察写入面关闭
 *     （启动日志一行明报），**不得**用框架/daemon/监控等匿名主体充当决定者（§0.2-1 判负）；
 *   - 写口唯一：REC-OBS-02/03/04 一律经 store OBS 写面（`createObservationWriteFace` → hist.append）；
 *   - 幂等/时钟/id 全注入（不读墙钟、不造随机）；本件不缓存平台句柄、不改引擎相位语义。
 *
 * 搬移前原位注释（studio-dev-617 Q6 先拆后增适配——runtime.ts 三行既有装配注释随观察面装配块迁入，
 * 内容逐字保留；runtime 550/600 边缘约束，仅位置变、语义不变）：
 *   - 公司面活持有者（docs/38-§2 L1 热重载替换点）：快照整组换，闭包零重建；
 *   - 记录写失败不打断拍（wire 三态回报）；事件面照旧，欠账由 projection 对账发现；
 *   - 类型流表（DEV-43）：workflows 声明 → T:<type> 键（无声明=undefined=不注入，D9）。
 */
import type { CallContext, CompanySnapshot, PersonRef, Signature } from '@studio-next/contract'
import { createObservationWriteFace, type ObservationWriteFace } from '@studio-next/store'
import {
  createObservationTickStep,
  createObservationWritePort,
  OBS_SELF_FACES,
  OBS_SELF_VIEW,
  type ObservationTickStep,
  type ObservationWritePort,
} from '../../engine/observe/index.ts'
import type { Ledger } from '@studio-next/store'

/** 观察位置解析规则：role 文本命中「运维/巡查」（公司目录岗位口径；不硬编码工号——多公司可换） */
const OBSERVER_ROLE_RE = /运维|巡查/

/** 写入路径名（producer.writtenBy；与 engine/store 常量同口径——此处只作日志面说明） */
const OBS_WRITER_LABEL = 'daemon:engine/observe'

/** 观察位置解析（在岗＋role 命中；同命中多人的确定性序=工号升序） */
export function resolveObservationPosition(people: readonly PersonRef[]): string | undefined {
  const candidates = people
    .filter((person) => (person.status ?? 'active') === 'active')
    .filter((person) => person.role !== undefined && OBSERVER_ROLE_RE.test(person.role))
    .map((person) => person.id)
    .sort()
  return candidates[0]
}

/** 观察面装配依赖（全注入；缺观察位置=面关，不静默用匿名主体） */
export interface WireObservFaceDeps {
  readonly ledger: Ledger
  readonly snapshot: Pick<CompanySnapshot, 'people'>
  /** 公司 slug（记录 companyRef／CallContext 公司维） */
  readonly company: string
  /** 毫秒时钟（与 runServe 同源注入） */
  readonly clock: () => number
  /** 记录 id 铸造（生产=ULID；与引擎同源签名 `(ts) => id`） */
  readonly makeId: (ts: number) => string
  readonly log: (line: string) => void
  /** 观察视图/面（缺省 MON-15 监控自身；注入面供定向测试） */
  readonly viewName?: string
  readonly faces?: readonly string[]
  /** 三不入·库闸（生产=runtime outbound.gate.guardStoreRecord；缺省=不扫） */
  readonly guardRecord?: (record: unknown) => unknown
}

/** 观察面装配产物（engine 注入面＋端口/写面供测试与运维核验） */
export interface WireObservFaceResult {
  readonly step: ObservationTickStep
  readonly port: ObservationWritePort
  readonly writer: ObservationWriteFace
  readonly observer: string
}

/**
 * 装配观察面（返回 undefined＝无观察位置在册：面关并落启动日志一行，不抛错——
 * 观察面缺席不改主循环语义；缺位本身由面板/运维面可见，不静默）。
 */
export function wireObservationFace(deps: WireObservFaceDeps): WireObservFaceResult | undefined {
  const observer = resolveObservationPosition(deps.snapshot.people)
  if (observer === undefined) {
    deps.log(
      '[serve] OBS 观察写入面未装配：公司快照无「运维/巡查」在岗人员（观察位置缺位）——' +
        'REC-OBS-02/03/04 不落库（不冒名决定者，§0.2-1）；补在岗观察位置后重启即装配',
    )
    return undefined
  }
  const writer = createObservationWriteFace({
    db: deps.ledger.db,
    company: deps.company,
    decidedBy: observer,
    makeId: () => deps.makeId(deps.clock()),
    now: () => new Date(deps.clock()).toISOString(),
    ...(deps.guardRecord !== undefined ? { guardRecord: deps.guardRecord } : {}),
  })
  const port = createObservationWritePort({ writer, company: deps.company, decidedBy: observer })
  const viewName = deps.viewName ?? OBS_SELF_VIEW
  const faces = deps.faces ?? OBS_SELF_FACES
  const signature: Signature = { actorKind: 'system', actorRef: OBS_WRITER_LABEL, onBehalfOf: observer }
  const ctx: CallContext = {
    company: { companyId: deps.company, slug: deps.company },
    caller: { callerId: OBS_WRITER_LABEL, kind: 'program', programRef: 'studio-next/daemon' },
    authority: [],
    signature,
  }
  const step = createObservationTickStep({
    company: deps.company,
    viewName,
    faces,
    port,
    ctx: () => ctx,
    log: deps.log,
  })
  deps.log(
    `[serve] OBS 观察写入面已装配：观察位置=${observer}（运维/巡查岗，system 代写）视图=${viewName} ` +
      `面=${faces.join('/')} 写口=records(REC-OBS-02/03/04)；只读投影消费=projectObservationSnapshot（生产消费>0）`,
  )
  return { step, port, writer, observer }
}
