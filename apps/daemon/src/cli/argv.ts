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
 *
 * `--key=value` 内联式同样收（studio-dev-103 E12/F5 处置，studio-dev-125 实施——加法式：
 * 空格式语义不变，两式并存；布尔旗标不收内联值，`--flag=x` 即用法错误）。
 */
export function parseArgv(argv: string[], valueFlags: ReadonlySet<string>, repeatableFlags?: ReadonlySet<string>, booleanFlags?: ReadonlySet<string>): Argv | { error: string } {
  const positionals: string[] = []
  const flags: Record<string, string> = {}
  const booleans = new Set<string>()
  const multi: Record<string, string[]> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
      const inline = eq === -1 ? undefined : arg.slice(eq + 1)
      if (booleanFlags?.has(key)) {
        if (inline !== undefined) return { error: `布尔旗标 --${key} 不收值（去掉 =${inline}）` }
        booleans.add(key)
        continue
      }
      if (!valueFlags.has(key)) return { error: `未知参数：${arg}` }
      let value: string
      if (inline !== undefined) {
        if (inline === '') return { error: `${arg} 缺少取值` }
        value = inline
      } else {
        const next = argv[i + 1]
        if (next === undefined || next.startsWith('--')) return { error: `${arg} 缺少取值` }
        value = next
        i += 1
      }
      flags[key] = value
      if (repeatableFlags?.has(key)) {
        ;(multi[key] ??= []).push(value)
      }
    } else {
      positionals.push(arg)
    }
  }
  return { positionals, flags, booleans, multi }
}

export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

