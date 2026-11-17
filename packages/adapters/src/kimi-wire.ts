import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 有界等待真实 wire 文件出现且非空（task-123：Kimi 会话结束后异步落盘）。 */
export async function waitForRealWireFile(sessionId: string): Promise<string | undefined> {
  const deadline = Date.now() + 2_000
  let delay = 50
  while (Date.now() < deadline) {
    const found = await resolveRealWirePath(sessionId)
    if (found !== undefined) {
      try { if ((await stat(found)).size > 0) return found } catch { /* 继续等待 */ }
    }
    await new Promise((r) => setTimeout(r, Math.min(delay, Math.max(0, deadline - Date.now()))))
    delay = Math.min(delay * 2, 500)
  }
  return undefined
}


/** 真实 wire 路径：KIMI_CODE_HOME 或 ~/.kimi-code 下 sessions/星号/CLI session id/agents/main/wire.jsonl */
export async function resolveRealWirePath(sessionId: string): Promise<string | undefined> {
  const root = process.env['KIMI_CODE_HOME'] ?? join(homedir(), '.kimi-code')
  try {
    const dirs = await readdir(join(root, 'sessions'), { withFileTypes: true })
    for (const d of dirs) {
      if (!d.isDirectory()) continue
      const candidate = join(root, 'sessions', d.name, sessionId, 'agents', 'main', 'wire.jsonl')
      try { await readFile(candidate, 'utf8'); return candidate } catch { /* next */ }
    }
  } catch { /* root absent */ }
  return undefined
}
