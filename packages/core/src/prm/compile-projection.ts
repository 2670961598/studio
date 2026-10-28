/**
 * compile-projection —— 策略投影（PRM）生成器：九段清单 / digest / unsupportedSegments
 *
 * 依据（MIG-07 / IMPL-07-04；G-PORT-EXEC.compileProjection；GAP-V2-02 生成器腿）：
 *   - v2/14 §六（签名冻结）：输入 ProjectionInput＝{任职关系引用、计划锁引用、能力声明集、
 *     部署收紧面（只收紧字段）}；输出 PolicyProjection＝{九段清单、digest、
 *     `unsupportedSegments[]` 逐段损失}；实现=core 纯函数（零 IO、可复算）；
 *   - v2/12 §1.6（段语义与生成八律 PRM-G1..PRM-G8；正式号登记 v2/09 §一-61）：
 *     PRM-G1 单向编译不回写｜PRM-G2 幂等（同输入同摘要）｜PRM-G3 只收紧（清单×部署
 *     可比较字段取交集，空集拒启；网络字段不参与）｜PRM-G4 段绑定（一段一清单）｜
 *     PRM-G5 撤回可传（撤回即重生成或整体作废，不得只改内存）｜PRM-G6 不猜不填（输入
 *     缺字段拒绝生成）｜PRM-G7 可复算（纯函数+显式输入）｜PRM-G8 宿主子集显式降级
 *     （未承载段进 `unsupportedSegments[]` 并逐段报损失）；
 *   - v2/09 ENU-108（段名值集唯一主表，本件不另立字面序）；
 *   - v1 78-§3.2.2（九段字段与来源）、§3.2.3（禁止「最新」引用、禁止空集当全集、
 *     reserved 不得写成 permitted+审批、persona 恒 soft、清单内不得出现秘密值/路径）、
 *     §3.3（G1–G8 细目）、§3.4（按段计状态：未承载段最高 4/5 态，不得记 6/11）；
 *   - 81-files/12（八段必填、`persona` 可选；缺 `persona` 不拒、不计损失；
 *     `unsupportedSegments` 含 `authority`/`tools` → 拒载）。
 *
 * 输入形状与契约的接缝（缺口，登记不私改）：
 *   `packages/contract` 的 `ProjectionInput` 已冻结，但未含 v2/14 §六 的「部署收紧面」。
 *   本件以**只增不改**的方式承载它：`CompileProjectionInput.deployment`（可选面，见
 *   `./projection-input.ts`）。该面的字段只能收紧或声明，不能放大；本件不修改契约包。
 *   契约补字段须走批示流——本单只登记缺口，不代改。
 *
 * 语义边界（不得读成更强结论）：
 *   - `enabled:true` 只表示「该段可被本清单表达，且有显式来源引用」；**不表示**宿主已加载、
 *     已承认、按计划生效（v2/12 §1.6 的第 6/11 态另证），也不表示验签已成立
 *     （SEC-SIG-04 通道未建，PRB-08 未执行）；
 *   - `unsupportedSegments[]` 是生成期逐段损失（同一份清单驱动运行期按段计状态），
 *     不是丢弃：段的来源引用仍保留在 `segments[seg].sourceRefs`，`enabled:false` 表不可执行；
 *   - `persona` 为可选段：无引用即不出现、不计损失（81-files/12）；声明了引用却无承载
 *     则进损失面（不得静默丢弃）；
 *   - 网络是声明外置：不参与交集（v2/12 §1.6 / 78-§3.3 G3），本件不携带可放行的网络字段；
 *   - PTC 默认 forbidden（78-§3.2.4），本件只以段注记声明，不因宿主能力自动放开；
 *   - 本件不产生授权、不作验收、不落盘、不签名、不调宿主。
 *
 * 纯函数纪律：
 *   - **零 IO**：不碰文件/网络/子进程/环境；摘要走 `../jcs.ts`（其内仅有 crypto 纯哈希，
 *     沿 jcs.ts 先例，非 IO）；
 *   - **零时钟**：不接受「当前时间」；`validityFrom`/`validityUntil` 是显式输入，时刻只做
 *     `Date.parse` 算术比较（不读时钟），有效期是否已过由调用方按 `atMs` 判定；
 *   - **零随机**、**零输入改写**：引用一律复制/规范化进新数组；输出递归冻结；
 *   - **可复算**：digest＝JCS 规范文本的 SHA-256（`sha256:<hex>`），覆盖除 digest 自身的
 *     全部投影内容；同输入恒同 digest。
 *
 * 本件导出面：`compileProjection`（生成）、`projectionDigest`（复算）、`projectionGate`
 * （生成期门禁前腿）、输入类型与段序常量。
 */
