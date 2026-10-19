/**
 * trust —— 制作人侧信任锚（DEV-27 正式化；docs/44 §二 条款2/4 设计的正式落法）
 *
 * 来源：spike/spec-v1 分支 cbae8c2（docs/44 双轮 1490/1490 验证过的实现）→
 * v1.1 spike 原型（docs/44-§v1.1 机制一验证面，18 用例）→
 * 本文件（DEV-27 主仓正式化）——语义零改动：
 *   - **锚落点**：<公司目录>/.studio-next/trust.json——daemon 自管目录（与 .git 同类，
 *     不是公司包分发件的一部分）。内容指纹与变更监听一律排除 .studio-next/ 下的锚文件
 *     （锚内记录指纹、指纹覆盖锚=自指，机制上必须隔离——docs/44 §四-2 机制发现）。
 *   - **import 落锚 trust:false**：导入的公司目录默认不可信——等制作人显式 approve。
 *   - **approve（制作人显式动作）**：trust→true + 落内容指纹 + 谁/何时留痕（history 追加）。
 *   - **re-approve**：指纹漂移被拦下后的重新批准（重算指纹 + 新 history 条目）。
 *   - **内容指纹算法**：per-file sha256(utf8) hex；总指纹=sorted(`path:hash`) 行串的
 *     sha256（`sha256:` 前缀形）。
 *
 * v1.1 增量（git-url 导入流用——docs/43-§一「升级=同一导入流」+ §十-2 升级四点）：
 *   - **upgrade 再导入**：内容更新后重落锚——trust 回 false（新内容=未批准面，fail-closed），
 *     history 追加新的 import 条目（升级也是一次导入；留痕链不断）。
 *   - **upgrade 落锚入口**：reseedTrustAnchorOnUpgrade（v1 无此形态）。
 *
 * v0 边界（诚实标注，沿 docs/44）：
 *   - 锚文件本体无签名无加密——防「公司包内容漂移」不防「制作人物理改锚文件」（威胁模型外）。
 *   - history 无上限增长——截断策略归后续单。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** 锚目录/文件（相对公司目录根；daemon 自管——分发仓封闭内容集不含它，自带即拒收 docs/43-§十-3） */
export const TRUST_DIR = '.studio-next'
export const TRUST_FILE = '.studio-next/trust.json'

/** 信任锚 schema 版本 */
const TRUST_SCHEMA = 'studio-next/trust@1'

/** 留痕条目（谁/何时/干了什么——「升级受信=显式动作留痕」的落字） */
export interface TrustHistoryEntry {
  action: 'import' | 'approve' | 're-approve' | 'revoke'
  /** 动作人（制作人标识；CLI 传入） */
  by: string
  /** ISO 8601 时刻 */
  at: string
  /** 本条目落锚时的内容指纹（import/approve/re-approve 时有；revoke 沿用旧值） */
  fingerprint?: string
  note?: string
}

/** 信任锚（<公司目录>/.studio-next/trust.json 的形状） */
export interface TrustAnchor {
  schema: 'studio-next/trust@1'
  /** org-config company.slug（错家锚文件不认——docs/43-§十-2「slug 同家」判据） */
  slug: string
  /** 受信位：false=导入未批准（untrusted 渲染）；true=制作人已批准 */
  trust: boolean
  /** 批准时的内容指纹（sha256: 前缀形；null=从未批准） */
  fingerprint: string | null
  history: TrustHistoryEntry[]
}

/** 排除锚目录后的文件映射（指纹与漂移比对只看公司内容——锚文件自指隔离） */
export function excludeAnchorFiles(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [rel, text] of Object.entries(files)) {
    if (rel === TRUST_FILE || rel.startsWith(`${TRUST_DIR}/`)) continue
    out[rel] = text
  }
  return out
}

/**
 * 内容指纹：per-file sha256(hex) → sorted `path:hash` 行串 → sha256（`sha256:` 前缀形）。
 * 与 daemon hot-reload fingerprintDirectory 同规则、独立实现（规则一致由测试互证——docs/44 §二）。
 */
export function contentFingerprint(files: Record<string, string>): string {
  const lines: string[] = []
  for (const rel of Object.keys(files).sort()) {
    lines.push(`${rel}:${createHash('sha256').update(files[rel] ?? '', 'utf8').digest('hex')}`)
  }
  return `sha256:${createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex')}`
}

function anchorPath(companyDir: string): string {
  return path.join(companyDir, TRUST_FILE)
}

/** 读锚（无文件/坏 JSON/形状不符 → null=无锚） */
export function readTrustAnchor(companyDir: string): TrustAnchor | null {
  const target = anchorPath(companyDir)
  if (!existsSync(target)) return null
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as Partial<TrustAnchor>
    if (
      parsed.schema !== TRUST_SCHEMA ||
      typeof parsed.slug !== 'string' ||
      typeof parsed.trust !== 'boolean' ||
      (parsed.fingerprint !== null && typeof parsed.fingerprint !== 'string') ||
      !Array.isArray(parsed.history)
    ) {
      return null
    }
    return {
      schema: TRUST_SCHEMA,
      slug: parsed.slug,
      trust: parsed.trust,
      fingerprint: parsed.fingerprint ?? null,
      history: parsed.history as TrustHistoryEntry[],
    }
  } catch {
    return null
  }
}

