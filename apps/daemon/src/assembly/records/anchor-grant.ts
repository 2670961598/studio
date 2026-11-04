/**
 * assembly/records/anchor-grant —— 外部锚章程 → RootGrantFact（studio-dev-773）
 *
 * 依据：docs/v2/11 §2.2「离线批准模式（offline-approval）」；docs/v2/03 §3.1（根与设立记录）；
 * docs/v2/15 §7.3（SEC-ROOT-02：无有效 root_delegation 不得签发）；docs/17-§2（外部事实唯一注入口）。
 *
 * 读面（只读公司目录，不写）：`<companyDir>/anchors/`：
 *   - `外部锚章程-v<N>.md`（外部根授予事实载体；选最高 N）；
 *   - `外部锚章程-v<N>.md.sha256`（章程内容哈希旁车：`<hex>  <file>`）；
 *   - `operating-root-key.pub`（已登记 operating root key 公钥；私钥离线保管、不入库）；
 *   - `operating-root-key.pub.sha256`（公钥内容哈希旁车；`fingerprint_matches` 的真实核对基）。
 *
 * fail-closed（缺任一项→不构造 fact、明报原因，不猜不伪造）：
 *   目录/章程/旁车缺、哈希不符、授权留档缺失、签署/期限解析失败、期限未生效/已过期、公钥缺/哈希不符。
 * 诚实边界（docs/v2/11 §2.2）：`proof_verified=true`=离线批准件核验通过；`fingerprint_matches=true`=
 * 登记公钥哈希与旁车一致；**均非密码学签名验签**；fact.proofBasis='offline-approval' 由记录
 * proofBoundary/日志显式标注；真签名/验签归 721。
 *
 * 注入：runServe 在 buildServeRuntime 前调用本件，把 fact 传 `recordsRootGrant`；缺省不注入＝
 * 无锚（707 declared/undeclared 态照旧）。本件不写台账/不写公司目录/不重启 daemon。
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { RootGrantFact } from '../../engine/records/index.ts'

/** 锚目录名（公司目录下；docs/v2/11 §2.2 外部批准件落点） */
export const ANCHORS_DIR_NAME = 'anchors'
/** 章程文件名前缀（版本号取后缀 v<N>） */
const CHARTER_PREFIX = '外部锚章程-'
/** 已登记 operating root key 公钥（OpenSSH 公开件；私钥另处离线保管） */
export const OPERATING_KEY_PUB_FILE = 'root-operating-key.pub'
/** 公钥登记说明（含期望 sha256 与 SSH 指纹；真实核对基） */
export const OPERATING_KEY_DOC_FILE = 'root-operating-key.md'
/** 授权留档文件前缀（逐字授权原文；与章程文件哈希共同构成 offline_approval_ref） */
export const AUTHORIZATION_FILE_PREFIX = 'authorization-'

export interface AnchorRootGrantResult {
  readonly ok: boolean
  readonly fact?: RootGrantFact
  /** 失败/装载原因（可日志直读；不含秘密值） */
  readonly reason?: string
  readonly charterFile?: string
  readonly keyFingerprint?: string
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 读旁车：首行 `<hex>  <file>`；返回 hex（不存在的文件由调用方先判） */
function readSidecar(file: string): string | undefined {
  try {
    const first = readFileSync(file, 'utf8').split('\n')[0]?.trim() ?? ''
    const m = /^([0-9a-f]{64})\b/i.exec(first)
    return m !== null ? m[1] : undefined
  } catch {
    return undefined
  }
}

function parseIsoDate(text: string, label: string): string | undefined {
  const value = text.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const parts = value.split('-').map(Number)
  const y = parts[0] ?? Number.NaN
  const mo = parts[1] ?? Number.NaN
  const d = parts[2] ?? Number.NaN
  const ms = Date.UTC(y, mo - 1, d)
  const check = new Date(ms)
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new Error(`${label} 不是真日历日：${value}`)
  }
  return value
}

/** 章程文本最小解析（版本、生效/到期、授权保留档、签署标记）；缺项抛错→调用方 fail-closed */
function parseCharter(text: string): { from: string; to: string } {
  const fromMatch = /生效日期[：:]\s*\*{0,2}(\d{4}-\d{2}-\d{2})/.exec(text)
  const toMatch = /至\s*(\d{4}-\d{2}-\d{2})/.exec(text)
  if (fromMatch === null) throw new Error('章程缺「生效日期：YYYY-MM-DD」')
  if (toMatch === null) throw new Error('章程缺期限「至 YYYY-MM-DD」')
  if (!/授权依据/.test(text)) throw new Error('章程缺「授权依据」（离线批准授权留档）')
  if (!/签署日期[：:]/.test(text)) throw new Error('章程缺「签署日期」')
  const from = parseIsoDate(fromMatch[1] as string, '生效日期')
  const to = parseIsoDate(toMatch[1] as string, '期限至')
  if (from === undefined || to === undefined) throw new Error('章程日期解析失败')
  if (Date.parse(`${from}T00:00:00.000Z`) > Date.parse(`${to}T00:00:00.000Z`)) {
    throw new Error(`章程期限倒置（from=${from} > to=${to}）`)
  }
  return { from, to }
}