import type { PolicyProjection, PortResult, ProjectionSegment, ProjectionSegmentValue } from '@studio-next/contract'
import type { CompileProjectionInput, NormalizedInput } from './projection-input.ts'
import { normalizeInput } from './projection-input.ts'
import type { InstantValue } from './spec.ts'
import {
  GATING_SEGMENTS,
  PROJECTION_SEGMENTS,
  deepFreeze,
  digestBody,
  normalizeRefs,
  rejectedPrecondition,
  segmentValue,
} from './spec.ts'

// 稳定导入面：外部只从 `compile-projection.ts` 取用（跨件实现细节不外溢）
export type {
  CompileProjectionInput,
  ProjectionDeployment,
  ProjectionSandboxDeclaration,
} from './projection-input.ts'
export {
  GATING_SEGMENTS,
  PROJECTION_SEGMENTS,
  PRM_CANONICALIZATION,
  PRM_DIGEST_PREFIX,
} from './spec.ts'

/** 门禁判定结果（生成期口径；不是启动授权） */
export interface ProjectionGateResult {
  readonly launchable: boolean
  readonly blockingSegments: readonly ProjectionSegment[]
}

interface SegmentBuild {
  readonly value: ProjectionSegmentValue
}

// ─────────────────────────────────────────────────────────────────────────────
// 一、九段编译（PRM-G3 只收紧 / G4 段绑定 / G6 不猜不填 / G8 显式降级）
// ─────────────────────────────────────────────────────────────────────────────

