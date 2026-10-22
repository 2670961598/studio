/**
 * daemon.yaml 标量强制件（serve.ts 拆出——20-§十五.三.3 尺寸门「先拆再增」；studio-dev-166
 * 129-A 接线时腾位）：coerceServeConfig 各 case 共用的类型收窄与 CONFIG_INVALID 明报。
 * 逐字搬迁零行为漂移；serve.ts 经 import 同源使用。
 */

/** 键值须为非空字符串（缺省回填后的显式键校验） */
export function str(v: unknown, key: string): string {
  if (typeof v !== 'string' || v === '') throw new Error(`daemon.yaml：${key} 须为非空字符串`)
  return v
}

/** 键值须为非负有限数 */
export function num(v: unknown, key: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`daemon.yaml：${key} 须为非负数`)
  return v
}

/** 键值须为布尔字面量 */
export function bool(v: unknown, key: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`daemon.yaml：${key} 须为 true/false`)
  return v
}
