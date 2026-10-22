/**
 * state-hygiene —— 州表卫生双层声明（127-C，studio-dev-127 §4.7 制作人 2026-10-22 全批）。
 *
 * org-config yt 段双层键的内容闸 + 快照装载（结构上 yt 仍是自由 record——03/N1 平台
 * 映射覆盖语义不变，本模块只收双层键）：
 *   - 白名单层 `yt.known_foreign_states`：已知外来态（平台历史/英文名态）——引擎哨兵
 *     降 FOREIGN_KNOWN 观察级（daemon DEV-49 A4 面，docs/52-§十），巡逻核公式
 *     「平台状态集−(声明集∪白名单)=∅」并集吸收；未声明新漂移仍 ESCALATE（负对照）。
 *   - 映射层 `yt.state_mapping`/`yt.state_mapping_audited`：外来态→公司态**统计**映射
 *     （仅面板进度视图，不动状态机/迁移）；启用前置一次性审计全键盖戳，fail-closed——
 *     防误拖进归档态的未交付单被映射洗白（红队 6-2 采纳）。
 *
 * 规则 SH-1..SH-5（每条命中指认到文件:行+修法；MountResult 拒绝挂载口径与 org-config/*
 * 同族）：
 *   - SH-1 known_foreign_states=非空字符串数组、无重复（集合语义）
 *   - SH-2 state_mapping=Record<非空键,非空串>（空映射不声明即面关）
 *   - SH-3 映射键 ∈ 白名单（映射对象是外来态；公司流表声明态不得映射——双计/改写）
 *   - SH-4 state_mapping 全键须在 yt.state_mapping_audited 盖非空戳（审计日期/凭据号）
 *   - SH-5 戳集 ⊆ 映射键集（映射键删除后残戳清理——审计历史归 git，不留双份）
 */
import type { LineCounter } from 'yaml'
import { parseDocument } from 'yaml'
import type { CompanySnapshot, DirectoryIssue } from '@studio-next/contract'
import { lineOfPath } from './multifile.ts'

const ORG_CONFIG_FILE = 'org-config.yaml'

/** 州表卫生内容规则（validator.ts issues 面拼装；yt 缺省=无键零规则） */
export function stateHygieneRules(doc: ReturnType<typeof parseDocument>, lc: LineCounter, yt: Record<string, unknown> | undefined): DirectoryIssue[] {
  if (yt === undefined) return []
  const out: DirectoryIssue[] = []
  const push = (path: (string | number)[], rule: string, fix: string): void => {
    out.push({ file: ORG_CONFIG_FILE, line: lineOfPath(doc, lc, ['yt', ...path]), rule: `org-config/${rule}`, fix })
  }
  const isPlainRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

  // SH-1：白名单形状与去重（集合语义）
  const known = yt['known_foreign_states']
  let knownSet: Set<string> | undefined
  if (known !== undefined) {
    if (!Array.isArray(known) || known.some((s) => typeof s !== 'string' || s.length === 0)) {
      push(['known_foreign_states'], 'state-hygiene-bad-whitelist', 'yt.known_foreign_states 须为非空字符串数组（州表卫生白名单层——127-C，studio-dev-127 §4.7）')
    } else {
      knownSet = new Set(known)
      if (knownSet.size !== (known as string[]).length) {
        push(['known_foreign_states'], 'state-hygiene-dup-whitelist', `yt.known_foreign_states 有重复项（${(known as string[]).join('、')}）——白名单是集合语义`)
      }
    }
  }

  // SH-2..SH-5：映射层（无 state_mapping=面关——只查残戳）
  const mapping = yt['state_mapping']
  const audited = yt['state_mapping_audited']
  if (mapping === undefined) {
    if (audited !== undefined) {
      push(['state_mapping_audited'], 'state-hygiene-audit-without-mapping', 'yt.state_mapping_audited 声明了审计戳但没有 yt.state_mapping——残戳清理（审计历史归 git，不留双份）')
    }
    return out
  }
  if (!isPlainRecord(mapping)) {
    push(['state_mapping'], 'state-hygiene-bad-mapping', 'yt.state_mapping 须为「外来态: 公司态」映射 record（127-C studio-dev-127 §4.7 映射层，不声明=不映射）')
    return out
  }
  const mappingKeys = Object.keys(mapping)
  const badValues = mappingKeys.some((k) => k.length === 0 || typeof mapping[k] !== 'string' || (mapping[k] as string).length === 0)
  if (mappingKeys.length === 0 || badValues) {
    push(['state_mapping'], 'state-hygiene-bad-mapping', 'yt.state_mapping 须为「外来态: 公司态」映射 record（键值均非空；空映射不声明即面关）')
  }
  // SH-3：映射键外来性（∈白名单——白名单缺声明=映射须白名单先行，全键不外来：
  // 无白名单无从判外来性，放行即可能映射公司声明态改写统计——fail-closed）
  for (const k of mappingKeys) {
    if (knownSet === undefined || !knownSet.has(k)) {
      push(['state_mapping', k], 'state-hygiene-mapping-not-foreign', `映射键 ${k} 不在 yt.known_foreign_states 白名单内（未声明白名单=映射须白名单先行）——映射对象是已知外来态；若 ${k} 是公司流表声明态则不得映射（双计/改写公司态）`)
    }
  }
  // SH-4：启用前置审计全键盖戳（fail-closed）
  if (audited === undefined) {
    push(['state_mapping'], 'state-hygiene-mapping-unaudited', '启用前置审计未过：yt.state_mapping 全键须在 yt.state_mapping_audited 盖非空戳（逐键审计日期/凭据号）——防误拖进归档态的未交付单被映射洗白（127-C，红队 6-2 采纳）')
  } else if (!isPlainRecord(audited)) {
    push(['state_mapping_audited'], 'state-hygiene-bad-audit', 'yt.state_mapping_audited 须为「外来态: 戳」record（戳=非空串：审计日期/凭据号）')
  } else {
    for (const k of mappingKeys) {
      const stamp = audited[k]
      if (typeof stamp !== 'string' || stamp.length === 0) {
        push(['state_mapping_audited'], 'state-hygiene-mapping-unaudited', `映射键 ${k} 未盖审计戳（yt.state_mapping_audited.${k} 空或缺失）——启用前置审计 fail-closed（127-C 红队 6-2）`)
      }
    }
    // SH-5：残戳（映射键已删而戳还在）
    for (const k of Object.keys(audited)) {
      if (!(k in mapping)) {
        push(['state_mapping_audited', k], 'state-hygiene-audit-stale', `审计戳 ${k} 已不在 yt.state_mapping 键集内——残戳清理（审计历史归 git）`)
      }
    }
  }
  return out
}

/**
 * 州表卫生双层装载 → 快照（127-C）：形态已由 stateHygieneRules（SH-1..SH-5）前置
 * 拦下（issues 非空不达本面），此处只装载不二审。
 */
export function applyStateHygieneToSnapshot(snap: CompanySnapshot, yt: Record<string, unknown> | undefined): void {
  const knownStates = yt?.['known_foreign_states']
  if (Array.isArray(knownStates)) snap.knownForeignStates = knownStates as string[]
  const stateMapping = yt?.['state_mapping']
  if (stateMapping !== undefined && typeof stateMapping === 'object' && !Array.isArray(stateMapping)) {
    snap.stateMapping = stateMapping as Record<string, string>
  }
}
