/**
 * assembly/api/auth —— 触发面认证器（fail-closed；无凭据/未实现档一律拒）
 *
 * 依据（实现单引用）：
 *   - docs/v2/14 §四（凭证三档：公开/伙伴/签名；触发面公共入参；「单静态 token＝禁止形态」；
 *     凭据分级另轴 root/scoped——root 只由最高宰相持有、**不进任何接口载荷/回执/日志**）；
 *   - docs/v2/15 §七 SEC-ROOT-01..05（root 不入接口面；接口层不得以「持 root」代替授权链
 *     核验）、§一 SEC-FC-01/07（fail-closed：不静默匿名放行；非测试装配只收 gated 形态）；
 *   - docs/v2/16 §三 api 行 / plan/05 IMPL-06-06（认证器由装配侧实现；api 包只收认证结果）。
 *
 * 现状（如实，不冒充）：
 *   - **凭据目录已接**（studio-dev-544 / rework studio-dev-624）：装配注入 `TrustPort`（PORT-TRUST
 *     生产实现，`packages/gateway/src/trust.ts`）时，partner（Bearer 逻辑引用）按目录条目核验
 *     scope/用途/TTL/吊销——越权/缺证/过期/已撤一律拒；**未注入**时保持旧口径
 *     `partner-credential-unwired`（不可核验＝拒，不回落匿名）。
 *   - signed（HMAC＋时间戳＋nonce）验签仍未实现——一律拒绝，缺口以 401 可判定 subcause 外露；
 *   - root 档：凭据类别自报 `root`（头 `x-studio-credential-class`）或 `Authorization: Root …`
 *     一律 **403** 拒（子因 `root-credential-forbidden`）——root key 不入接口面；
 *   - 缺凭据＝401 `credential-missing`；凭据形态坏/方案未知＝401 可判定子因；
 *   - **永不返回 `ok:true`**：本件函数体里没有任何「放行分支」——未来接凭据目录时，
 *     只在核验通过分支增补结果，缺口面继续 fail-closed（结构上不留匿名兜底）。
 *
 * 边界：本件不读库、不读平台、不存秘密值表；只读请求头做分类（头值不回显、不进日志）。
 */
import type { ApiAuthInput, ApiIntakeAuthResult, ApiIntakeAuthenticator } from '@studio-next/api'
import type { CallerRef, CompanyRef, ReadContext, SecretType, TrustPort } from '@studio-next/contract'

/** 凭据类别自报头（root 声明的唯一接口面入口；值不落日志/回执） */
export const CREDENTIAL_CLASS_HEADER = 'x-studio-credential-class'

/** 签名档三头（API-15/签名档的存在性判定：出现即按「未实现签名核验」拒） */
export const SIGNATURE_HEADERS = ['x-studio-signature', 'x-studio-timestamp', 'x-studio-nonce'] as const

/** 认证器装配入参（log 只记可判定子因，不记头值/凭据） */
export interface ApiIntakeAuthOptions {
  /** 拒绝审计出口（缺省 no-op；**不得**写凭据值，只写 subcause） */
  readonly log?: (line: string) => void
  /** 凭据目录（PORT-TRUST 生产实现；缺省＝伙伴档不可核验＝拒——不回落匿名） */
  readonly trust?: TrustPort
  /** 入口公司维（目录核验的读上下文；缺省＝不核验＝拒） */
  readonly company?: CompanyRef
  /** 入口用途（写进 ReadScope.purpose；须在该凭据 allowedUses 内——缺省 trigger-intake） */
  readonly intakePurpose?: string
  /**
   * 入口凭据的五型类别（SEC-T1..T5；须与该目录条目的 `secretType` 一致）。
   * 缺省 `platform_credential`（SEC-T1）；外部伙伴出站凭据（SEC-T5）等部署形态显式覆盖，
   * 不以「猜条目类型」放行（类别不符仍拒）。
   */
  readonly intakeSecretType?: SecretType
}

/** 拒绝分类（全部 fail-closed；状态码三档之内：401 未认证／403 已识别但禁止） */
function reject(
  status: 401 | 403,
  subcause: string,
  detail: string,
  log?: (line: string) => void,
): ApiIntakeAuthResult {
  log?.(`[api] 触发面认证拒绝：status=${String(status)} subcause=${subcause}（凭据值不入日志）`)
  return { ok: false, status, subcause, detail }
}

/** partner 档目录核验（fail-closed：未知/越权/过期/已撤一律拒；凭据值不入日志） */
function verifyPartner(
  credentialRef: string,
  trust: TrustPort,
  company: CompanyRef,
  purpose: string,
  secretType: SecretType,
  log?: (line: string) => void,
): ApiIntakeAuthResult {
  const caller: CallerRef = { callerId: 'gateway/api-intake', kind: 'program', programRef: 'assembly/api/auth' }
  const readContext: ReadContext = {
    readScope: {
      company,
      fields: ['credential_reference', 'scope', 'valid_window', 'revocation_state'],
      purpose,
    },
    caller,
  }
  const verified = trust.verifySource({ handleId: credentialRef, tokenKind: secretType }, readContext)
  if (verified.kind === 'err') {
    const status = verified.error.category === 'rejected_forbidden' || verified.error.category === 'rejected_authority' ? 403 : 401
    return reject(status, verified.error.subcause, verified.error.detail ?? '凭据目录核验未通过（fail-closed，不回落匿名）', log)
  }
  return {
    ok: true,
    auth: { tier: 'partner', credentialRef },
    caller: verified.value,
    credentialClass: 'scoped',
  }
}