/** 选最高版本章程（`外部锚章程-v<N>.md`；N 数字比较） */
function pickLatestCharter(dir: string): { file: string; version: number } | undefined {
  let best: { file: string; version: number } | undefined
  for (const name of readdirSync(dir)) {
    const m = /^外部锚章程-v(\d+)\.md$/.exec(name)
    if (m === null) continue
    const version = Number(m[1])
    if (best === undefined || version > best.version) best = { file: name, version }
  }
  return best
}

/**
 * 注入决策（部署顺序安全）：daemon.yaml 仍声明「无锚」时**不得注入**外部锚事实——否则
 * records 会先写 REC-AUTH-01，随后 707 状态机发现「声明+已落 AUTH-01」冲突 → CONFIG_INVALID
 * 拒启（部署窗口自锁）。声明在场＝先保持 declared；移除三键后重启才注入并转 anchored。
 */
export function anchorGrantForInjection(args: {
  readonly fact?: RootGrantFact
  readonly declarationPresent: boolean
}): { readonly fact?: RootGrantFact; readonly skippedReason?: string } {
  if (args.fact === undefined) return {}
  if (args.declarationPresent) {
    return {
      skippedReason:
        'daemon.yaml 仍声明无锚（recordRootGrantAbsence*）——外部锚事实不注入（避免声明+已落 REC-AUTH-01 冲突；移除声明三键并重启后转 anchored）',
    }
  }
  return { fact: args.fact }
}

