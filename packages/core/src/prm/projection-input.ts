/**
 * prm/projection-input —— 生成器输入面（契约 ProjectionInput ＋ 可选部署面）与规范化校验
 *
 * 依据与语义边界见 `./compile-projection.ts` 头注。要点：
 *   - `deployment` 是 v2/14 §六「部署收紧面」在 core 侧的可选承载（契约未含该字段；
 *     只增不改契约包，缺口登记本单）；
 *   - 逐字段只能收紧或声明，不能放大；未知键拒绝（不猜不填）；
 *   - 缺字段/未定版引用/非法瞬时 → 拒绝生成（PRM-G6），**不补默认值**。
 *
 * 零 IO：不 import Node 内建模块/文件/网络/时钟。
 */
import type { PortResult, ProjectionInput, ProjectionSegment } from '@studio-next/contract'
import type { InstantValue, RawRecord } from './spec.ts'
import {
  PROJECTION_SEGMENTS,
  SANDBOX_MODES,
  asRecord,
  readInstant,
  readRef,
  readRefList,
  rejectedPrecondition,
} from './spec.ts'

/** 沙箱段声明（写域模式与根；缺声明＝该段不可支持，不填缺省） */
export interface ProjectionSandboxDeclaration {
  readonly mode: 'read-only' | 'workspace-write'
  readonly rootRef: string
}

/**
 * 部署收紧面（v2/14 §六 的「部署收紧面」在 core 侧的承载）。
 *
 * `carriedSegments`：本部署/宿主**实际承载**的段（缺省＝无承载，按不支持处理）。只能逐段
 * 声明、不能由宿主名推出；未列出的策略面一律进 `unsupportedSegments[]`。
 * `allowedCapabilityRefs`：部署允许的能力声明引用（∩ `capabilityRefs`；只能收窄）。
 * `validityUntil`：部署生效窗上界（与输入窗取更早者；只能收窄）。
 * `sandbox`/`approvalTemplateRef`/`evidenceSinkRef`：各段显式来源声明（缺＝该段不可支持）。
 * `personaRefs`：人设引用（恒 soft；缺省＝该段不出现、不计损失）。
 */
export interface ProjectionDeployment {
  readonly carriedSegments?: readonly ProjectionSegment[]
  readonly allowedCapabilityRefs?: readonly string[]
  readonly validityUntil?: string
  readonly sandbox?: ProjectionSandboxDeclaration
  readonly approvalTemplateRef?: string
  readonly evidenceSinkRef?: string
  readonly personaRefs?: readonly string[]
}

/** 生成器完整输入：冻结的 `ProjectionInput` ＋ 可选部署面（纯 ProjectionInput 可直传） */
export interface CompileProjectionInput extends ProjectionInput {
  readonly deployment?: ProjectionDeployment
}

export interface NormalizedDeployment {
  readonly carriedSegments: ReadonlySet<ProjectionSegment>
  readonly allowedCapabilityRefs: readonly string[] | undefined
  readonly validityUntil: InstantValue | undefined
  readonly sandbox: ProjectionSandboxDeclaration | undefined
  readonly approvalTemplateRef: string | undefined
  readonly evidenceSinkRef: string | undefined
  readonly personaRefs: readonly string[]
}

export interface NormalizedInput {
  readonly companyId: string
  readonly workRef: string
  readonly planRef: string
  readonly grantRefs: readonly string[]
  readonly capabilityRefs: readonly string[]
  readonly secretTypes: readonly string[]
  readonly hostKind: string
  readonly hostVersion: string
  readonly hostBindingRef: string
  readonly validityFrom: InstantValue
  readonly validityUntil: InstantValue | undefined
  readonly deployment: NormalizedDeployment
}

const DEPLOYMENT_KEYS: ReadonlySet<string> = new Set([
  'carriedSegments',
  'allowedCapabilityRefs',
  'validityUntil',
  'sandbox',
  'approvalTemplateRef',
  'evidenceSinkRef',
  'personaRefs',
])
const SANDBOX_KEYS: ReadonlySet<string> = new Set(['mode', 'rootRef'])