/** 写锚（原子写 tmp+rename；目录递归建，0700——锚是制作人侧私产） */
export function writeTrustAnchor(companyDir: string, anchor: TrustAnchor): void {
  mkdirSync(path.join(companyDir, TRUST_DIR), { recursive: true, mode: 0o700 })
  const target = anchorPath(companyDir)
  const tmp = `${target}.tmp-${Date.now()}`
  writeFileSync(tmp, `${JSON.stringify(anchor, null, 2)}\n`, 'utf8')
  renameSync(tmp, target)
}

/**
 * import 落锚：trust=false + 导入内容指纹 + 留痕（导入管线调用——docs/43-§一）。
 * files=排除锚目录后的公司内容文件映射（导入管线内部处理）。
 */
export function seedTrustAnchor(
  companyDir: string,
  slug: string,
  files: Record<string, string>,
  entry: { by: string; at: string; note?: string },
): TrustAnchor {
  const fingerprint = contentFingerprint(excludeAnchorFiles(files))
  const anchor: TrustAnchor = {
    schema: TRUST_SCHEMA,
    slug,
    trust: false,
    fingerprint,
    history: [{ action: 'import', by: entry.by, at: entry.at, fingerprint, ...(entry.note !== undefined ? { note: entry.note } : {}) }],
  }
  writeTrustAnchor(companyDir, anchor)
  return anchor
}

/**
 * upgrade 再导入落锚（v1.1 增量；docs/43-§十-2）：内容已更新 → trust 回 false
 * （新内容=未批准面，fail-closed——同 docs/44 §四-5 的漂移语义）+ 新指纹 + history
 * 追加 import 条目。无前锚（不应是 upgrade 通道，防御）→ 等价 seed。
 */
export function reseedTrustAnchorOnUpgrade(
  companyDir: string,
  slug: string,
  files: Record<string, string>,
  entry: { by: string; at: string; note?: string },
): TrustAnchor {
  const prev = readTrustAnchor(companyDir)
  const fingerprint = contentFingerprint(excludeAnchorFiles(files))
  const anchor: TrustAnchor = {
    schema: TRUST_SCHEMA,
    slug,
    trust: false,
    fingerprint,
    history: [
      ...(prev?.history ?? []),
      { action: 'import', by: entry.by, at: entry.at, fingerprint, ...(entry.note !== undefined ? { note: entry.note } : {}) },
    ],
  }
  writeTrustAnchor(companyDir, anchor)
  return anchor
}

/**
 * approve / re-approve（制作人显式动作）：重算内容指纹 → trust=true → 留痕。
 *   - 已批准且指纹相同 → 幂等返回（不追加重复 history）
 *   - 历史上批准过（含 revoke 后再批准、批准面指纹已变）→ action='re-approve'
 */
export function approveCompanyDirectory(
  companyDir: string,
  files: Record<string, string>,
  entry: { by: string; at: string; note?: string },
): TrustAnchor {
  const prev = readTrustAnchor(companyDir)
  const fingerprint = contentFingerprint(excludeAnchorFiles(files))
  if (prev !== null && prev.trust && prev.fingerprint === fingerprint) return prev
  const everApproved =
    prev !== null && prev.history.some((h) => h.action === 'approve' || h.action === 're-approve')
  const action: TrustHistoryEntry['action'] = everApproved ? 're-approve' : 'approve'
  const anchor: TrustAnchor = {
    schema: TRUST_SCHEMA,
    slug: prev?.slug ?? '',
    trust: true,
    fingerprint,
    history: [
      ...(prev?.history ?? []),
      { action, by: entry.by, at: entry.at, fingerprint, ...(entry.note !== undefined ? { note: entry.note } : {}) },
    ],
  }
  writeTrustAnchor(companyDir, anchor)
  return anchor
}

/**
 * revoke（漂移降级）：trust→false + 留痕（指纹沿旧值——revoke 记录的是「从哪个批准面跌落」）。
 */
export function revokeTrust(companyDir: string, entry: { by: string; at: string; note?: string }): TrustAnchor | null {
  const prev = readTrustAnchor(companyDir)
  if (prev === null || !prev.trust) return prev
  const anchor: TrustAnchor = {
    ...prev,
    trust: false,
    history: [
      ...prev.history,
      { action: 'revoke', by: entry.by, at: entry.at, ...(prev.fingerprint !== null ? { fingerprint: prev.fingerprint } : {}), ...(entry.note !== undefined ? { note: entry.note } : {}) },
    ],
  }
  writeTrustAnchor(companyDir, anchor)
  return anchor
}

/** 装配层消费位：公司目录信任态（无锚=init 通道受信；有锚看 trust 位） */
export function trustStateOf(companyDir: string): { trusted: boolean; anchor: TrustAnchor | null } {
  const anchor = readTrustAnchor(companyDir)
  return { trusted: anchor === null ? true : anchor.trust, anchor }
}
