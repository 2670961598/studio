// ✦ DEV-45 结构刀（studio-dev-78）：本文件自 apps/daemon/src/bin.ts L265-L310 逐字节拆出（纯移动零功能变更；核验=对 git 历史旧路径对应行区间字节一致，仅增本行头注、import 头与 export 关键字）。

export interface Argv {
  positionals: string[]
  flags: Record<string, string>
  /** 布尔旗标（无值，出现即 true） */
  booleans: Set<string>
  /** 可重复旗标的全部取值（按出现序；不可重复旗标不进此面） */
  multi: Record<string, string[]>
}

/**
 * 零依赖 argv 解析：--key value 成对消费（booleanFlags 中的旗标无值，出现即真）；
 * 未知旗标 / 缺值即用法错误。repeatableFlags 中的旗标可多次出现（取值收集进 multi，
 * 后值不覆盖前值）。
 */
export function parseArgv(argv: string[], valueFlags: ReadonlySet<string>, repeatableFlags?: ReadonlySet<string>, booleanFlags?: ReadonlySet<string>): Argv | { error: string } {
  const positionals: string[] = []
  const flags: Record<string, string> = {}
  const booleans = new Set<string>()
  const multi: Record<string, string[]> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      if (booleanFlags?.has(key)) {
        booleans.add(key)
        continue
      }
      if (!valueFlags.has(key)) return { error: `未知参数：${arg}` }
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) return { error: `${arg} 缺少取值` }
      flags[key] = value
      if (repeatableFlags?.has(key)) {
        ;(multi[key] ??= []).push(value)
      }
      i += 1
    } else {
      positionals.push(arg)
    }
  }
  return { positionals, flags, booleans, multi }
}

export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