function emptyDeployment(): NormalizedDeployment {
  return {
    carriedSegments: new Set<ProjectionSegment>(),
    allowedCapabilityRefs: undefined,
    validityUntil: undefined,
    sandbox: undefined,
    approvalTemplateRef: undefined,
    evidenceSinkRef: undefined,
    personaRefs: [],
  }
}

export function normalizeDeployment(raw: unknown, issues: string[]): NormalizedDeployment {
  const record = asRecord(raw)
  if (record === undefined) {
    if (raw !== undefined) issues.push('deployment 必须是对象')
    return emptyDeployment()
  }

  for (const key of Object.keys(record)) {
    if (!DEPLOYMENT_KEYS.has(key)) issues.push(`deployment.${key} 不是受支持的收紧字段（未知键拒绝）`)
  }

  let carriedSegments = new Set<ProjectionSegment>()
  const carriedRaw = record['carriedSegments']
  if (carriedRaw !== undefined) {
    if (!Array.isArray(carriedRaw)) {
      issues.push('deployment.carriedSegments 必须是段名数组')
    } else {
      const declared: ProjectionSegment[] = []
      for (const item of carriedRaw) {
        if (typeof item !== 'string' || !PROJECTION_SEGMENTS.includes(item as ProjectionSegment)) {
          issues.push(`deployment.carriedSegments 含未知段：${String(item)}`)
          continue
        }
        declared.push(item as ProjectionSegment)
      }
      carriedSegments = new Set(declared)
    }
  }

  const allowedCapabilityRefs = readRefList(record['allowedCapabilityRefs'])
  if (record['allowedCapabilityRefs'] !== undefined && allowedCapabilityRefs === undefined) {
    issues.push('deployment.allowedCapabilityRefs 必须是受控引用数组')
  }

  let deploymentValidityUntil: InstantValue | undefined
  if (record['validityUntil'] !== undefined) {
    deploymentValidityUntil = readInstant(record['validityUntil'])
    if (deploymentValidityUntil === undefined) {
      issues.push('deployment.validityUntil 必须是 UTC 瞬时（YYYY-MM-DDTHH:mm:ss[.sss]Z）')
    }
  }

  let sandbox: ProjectionSandboxDeclaration | undefined
  const sandboxRaw = record['sandbox']
  if (sandboxRaw !== undefined) {
    const sandboxRecord = asRecord(sandboxRaw)
    if (sandboxRecord === undefined) {
      issues.push('deployment.sandbox 必须是对象')
    } else {
      for (const key of Object.keys(sandboxRecord)) {
        if (!SANDBOX_KEYS.has(key)) issues.push(`deployment.sandbox.${key} 不是受支持字段（未知键拒绝）`)
      }
      const mode = sandboxRecord['mode']
      const rootRef = readRef(sandboxRecord['rootRef'])
      if (typeof mode !== 'string' || !SANDBOX_MODES.has(mode)) {
        issues.push('deployment.sandbox.mode 必须是 read-only｜workspace-write')
      }
      if (rootRef === undefined) issues.push('deployment.sandbox.rootRef 必须是受控引用')
      if (typeof mode === 'string' && SANDBOX_MODES.has(mode) && rootRef !== undefined) {
        sandbox = { mode: mode as ProjectionSandboxDeclaration['mode'], rootRef }
      }
    }
  }

  let approvalTemplateRef: string | undefined
  if (record['approvalTemplateRef'] !== undefined) {
    approvalTemplateRef = readRef(record['approvalTemplateRef'])
    if (approvalTemplateRef === undefined) issues.push('deployment.approvalTemplateRef 必须是受控引用')
  }

  let evidenceSinkRef: string | undefined
  if (record['evidenceSinkRef'] !== undefined) {
    evidenceSinkRef = readRef(record['evidenceSinkRef'])
    if (evidenceSinkRef === undefined) {
      issues.push('deployment.evidenceSinkRef 必须是受控引用（sink 必须外部）')
    }
  }

  let personaRefs: readonly string[] = []
  const personaRaw = record['personaRefs']
  if (personaRaw !== undefined) {
    const parsed = readRefList(personaRaw)
    if (parsed === undefined) issues.push('deployment.personaRefs 必须是受控引用数组')
    else personaRefs = parsed
  }

  return {
    carriedSegments,
    allowedCapabilityRefs,
    validityUntil: deploymentValidityUntil,
    sandbox,
    approvalTemplateRef,
    evidenceSinkRef,
    personaRefs,
  }
}