/**
 * 触发面认证器工厂（`createApiApp` 的 `auth` 槽）。
 *
 * 凭据三档落位（v2/14 §四）：
 *   1. 无 `authorization` 且无签名头 → 401 `credential-missing`（匿名不放行）；
 *   2. `x-studio-credential-class: root` 或 `Authorization: Root …` → 403
 *      `root-credential-forbidden`（SEC-ROOT-01：root 不进接口面）；
 *   3. `Authorization: Bearer …`（伙伴档）→ 401 `partner-credential-unwired`
 *      （凭据目录未装配：不可核验＝拒，不是「默认伙伴」）；
 *   4. 签名三头同现/部分出现（签名档）→ 401 `signed-intake-unwired`（HMAC/时间戳/nonce
 *      验签未实现）；其余方案 → 401 `credential-scheme-unsupported`。
 *
 * 返回值恒为 `ok:false`（fail-closed）。`ApiIntakeAuthResult` 的 `credentialClass` 字段
 * 在本实现里恒不出现——root 在分类阶段已被拒，不存在「带 root 类别的成功结果」。
 */
export function buildApiIntakeAuth(options: ApiIntakeAuthOptions = {}): ApiIntakeAuthenticator {
  const log = options.log
  return (input: ApiAuthInput): ApiIntakeAuthResult => {
    const declaredClass = input.headers.get(CREDENTIAL_CLASS_HEADER)?.trim().toLowerCase()
    if (declaredClass === 'root') {
      return reject(
        403,
        'root-credential-forbidden',
        'operating root key 只由最高宰相持有，不进任何接口载荷/回执/日志（SEC-ROOT-01）——接口面一律拒 root',
        log,
      )
    }
    if (declaredClass !== undefined && declaredClass !== '' && declaredClass !== 'scoped') {
      return reject(401, 'credential-class-unknown', `凭据类别只收 scoped（root 另档拒）；实得类别不可判`, log)
    }

    const signedHeaders = SIGNATURE_HEADERS.filter((name) => {
      const value = input.headers.get(name)
      return value !== null && value.trim() !== ''
    })
    const authorization = input.headers.get('authorization')?.trim()

    if (authorization === undefined || authorization === '') {
      if (signedHeaders.length > 0) {
        return reject(
          401,
          'signed-intake-unwired',
          '签名档（HMAC＋时间戳＋nonce＋重放窗）验签未实现——不可核验＝拒（fail-closed，不匿名放行）',
          log,
        )
      }
      return reject(
        401,
        'credential-missing',
        '触发面必须 partner/signed 凭据（凭证三档之伙伴/签名；public 档不在落单类型内）——缺凭据拒绝，不静默匿名放行',
        log,
      )
    }

    const [schemeRaw, ...rest] = authorization.split(/\s+/)
    const scheme = (schemeRaw ?? '').toLowerCase()
    const credentialRef = rest.join(' ').trim()

    if (scheme === 'root') {
      return reject(
        403,
        'root-credential-forbidden',
        'root 凭据不得进接口面（SEC-ROOT-01）：scoped key 才可经凭据目录核验',
        log,
      )
    }
    if (scheme === 'bearer') {
      if (credentialRef === '') {
        return reject(401, 'credential-malformed', 'Bearer 后缺凭据引用（空引用不可核验）', log)
      }
      if (options.trust === undefined) {
        return reject(
          401,
          'partner-credential-unwired',
          '凭据目录（PORT-TRUST/REC-AUTH-04 逻辑引用）未装配——伙伴档不可核验＝拒；接入后按条目 scope/TTL/吊销核验（不回落匿名）',
          log,
        )
      }
      if (options.company === undefined) {
        return reject(401, 'partner-credential-context-missing', '凭据目录已装配但入口公司维缺失——读上下文不完整＝拒（不猜公司）', log)
      }
      return verifyPartner(
        credentialRef,
        options.trust,
        options.company,
        options.intakePurpose ?? 'trigger-intake',
        options.intakeSecretType ?? 'platform_credential',
        log,
      )
    }
    if (scheme === 'signature' || scheme === 'hmac') {
      return reject(
        401,
        'signed-intake-unwired',
        '签名档验签（HMAC/时间戳/nonce/重放窗）未实现——不可核验＝拒',
        log,
      )
    }
    return reject(401, 'credential-scheme-unsupported', `凭据方案只收 Bearer 或签名档；实得方案不可判`, log)
  }
}
