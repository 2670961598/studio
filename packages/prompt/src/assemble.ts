/**
 * assemble —— AGENTS.md 组装器（docs/17-§5 / 04-§六，需求 C2-06/C2-08/C2-10/C2-11）
 *
 * 规格依据（实现单引用）：
 *   - 17-§5：六层装配 → AGENTS.md（生态标准名，抗 auto-compact——compact 后从磁盘重注入）；
 *     分层指纹 W-<fwk>/co.<rev>/org.<rev>/p.<工号>.<rev>/t.<单号>.<att>/ex.<adapter>@<ver> 记账。
 *   - 04-§六：文件标记「生成物勿手改」，每次派发重生成；落点通道归 daemon/适配器（本包只出文本）。
 *   - C2-06：层间定界标记包裹、层内无他层标记（本函数再验一道：层正文只许本层无标记）。
 *   - C2-10：不可信隔离的剥离计数在此汇总（{sanitized:n}），记事件归 daemon（本包零 IO）。
 *   - C2-11：组装确定性——同输入同 bytes；每次组装各层字节清单（落盘归 daemon，这里返回清单）。
 *
 * 纯函数纪律：同输入恒同输出；零盘 IO；零时间/随机内取。
 */
import {
  LAYER_ORDER,
  assertLayerSequence,
  combinedFingerprint,
  layerMarkerBegin,
  layerMarkerEnd,
  type LayerId,
  type PromptLayer,
} from './layers.ts'

/** 「生成物勿手改」横幅（04-§六：每次派发重生成） */
export const AGENTS_MD_BANNER =
  '<!-- Studio Next 生成物：勿手改（每次派发重新生成；分层指纹见下一行） -->'

/** 各层字节清单条目（C2-11：每次组装落盘各层字节清单——落盘归 daemon，本包返回清单） */
export interface LayerByteEntry {
  id: LayerId
  /** 字符数（UTF-16 code units；预算口径=chars） */
  chars: number
  /** UTF-8 字节数（记账口径=bytes） */
  bytes: number
}

/** 组装结果 */
export interface AssembleResult {
  /** AGENTS.md 全文（落盘归 daemon——落点走用户级通道优先，04-§六 B5 修订） */
  text: string
  /** 完整分层指纹（C2-08 冻结式，六段 '/' 拼接） */
  fingerprint: string
  /** 各层指纹段（改一层只动一段的对照面） */
  layerFingerprints: Readonly<Record<LayerId, string>>
  /** 命令形态行剥离总数（不可信隔离汇总；daemon 据此记事件，C2-10） */
  sanitized: number
  /** 各层字节清单（C2-11） */
  layerBytes: LayerByteEntry[]
}

const utf8Encoder = new TextEncoder()

/** 层正文不得再含任何层定界标记（构建器不写、输入已拒走私——组装前终验，C2-06） */
function assertContentFreeOfLayerMarkers(layer: PromptLayer): void {
  if (/<!--\s*LAYER:L\d:(?:BEGIN|END)/.test(layer.content)) {
    throw new Error(
      `prompt/assemble: ${layer.id} 层正文含层定界标记——层内无他层标记（C2-06），拒组装`,
    )
  }
}

/** 六层 → AGENTS.md 文本 + 分层指纹 + 隔离计数 + 字节清单（同输入同 bytes） */
export function assembleAgentsMd(layers: readonly PromptLayer[]): AssembleResult {
  assertLayerSequence(layers)
  const layerFingerprints = {} as Record<LayerId, string>
  const blocks: string[] = []
  const layerBytes: LayerByteEntry[] = []
  let sanitized = 0
  for (const layer of layers) {
    assertContentFreeOfLayerMarkers(layer)
    layerFingerprints[layer.id] = layer.fingerprint
    sanitized += layer.sanitized
    blocks.push(`${layerMarkerBegin(layer.id)}\n${layer.content}\n${layerMarkerEnd(layer.id)}`)
    layerBytes.push({
      id: layer.id,
      chars: layer.content.length,
      bytes: utf8Encoder.encode(layer.content).length,
    })
  }
  const fingerprint = combinedFingerprint(layers)
  const text = [
    AGENTS_MD_BANNER,
    `<!-- 分层指纹: ${fingerprint} -->`,
    '',
    ...blocks.map((b) => `${b}\n`),
  ].join('\n')
  return { text, fingerprint, layerFingerprints, sanitized, layerBytes }
}

/** 层序常量再导出（调用方便利；L0-L5 冻结序） */
export { LAYER_ORDER }
