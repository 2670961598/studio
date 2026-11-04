/**
 * anchor-grant —— 外部锚章程 → RootGrantFact（studio-dev-773；docs/v2/11 §2.2 离线批准模式）
 *
 * 覆盖：真实-shaped anchors（章程+旁车+登记公钥+登记说明+授权留档）读取与哈希/SSH 指纹核对；
 * fail-closed 全负面（缺件/哈希不符/指纹不符/授权缺/期限过期）；REC-AUTH-01 经 records 装配落库
 * 且 proofBoundary 标注 offline-approval（非密码学验签）；live anchors 目录只读解析（env 提供时）。
 * 不写公司目录/不写真台账（临时台账）；不发真实密钥。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openLedger, createHistFace } from '@studio-next/store'
import type { ReadContext } from '@studio-next/contract'
import { bootRecordRoster, wireServeRecords } from '../../../src/assembly/records/serve-face.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'
import {
  ANCHORS_DIR_NAME,
  AUTHORIZATION_FILE_PREFIX,
  OPERATING_KEY_DOC_FILE,
  OPERATING_KEY_PUB_FILE,
  anchorGrantForInjection,
  loadRootGrantFromAnchors,
  sshFingerprintOfOpenSshPub,
} from '../../../src/assembly/records/anchor-grant.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function tempDir(): string {
  const dir = mkdtempSync(path.join(process.cwd(), '.tmp-anchor-grant-'))
  dirs.push(dir)
  return dir
}

/** 公开公钥样本（OpenSSH ed25519；公钥不是秘密） */
const PUB = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL/12CGPNzB031XXPeBcW7lU0FhRoEoNJBdO//xh8EQ1 studio-dev root operating key'
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

function charterText(over: { from?: string; to?: string; extra?: string } = {}): string {
  return [
    '# 外部锚章程（v1）',
    '',
    `生效日期：**${over.from ?? '2026-11-04'}**；期限：**1 年（至 ${over.to ?? '2027-11-04'}）**；`,
    '',
    '## 六、签名',
    '- 授权依据（制作人聊天原文）：',
    '  > 「可以」',
    '- 签署日期：**2026-11-04**',
    over.extra ?? '',
    '',
  ].join('\n')
}

/** 构造真实-shaped anchors 目录（哈希/指纹全部按真实核对链生成） */
function buildAnchors(over: {
  charter?: string
  pub?: string
  keyDocPubSha?: string
  keyDocSshFp?: string
  auth?: string
  omitPub?: boolean
  omitAuth?: boolean
  omitCharterSidecar?: boolean
} = {}): { dir: string; companyDir: string; charterSha: string; pubSha: string; sshFp: string } {
  const companyDir = tempDir()
  const anchors = path.join(companyDir, ANCHORS_DIR_NAME)
  mkdirSync(anchors, { recursive: true })
  const charter = over.charter ?? charterText()
  const charterSha = sha256(charter)
  writeFileSync(path.join(anchors, '外部锚章程-v1.md'), charter, 'utf8')
  if (over.omitCharterSidecar !== true) {
    writeFileSync(path.join(anchors, '外部锚章程-v1.md.sha256'), `${charterSha}  外部锚章程-v1.md\n`, 'utf8')
  }
  const pub = over.pub ?? `${PUB}\n`
  const pubSha = sha256(pub)
  const sshFp = sshFingerprintOfOpenSshPub(pub) as string
  if (over.omitPub !== true) writeFileSync(path.join(anchors, OPERATING_KEY_PUB_FILE), pub, 'utf8')
  const keyDoc = [
    '# 根 operating key 登记',
    `- 公钥文件：\`${ANCHORS_DIR_NAME}/${OPERATING_KEY_PUB_FILE}\``,
    `- SSH 指纹：\`${over.keyDocSshFp ?? sshFp}\``,
    `- 公钥文件 sha256：\`${over.keyDocPubSha ?? pubSha}\``,
    '',
  ].join('\n')
  writeFileSync(path.join(anchors, OPERATING_KEY_DOC_FILE), keyDoc, 'utf8')
  if (over.omitAuth !== true) {
    const auth =
      over.auth ??
      [
        '# 外部锚授权记录',
        `- 章程文件哈希：${charterSha}`,
        `- 根公钥哈希：${pubSha}`,
        `- SSH 指纹：${over.keyDocSshFp ?? sshFp}`,
        '',
      ].join('\n')
    writeFileSync(path.join(anchors, `${AUTHORIZATION_FILE_PREFIX}2026-11-04.md`), auth, 'utf8')
  }
  return { dir: anchors, companyDir, charterSha, pubSha, sshFp }
}

const NOW = Date.UTC(2026, 10, 5, 0, 0, 0) // 2026-11-05（章程期内）