/** OpenSSH 公钥行 → SSH SHA256 指纹（SHA256:base64(sha256(wire blob))，去 padding；真实核对用） */
export function sshFingerprintOfOpenSshPub(text: string): string | undefined {
  const line = text.split('\n').find((row) => row.startsWith('ssh-ed25519 '))
  if (line === undefined) return undefined
  const b64 = line.trim().split(/\s+/)[1]
  if (b64 === undefined || b64 === '') return undefined
  let blob: Buffer
  try {
    blob = Buffer.from(b64, 'base64')
  } catch {
    return undefined
  }
  if (blob.length === 0) return undefined
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`
}

/** 选最新授权留档（`authorization-*.md`；ISO 名倒序） */
function pickLatestAuthorization(dir: string): string | undefined {
  const names = readdirSync(dir)
    .filter((name) => name.startsWith(AUTHORIZATION_FILE_PREFIX) && name.endsWith('.md'))
    .sort()
  return names.at(-1)
}

/**
 * 从公司目录 anchors 读外部锚 → RootGrantFact（offline-approval 形态）。
 * companyDir 缺省（demo/测试无公司面）=ok:false（无外部锚面，调用方按无锚处理，不是错误）。
 */
export function loadRootGrantFromAnchors(args: {
  readonly companyDir?: string
  readonly now?: () => number
  readonly log?: (line: string) => void
}): AnchorRootGrantResult {
  const log = args.log ?? ((): void => {})
  if (args.companyDir === undefined) {
    return { ok: false, reason: '无 companyDir（demo/无公司面）——不装载外部锚' }
  }
  const anchorsDir = path.resolve(args.companyDir, ANCHORS_DIR_NAME)
  if (!existsSync(anchorsDir)) {
    const reason = `外部锚目录不存在（${anchorsDir}）——不写 REC-AUTH-01（fail-closed）`
    log(`[records][anchor-grant] ${reason}`)
    return { ok: false, reason }
  }
  try {
    const charter = pickLatestCharter(anchorsDir)
    if (charter === undefined) throw new Error(`锚目录无「${CHARTER_PREFIX}v<N>.md」章程（fail-closed）`)
    const charterPath = path.join(anchorsDir, charter.file)
    const sidecarPath = `${charterPath}.sha256`
    if (!existsSync(sidecarPath)) throw new Error(`章程缺哈希旁车（${path.basename(sidecarPath)}）——fail-closed`)
    const expected = readSidecar(sidecarPath)
    if (expected === undefined) throw new Error(`章程旁车不可解析（${path.basename(sidecarPath)}）`)
    const charterBuf = readFileSync(charterPath)
    const actual = sha256Hex(charterBuf)
    if (actual !== expected.toLowerCase()) {
      throw new Error(`章程哈希不符（旁车=${expected.slice(0, 12)}… 实际=${actual.slice(0, 12)}…）——拒绝外部事实（fail-closed）`)
    }
    const { from, to } = parseCharter(charterBuf.toString('utf8'))
    const now = args.now?.() ?? Date.now()
    const fromMs = Date.parse(`${from}T00:00:00.000Z`)
    const toMs = Date.parse(`${to}T23:59:59.999Z`)
    if (now < fromMs) throw new Error(`章程尚未生效（from=${from}；当前早于生效日）——fail-closed`)
    if (now > toMs) throw new Error(`章程已过期（to=${to}；未续签不得继续作为根授予事实）——fail-closed`)

    // 已登记 operating root key 公钥（真钥，不是章程哈希冒充）：OpenSSH 公钥 + 登记说明里的
    // 期望 sha256/SSH 指纹做**真实核对**；授权留档文件交叉引用章程/公钥哈希。
    const pubPath = path.join(anchorsDir, OPERATING_KEY_PUB_FILE)
    if (!existsSync(pubPath)) {
      throw new Error(`缺已登记 operating root key 公钥（${OPERATING_KEY_PUB_FILE}）——不得写根授予（不造假 key/不拿章程哈希冒充；fail-closed）`)
    }
    const keyDocPath = path.join(anchorsDir, OPERATING_KEY_DOC_FILE)
    if (!existsSync(keyDocPath)) throw new Error(`缺公钥登记说明（${OPERATING_KEY_DOC_FILE}）——指纹/哈希无登记基准（fail-closed）`)
    const pubBuf = readFileSync(pubPath)
    const pubSha256 = sha256Hex(pubBuf)
    const keyDoc = readFileSync(keyDocPath, 'utf8')
    const expectedPubSha = /公钥文件 sha256[：:]\s*`?([0-9a-f]{64})`?/i.exec(keyDoc)?.[1]
    if (expectedPubSha === undefined) throw new Error('公钥登记说明缺「公钥文件 sha256」（fail-closed）')
    if (expectedPubSha.toLowerCase() !== pubSha256) {
      throw new Error(`公钥文件哈希与登记说明不符（登记=${expectedPubSha.slice(0, 12)}… 实际=${pubSha256.slice(0, 12)}…）——fingerprint_matches=false（fail-closed）`)
    }
    const expectedSshFp = /SSH 指纹[：:]\s*`?(SHA256:[A-Za-z0-9+/=]+)`?/i.exec(keyDoc)?.[1]
    if (expectedSshFp === undefined) throw new Error('公钥登记说明缺「SSH 指纹」（fail-closed）')
    const computedSshFp = sshFingerprintOfOpenSshPub(pubBuf.toString('utf8'))
    if (computedSshFp === undefined) throw new Error('公钥不是可解析的 OpenSSH ed25519 公钥（fail-closed）')
    if (computedSshFp !== expectedSshFp) {
      throw new Error(`公钥 SSH 指纹与登记说明不符（登记=${expectedSshFp} 计算=${computedSshFp}）——fingerprint_matches=false（fail-closed）`)
    }

    // 授权留档（逐字原文；交叉引用章程/公钥哈希——三者一致才作为离线批准件）
    const authFile = pickLatestAuthorization(anchorsDir)
    if (authFile === undefined) throw new Error('缺授权留档（authorization-*.md）——offline_approval_ref 无依据（fail-closed）')
    const authBuf = readFileSync(path.join(anchorsDir, authFile))
    const authSha256 = sha256Hex(authBuf)
    const authText = authBuf.toString('utf8')
    if (!authText.includes(actual)) throw new Error('授权留档未引用章程文件哈希（不一致；fail-closed）')
    if (!authText.includes(pubSha256)) throw new Error('授权留档未引用登记公钥 sha256（不一致；fail-closed）')
    if (!authText.includes(expectedSshFp)) throw new Error('授权留档未引用登记 SSH 指纹（不一致；fail-closed）')
    // offline_approval_ref = sha256(章程文件哈希 + 授权记录文件哈希)（Lead 指定口径；第三方可复算）
    const offlineCommitment = sha256Hex(`${actual}:${authSha256}`)
    const keyFingerprint = expectedSshFp // 契约 key_fingerprint 接受「指纹或公钥标识」；SSH 指纹即 operating key 公开标识
    const fact: RootGrantFact = {
      establishmentRef: {
        // REC-LIFE-07＝公司设立记录（contract fixtures 同口径：parent_grant 引用设立记录，refType 须为登记记录类型）
        refType: 'REC-LIFE-07',
        refId: `company:anchors/${charter.file}`,
        refVersion: '1.0.0',
      },
      keyFingerprint,
      offlineApprovalRef: {
        // ObjectRef（无 refType；refVersion 须 semver）——组合承诺写入 refId，可被第三方复算
        refId: `company:anchors/${authFile}#offline-approval:sha256:${offlineCommitment}`,
        refVersion: '1.0.0',
      },
      term: { from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` },
      proofVerified: true,
      fingerprintMatches: true,
      proofBasis: 'offline-approval',
    }
    const line =
      `[records][anchor-grant] 外部锚已装载：${charter.file}（sha256:${actual.slice(0, 12)}…）＋授权留档 ${authFile}（sha256:${authSha256.slice(0, 12)}…）＋登记公钥 ${keyFingerprint}；` +
      `term=${from}..${to}；形态=offline-approval（离线批准件核验＋登记公钥哈希一致；非密码学签名验签；真钥验签归 721）`
    log(line)
    return { ok: true, fact, reason: line, charterFile: charter.file, keyFingerprint }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    log(`[records][anchor-grant] 外部锚未装载（不写 REC-AUTH-01，fail-closed）：${reason}`)
    return { ok: false, reason }
  }
}