export function normalizeInput(raw: unknown): PortResult<NormalizedInput> {
  const record: RawRecord | undefined = asRecord(raw)
  if (record === undefined) return rejectedPrecondition('projection-input-incomplete', '输入必须是对象')

  const issues: string[] = []

  const companyId = readRef(record['companyId']) ?? ''
  if (companyId === '') issues.push('companyId 缺失或不是受控引用')

  const workRef = readRef(record['workRef']) ?? ''
  if (workRef === '') issues.push('workRef 缺失或不是受控引用')

  const planRef = readRef(record['planRef']) ?? ''
  if (planRef === '') issues.push('planRef 缺失或不是受控引用')

  const grantRefs = readRefList(record['grantRefs'])
  if (grantRefs === undefined) issues.push('grantRefs 必须是受控引用数组')
  else if (grantRefs.length === 0) issues.push('grantRefs 为空：authority 段无来源，按「不猜不填」拒绝生成')

  const capabilityRefs = readRefList(record['capabilityRefs'])
  if (capabilityRefs === undefined) issues.push('capabilityRefs 必须是受控引用数组（可为空集＝无工具）')

  const secretTypes = readRefList(record['secretTypes'])
  if (secretTypes === undefined) issues.push('secretTypes 必须是秘密类别引用数组')

  const hostRecord = asRecord(record['host'])
  const hostKind = hostRecord === undefined ? undefined : readRef(hostRecord['hostKind'])
  const hostVersion = hostRecord === undefined ? undefined : readRef(hostRecord['version'])
  const hostBindingRef = hostRecord === undefined ? undefined : readRef(hostRecord['bindingRef'])
  if (hostRecord === undefined) issues.push('host 缺失')
  else if (hostKind === undefined || hostVersion === undefined || hostBindingRef === undefined) {
    issues.push('host 的 hostKind/version/bindingRef 必须是受控引用')
  }

  const validityFrom = readInstant(record['validityFrom'])
  if (validityFrom === undefined) {
    issues.push('validityFrom 必须是 UTC 瞬时（YYYY-MM-DDTHH:mm:ss[.sss]Z）')
  }
  let validityUntil: InstantValue | undefined
  if (record['validityUntil'] !== undefined) {
    validityUntil = readInstant(record['validityUntil'])
    if (validityUntil === undefined) issues.push('validityUntil 必须是 UTC 瞬时（YYYY-MM-DDTHH:mm:ss[.sss]Z）')
  }

  const deploymentRaw: unknown = 'deployment' in record ? record['deployment'] : undefined
  const deployment = normalizeDeployment(deploymentRaw, issues)

  if (issues.length > 0) {
    return rejectedPrecondition('projection-input-incomplete', issues.join('；'))
  }
  if (
    validityFrom === undefined ||
    hostKind === undefined ||
    hostVersion === undefined ||
    hostBindingRef === undefined
  ) {
    return rejectedPrecondition('projection-input-incomplete', '必填输入在规范化后仍缺失')
  }
  if (validityUntil !== undefined && validityUntil.ms <= validityFrom.ms) {
    return rejectedPrecondition(
      'projection-validity-empty',
      `输入生效窗为空：validityUntil(${validityUntil.text}) 不晚于 validityFrom(${validityFrom.text})`,
    )
  }

  return {
    kind: 'ok',
    value: {
      companyId,
      workRef,
      planRef,
      grantRefs: grantRefs ?? [],
      capabilityRefs: capabilityRefs ?? [],
      secretTypes: secretTypes ?? [],
      hostKind,
      hostVersion,
      hostBindingRef,
      validityFrom,
      validityUntil,
      deployment,
    },
  }
}
