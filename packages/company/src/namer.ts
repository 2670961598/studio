/**
 * 员工花名随机命名器（DEV-14，docs/36-§4 M-A / docs/36-§1「员工随机命名」行）。
 *
 * 职责单一：种子 → 确定性花名序列（中文两字 = 形容池 × 意象池，初稿 32×32=1024 组合）。
 *
 * 契约（studio-dev-29 plan 附录 B，随 DEV-14 复活呈批）：
 *   - 确定性：同种子同序列（fnv1a 播种 + mulberry32 游程）——模板种子冻结后再生零 diff；
 *     不同种子序列不同（各级模板花名互不串台）。
 *   - 批内唯一：同一序列内不重复（重拾确定性重试，词域 1024 ≫ 单模板峰值 16）。
 *   - 口味红线：两字、无真名 / 商标 / 敏感词、避开多音歧义字（词池人工冻结，不加机翻词）。
 *
 * 消费面：gen-template.ts（分级模板花名）；测试冻结黄金序列（改词池 = 重新冻结，属口味变更）。
 */

/** FNV-1a 32 位散列（种子字符串 → uint32；同入同出，跨平台稳定） */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 伪随机游程（32 位种子 → [0,1) 确定性序列；轻量、可冻结、无宿主依赖） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 花名词池（32×32，人工冻结——附录 B 口味红线；改池=重新冻结黄金序列）。
 * 形容池取「气质/动作」单字，意象池取「自然/器物」单字；两两拼接成两字花名。
 */
export const NAME_POOLS = {
  adjectives: [
    '青', '明', '远', '静', '朗', '素', '澈', '煦', '湛', '屹', '昭', '澄', '疏', '白', '知', '望',
    '慕', '拾', '听', '沐', '泊', '缓', '野', '云', '松', '川', '星', '岚', '屿', '溪', '叙', '直',
  ],
  nouns: [
    '山', '河', '桐', '杉', '雀', '鲸', '帆', '桥', '灯', '砚', '原', '潮', '峰', '林', '舟', '亭',
    '钟', '窗', '径', '石', '禾', '井', '塔', '汀', '浦', '檐', '笛', '篁', '隼', '鲲', '鹿', '樵',
  ],
} as const

/**
 * 花名序列：种子 + 数量 → 确定性、批内唯一的两字花名（按序返回）。
 * count 超出词域（1024）即抛——单模板骨架峰值 16，词域耗尽属调用方错配。
 */
export function codenames(seed: string, count: number): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`count 须为非负整数，实得 ${String(count)}`)
  }
  const domain = NAME_POOLS.adjectives.length * NAME_POOLS.nouns.length
  if (count > domain) {
    throw new Error(`count=${count} 超出词域 ${NAME_POOLS.adjectives.length}×${NAME_POOLS.nouns.length}=${domain}（扩词池或分种子）`)
  }
  const rng = mulberry32(fnv1a(seed))
  const used = new Set<string>()
  const out: string[] = []
  let guard = 0
  while (out.length < count) {
    // 重拾上限：确定性重试，超限属词域错配（非口味问题）——挡死循环
    if (++guard > count * 64 + 4096) {
      throw new Error(`命名器重拾环超限（seed=${seed} count=${count}——词池可用组合不足）`)
    }
    const adj = NAME_POOLS.adjectives[Math.floor(rng() * NAME_POOLS.adjectives.length)]!
    const noun = NAME_POOLS.nouns[Math.floor(rng() * NAME_POOLS.nouns.length)]!
    const name = adj + noun
    if (used.has(name)) continue
    used.add(name)
    out.push(name)
  }
  return out
}