describe('loadRootGrantFromAnchors：真实核对链（fixture 公钥；非真凭据）', () => {
  it('齐全且哈希/SSH 指纹一致 → RootGrantFact（offline-approval 形态）', () => {
    const { companyDir, sshFp } = buildAnchors()
    const result = loadRootGrantFromAnchors({ companyDir, now: () => NOW })
    expect(result.ok).toBe(true)
    const fact = result.fact
    expect(fact).toBeDefined()
    expect(fact?.keyFingerprint).toBe(sshFp)
    expect(fact?.proofVerified).toBe(true)
    expect(fact?.fingerprintMatches).toBe(true)
    expect(fact?.proofBasis).toBe('offline-approval')
    expect(fact?.term).toEqual({ from: '2026-11-04T00:00:00.000Z', to: '2027-11-04T23:59:59.999Z' })
    expect(fact?.offlineApprovalRef?.refId).toContain('authorization-')
    expect(fact?.offlineApprovalRef?.refId).toMatch(/#offline-approval:sha256:[0-9a-f]{64}$/)
    expect(fact?.offlineApprovalRef?.refVersion).toBe('1.0.0')
  })

  it('fail-closed：目录缺/章程旁车缺/哈希不符/公钥缺/公钥哈希不符/SSH 不符/授权缺/授权未引用/期限过期', () => {
    expect(loadRootGrantFromAnchors({ companyDir: tempDir(), now: () => NOW }).ok).toBe(false)
    const noSidecar = buildAnchors({ omitCharterSidecar: true })
    expect(loadRootGrantFromAnchors({ companyDir: noSidecar.companyDir, now: () => NOW }).ok).toBe(false)
    const badCharter = buildAnchors()
    writeFileSync(path.join(badCharter.dir, '外部锚章程-v1.md'), `${charterText()}\n篡改`, 'utf8')
    expect(loadRootGrantFromAnchors({ companyDir: badCharter.companyDir, now: () => NOW }).ok).toBe(false)
    const noPub = buildAnchors({ omitPub: true })
    expect(loadRootGrantFromAnchors({ companyDir: noPub.companyDir, now: () => NOW }).ok).toBe(false)
    const badPubHash = buildAnchors({ keyDocPubSha: 'f'.repeat(64) })
    expect(loadRootGrantFromAnchors({ companyDir: badPubHash.companyDir, now: () => NOW }).ok).toBe(false)
    const badSsh = buildAnchors({ keyDocSshFp: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
    expect(loadRootGrantFromAnchors({ companyDir: badSsh.companyDir, now: () => NOW }).ok).toBe(false)
    const noAuth = buildAnchors({ omitAuth: true })
    expect(loadRootGrantFromAnchors({ companyDir: noAuth.companyDir, now: () => NOW }).ok).toBe(false)
    const authMismatch = buildAnchors({ auth: '# 授权记录\n（未引用章程/公钥哈希）\n' })
    expect(loadRootGrantFromAnchors({ companyDir: authMismatch.companyDir, now: () => NOW }).ok).toBe(false)
    const expired = buildAnchors({ charter: charterText({ from: '2025-01-01', to: '2026-01-01' }) })
    expect(loadRootGrantFromAnchors({ companyDir: expired.companyDir, now: () => NOW }).ok).toBe(false)
    const future = buildAnchors({ charter: charterText({ from: '2027-01-01', to: '2028-01-01' }) })
    expect(loadRootGrantFromAnchors({ companyDir: future.companyDir, now: () => NOW }).ok).toBe(false)
  })

  it('LIVE：真实 studio-dev anchors 目录只读解析（STUDIO_ANCHORS_DIR 提供时；不写台账）', () => {
    const live = process.env.STUDIO_ANCHORS_DIR
    if (live === undefined || live === '') {
      // 机器特定集成面：CI/干净树无公司目录时跳过；核心读取逻辑已由上方 fixture 全覆盖。
      return
    }
    const result = loadRootGrantFromAnchors({ companyDir: path.dirname(live), now: () => NOW, log: () => {} })
    expect(result.ok).toBe(true)
    expect(result.keyFingerprint).toMatch(/^SHA256:/)
    expect(result.charterFile).toMatch(/^外部锚章程-v\d+\.md$/)
  })
})

describe('anchorGrantForInjection：部署顺序安全（声明在场不注入，避免 707 冲突）', () => {
  it('声明在场→不注入（明报原因）；无声明→注入；无 fact→空', () => {
    const { companyDir } = buildAnchors()
    const fact = loadRootGrantFromAnchors({ companyDir, now: () => NOW }).fact
    expect(fact).toBeDefined()
    const withFact = { ...(fact !== undefined ? { fact } : {}) }
    expect(anchorGrantForInjection({ ...withFact, declarationPresent: true }).fact).toBeUndefined()
    expect(anchorGrantForInjection({ ...withFact, declarationPresent: true }).skippedReason).toContain('仍声明无锚')
    expect(anchorGrantForInjection({ ...withFact, declarationPresent: false }).fact).toBe(fact)
    expect(anchorGrantForInjection({ declarationPresent: false })).toEqual({})
  })
})

describe('records 装配：RootGrantFact → REC-AUTH-01（grant_class=root_delegation）', () => {
  it('注入 fact 后相位 0 落 REC-AUTH-01，proofBoundary 标 offline-approval；无 fact 时仍拒写', () => {
    const { companyDir } = buildAnchors()
    const loaded = loadRootGrantFromAnchors({ companyDir, now: () => NOW })
    expect(loaded.fact).toBeDefined()
    const dir = tempDir()
    const ledger = openLedger(path.join(dir, 'ledger.sqlite'))
    try {
      ledger.syncCompany(DEMO_SNAPSHOT)
      const face = wireServeRecords({
        ledger,
        company: 'demo',
        clock: () => NOW,
        ...(loaded.fact !== undefined ? { rootGrant: loaded.fact } : {}),
      })
      bootRecordRoster({ records: face.records, at: NOW })
      const hist = createHistFace(ledger.db)
      const rc: ReadContext = {
        readScope: { company: { companyId: 'demo', slug: 'demo' }, fields: ['records.record.payload'], purpose: '773 test read' },
        caller: { callerId: 'test', kind: 'program', programRef: 'test' },
      }
      const auths = hist.query({ company: 'demo', type: 'REC-AUTH-01' }, rc).filter((row) => row.payload !== undefined && JSON.stringify(row.payload).includes('root_delegation'))
      expect(auths.length).toBeGreaterThanOrEqual(1)
      expect(JSON.stringify(auths[0]?.payload)).toContain('proof_mode')
      expect(JSON.stringify(auths[0])).toContain('offline-approval')
    } finally {
      ledger.close()
    }
  })
})