function buildSegments(
  input: NormalizedInput,
  toolRefs: readonly string[],
  effectiveUntil: InstantValue | undefined,
  narrowedByDeployment: boolean,
): {
  readonly segments: Record<ProjectionSegment, ProjectionSegmentValue>
  readonly unsupportedSegments: readonly ProjectionSegment[]
} {
  const { deployment } = input
  const carried = deployment.carriedSegments
  const unsupported: ProjectionSegment[] = []
  const hostNote = `host:${input.hostKind}@${input.hostVersion};binding:${input.hostBindingRef}`

  /** 不可支持段：保留来源引用（不丢弃）、enabled:false、逐段原因进注记、进损失面 */
  const unsupportedSegment = (
    segment: ProjectionSegment,
    sourceRefs: readonly string[],
    reason: 'host-lacks-carrier' | `input-lacks-source(${string})`,
  ): SegmentBuild => {
    unsupported.push(segment)
    return { value: segmentValue(false, normalizeRefs(sourceRefs), `unsupported:${reason}`) }
  }

  const builds: Record<ProjectionSegment, SegmentBuild> = {
    identity: {
      // 身份段恒由本层编译（数据段，不依赖宿主执行面）；host/binding 进注记以绑定目标宿主，
      // 防止把 A 宿主的清单重放到 B 宿主（摘要因此对 host/binding 敏感）。
      value: segmentValue(true, normalizeRefs([input.companyId, input.workRef]), hostNote),
    },
    authority: carried.has('authority')
      ? { value: segmentValue(true, normalizeRefs(input.grantRefs)) }
      : unsupportedSegment('authority', input.grantRefs, 'host-lacks-carrier'),
    plan: {
      // 计划段恒由本层编译：计划锁引用＋能力描述引用；已知不能由 planRef 承载（不在本件猜）
      value: segmentValue(true, normalizeRefs([input.planRef, ...input.capabilityRefs])),
    },
    tools: carried.has('tools')
      ? {
          // 空集＝无工具，不是全部（78-§3.2.3 规则 2）；PTC 缺省 forbidden（§3.2.4）
          value: segmentValue(
            true,
            normalizeRefs(toolRefs),
            toolRefs.length === 0 ? 'ptc:forbidden;allowlist:empty(no-tools)' : 'ptc:forbidden',
          ),
        }
      : unsupportedSegment('tools', input.capabilityRefs, 'host-lacks-carrier'),
    sandbox:
      carried.has('sandbox') && deployment.sandbox !== undefined
        ? {
            value: segmentValue(
              true,
              normalizeRefs([deployment.sandbox.rootRef, ...input.secretTypes]),
              `mode:${deployment.sandbox.mode};network:external-only`,
            ),
          }
        : carried.has('sandbox')
          ? unsupportedSegment('sandbox', input.secretTypes, 'input-lacks-source(deployment.sandbox)')
          : unsupportedSegment('sandbox', input.secretTypes, 'host-lacks-carrier'),
    approval:
      carried.has('approval') && deployment.approvalTemplateRef !== undefined
        ? {
            value: segmentValue(
              true,
              normalizeRefs([deployment.approvalTemplateRef]),
              'default-template;approval-not-acceptance',
            ),
          }
        : carried.has('approval')
          ? unsupportedSegment('approval', [], 'input-lacks-source(deployment.approvalTemplateRef)')
          : unsupportedSegment('approval', [], 'host-lacks-carrier'),
    evidence:
      carried.has('evidence') && deployment.evidenceSinkRef !== undefined
        ? {
            value: segmentValue(
              true,
              normalizeRefs([deployment.evidenceSinkRef]),
              'sink:external-declared',
            ),
          }
        : carried.has('evidence')
          ? unsupportedSegment('evidence', [], 'input-lacks-source(deployment.evidenceSinkRef)')
          : unsupportedSegment('evidence', [], 'host-lacks-carrier'),
    persona:
      deployment.personaRefs.length === 0
        ? // 可选段：无引用＝不出现、不计损失（81-files/12）；不填默认人设
          { value: segmentValue(false, [], 'absent:optional-soft-segment') }
        : carried.has('persona')
          ? { value: segmentValue(true, normalizeRefs(deployment.personaRefs), 'weight:soft') }
          : unsupportedSegment('persona', deployment.personaRefs, 'host-lacks-carrier'),
    validity: {
      value: segmentValue(
        true,
        normalizeRefs([
          input.validityFrom.text,
          ...(effectiveUntil === undefined ? [] : [effectiveUntil.text]),
        ]),
        narrowedByDeployment ? 'window:narrowed-by-deployment' : undefined,
      ),
    },
  }

  const segments: Record<ProjectionSegment, ProjectionSegmentValue> = {
    identity: builds.identity.value,
    authority: builds.authority.value,
    plan: builds.plan.value,
    tools: builds.tools.value,
    sandbox: builds.sandbox.value,
    approval: builds.approval.value,
    persona: builds.persona.value,
    evidence: builds.evidence.value,
    validity: builds.validity.value,
  }

  // G8：损失面恒按 ENU-108 序（与 segments 同序），保证可复算且可逐段驱动状态
  const orderedUnsupported = PROJECTION_SEGMENTS.filter((segment) => unsupported.includes(segment))
  return { segments, unsupportedSegments: orderedUnsupported }
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、生成入口
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 生成策略投影（PRM）。
 *
 * 输入：`ProjectionInput`（契约冻结面）＋可选 `deployment`（部署收紧/承载声明）。
 * 输出：`PolicyProjection`（九段全键、`unsupportedSegments[]`、`digest`、`authorityRefs`、
 * `validity`），成功时递归冻结。
 * 失败：`PortResult` 的 `err`（拒绝生成），`category='rejected_precondition'`；
 * 无副作用、不可重试、无需对账。
 */
export function compileProjection(input: CompileProjectionInput): PortResult<PolicyProjection> {
  const normalized = normalizeInput(input)
  if (normalized.kind === 'err') return normalized
  const value = normalized.value

  // PRM-G3 只收紧（一）：工具白名单 = 能力声明集 ∩ 部署允许集；部署只能收窄
  let toolRefs: readonly string[] = value.capabilityRefs
  if (value.deployment.allowedCapabilityRefs !== undefined) {
    const allowed = new Set(value.deployment.allowedCapabilityRefs)
    toolRefs = value.capabilityRefs.filter((ref) => allowed.has(ref))
    if (value.capabilityRefs.length > 0 && toolRefs.length === 0) {
      return rejectedPrecondition(
        'projection-intersection-empty',
        'tools 交集为空：能力声明集与部署允许集无交集（空集拒启，不得取并集）',
      )
    }
  }

  // PRM-G3 只收紧（二）：生效窗取更早的上界；部署不得延长输入窗
  const deploymentUntil = value.deployment.validityUntil
  let effectiveUntil: InstantValue | undefined = value.validityUntil
  let narrowedByDeployment = false
  if (
    deploymentUntil !== undefined &&
    (value.validityUntil === undefined || deploymentUntil.ms < value.validityUntil.ms)
  ) {
    effectiveUntil = deploymentUntil
    narrowedByDeployment = true
  }
  if (effectiveUntil !== undefined && effectiveUntil.ms <= value.validityFrom.ms) {
    return rejectedPrecondition(
      'projection-validity-empty',
      `生效窗交集为空：until(${effectiveUntil.text}) 不晚于 from(${value.validityFrom.text})`,
    )
  }

  const built = buildSegments(value, toolRefs, effectiveUntil, narrowedByDeployment)
  const authorityRefs = normalizeRefs(value.grantRefs)
  const validity: PolicyProjection['validity'] =
    effectiveUntil === undefined
      ? { from: value.validityFrom.text }
      : { from: value.validityFrom.text, until: effectiveUntil.text }

  const digest = digestBody({
    segments: built.segments,
    unsupportedSegments: built.unsupportedSegments,
    authorityRefs,
    validity,
  })
  if (digest.kind === 'err') return digest

  const projection: PolicyProjection = {
    segments: built.segments,
    unsupportedSegments: built.unsupportedSegments,
    digest: digest.value,
    authorityRefs,
    validity,
  }
  return { kind: 'ok', value: deepFreeze(projection) }
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、复算与门禁（NEG-RUN-01 生成期前腿；不替代启动器侧校验）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 复算 digest（PRM-G7）：对投影体（除 digest 自身）重算 `sha256:<hex>`。
 * 供启动器/校验器核对「摘要不符」；纯函数、零 IO。
 */
export function projectionDigest(projection: PolicyProjection): PortResult<string> {
  return digestBody({
    segments: projection.segments,
    unsupportedSegments: projection.unsupportedSegments,
    authorityRefs: projection.authorityRefs,
    validity: projection.validity,
  })
}

/**
 * 生成期门禁（保守口径）：四个策略面（`GATING_SEGMENTS`）任一未承载即不可启动。
 * **不是**启动授权：摘要核对、有效期判定（显式 `atMs`）、引用可解析与签名通道
 * （SEC-SIG-04 未建）由启动器另判；本函数只回答「清单本身是否缺策略面」。
 */
export function projectionGate(projection: PolicyProjection): ProjectionGateResult {
  const blockingSegments = GATING_SEGMENTS.filter(
    (segment) => projection.segments[segment].enabled !== true,
  )
  return { launchable: blockingSegments.length === 0, blockingSegments }
}
