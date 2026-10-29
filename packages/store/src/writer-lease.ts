/**
 * writer-lease —— 台账跨进程写围栏（PB-5 / PRB-14 正面；daemon serve 写入路径）
 *
 * 依据：
 *   - docs/v2/17 §五 PB-5：入口 MIG-04（D12 围栏/只读打开）；PRB-14 未过不得宣称台账单写；
 *   - docs/probe/pb-5/report.md PRB-14（负向）：两进程各自 `openLedger`、无框架围栏、
 *     实测 `query_only=0`；SQLite 引擎级串行化被如实登记为「不是框架围栏」；
 *   - docs/80 §8.2〔结论〕1「迁移只由 daemon 在独占窗口执行（启动时、且持有写者围栏/
 *     单实例锁）」；§8.5「无互认围栏时不得并发双写」。
 *
 * 边界（本件**不是**什么）：
 *   - 不是 docs/80 §8.2/§8.5 的 `WriterLeasePort`：没有 `acquire/renew/release` 的 TTL
 *     续期、没有单调 `FenceToken`、没有 `LeaseGrant`/`expiresAt` 语义。本件只解决
 *     「同一台机器、同一文件系统、同一 db 路径」上的 daemon 双实例互斥；
 *   - 不跨主机/不跨容器（NFS/overlay 的 O_EXCL/进程可见性未验证），不替代仓库层的
 *     唯一写入者纪律（v2/05 互认围栏语义仍归后续端口刀）；
 *   - 只约束调用 `openLedgerWriter` 的写者。本仓仍有 CLI/panel/rebuild/drill 等直接
 *     `openLedger` 的调用点，均**未**纳入围栏——不得据本件宣称「台账单写」整体成立。
 *
 * 协议（锁文件 = `<db>.writer.lock`，与库文件同目录；不含秘密）：
 *   1. `openSync(lockPath, 'wx', 0o600)` 排他创建——O_CREAT|O_EXCL 由内核保证唯一赢家；
 *      写入 `{pid, owner, at}`（JSON＋换行）并 fsync，然后关闭 fd；
 *   2. 已存在：读 pid——进程存活（`process.kill(pid, 0)`；EPERM 视为存活）⇒
 *      `STALL/writer-lease-held`（detail 含持有者 pid/owner/at，**不覆盖**）；进程已死
 *      （ESRCH）⇒ 内容复核一致后清理一次，再重试创建；
 *   3. 释放：只删**内容逐字等于本次写入**的锁（不误删他人锁）；文件已消失/内容不符/
 *      IO 失败一律返 false——宁可残留自己的锁（下次启动按死 pid 清理兜底），不误删他人锁；
 *      同一 handle 重复 release 直接返回 false（防旧 handle 误删同毫秒重取的新锁）；
 *   4. `openLedgerWriter`：取 lease → `openLedger`；打开失败**释放 lease** 后上抛；
 *      返回的 `Ledger.close()` 先关 db、成功后释放 lease（关库失败不释放——宁可残留也
 *      不放进第二个写者）。
 *
 * 失败分类（全部带 category/subcause 机器键；detail 已脱敏锁/库路径）：
 *   | 情形 | 分类 |
 *   |---|---|
 *   | dbPath/owner 非空串 | CONFIG_INVALID/writer-lease-path-invalid｜owner-invalid |
 *   | 锁父目录不存在 | CONFIG_INVALID/writer-lease-path-invalid |
 *   | 锁创建/读取/写入/清理 IO 失败 | STALL/writer-lease-io |
 *   | 锁在且持有者 pid 存活 | STALL/writer-lease-held |
 *   | 锁内容不可解析 / pid·owner·at 非法 | STALL/writer-lease-unreadable（fail-closed，不覆盖） |
 *   | 清理死锁一次后仍抢不到 | STALL/writer-lease-contended |
 *   | openLedger 失败 | 已分类错误原样上抛；未分类 → STALL/db-open-failed |
 *
 * 已知边界（诚实登记）：
 *   - **pid 复用**：死锁 pid 被无关进程复用时按「存活」拒（fail-closed，需人工清锁）；
 *   - **无 TTL**：存活判定只看 pid，`at` 仅供审计/观测，不参与判定（避开 docs/80 §8.6
 *     墙钟回拨问题；代价是持锁者真正死亡前不会自动过期）；
 *   - **崩溃窗口**：O_EXCL 创建后、内容落盘前崩溃留空锁——读不出 pid 即
 *     `writer-lease-unreadable` 拒启，不自动删除无法证明死亡的锁（需人工处理）；
 *   - **路径别名**：锁路径按 `path.resolve(dbPath)` 取；符号链接/绑定点指向同一库的不同
 *     路径得到不同锁文件（bypass）——本件不承诺跨路径别名互斥。
 */
import { closeSync, fsyncSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { resolve } from 'node:path'
import { configInvalid, type ClassifiedError } from '@studio-next/contract'
import { openLedger, type Ledger } from './ledger.ts'

/** 锁记录形状（锁文件内容；owner 由调用方给，pid/at 由 acquire 填） */
interface LeaseFileContent {
  readonly pid: number
  readonly owner: string
  readonly at: number
}

/**
 * 写者租约句柄：`release()` 只删内容逐字等于本次写入的锁文件。
 * 同一 handle 的 release 幂等（第二次起返 false）；不代表 docs/80 的 `FenceToken`。
 */
export interface WriterLease {
  /** 台账库的规范路径（`path.resolve(dbPath)`；openLedgerWriter 用它开库） */
  readonly dbPath: string
  /** 锁文件绝对路径（`<dbPath>.writer.lock`） */
  readonly lockPath: string
  /** 持有者进程 pid（写入锁文件时取 `process.pid`） */
  readonly pid: number
  /** 持有者标识（调用方传入；写入锁文件，拒绝时出现在 detail 中） */
  readonly owner: string
  /** 取锁时刻（epoch ms，写入锁文件） */
  readonly acquiredAt: number
  /** 释放：仅当锁文件内容与本次写入逐字一致时删除；返回是否真的删了 */
  release(): boolean
}

/** 抢锁最大尝试轮次（正常路径 1 轮；死锁清理后 1 轮；给锁消失/新持有者竞态留余量） */
const MAX_ACQUIRE_ATTEMPTS = 4

/** 库路径校验+规范化（锁与库共用同一口径；非法 → CONFIG_INVALID） */
function resolveLedgerPath(dbPath: string): string {
  if (typeof dbPath !== 'string' || dbPath.trim() === '') {
    configInvalid('writer-lease-path-invalid', 'dbPath 必须是非空字符串')
  }
  return resolve(dbPath)
}

/** 锁路径（唯一口径源；dbPath 非法 → CONFIG_INVALID）：`<resolve(dbPath)>.writer.lock` */
export function writerLeasePath(dbPath: string): string {
  return `${resolveLedgerPath(dbPath)}.writer.lock`
}

/** 取错误码（ENOENT/EEXIST/ESRCH…；非 fs 错误返 undefined） */
function errnoOf(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** 错误文本（内联用；与 store 其它面同风格） */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 错误文本脱敏：锁文件/库文件绝对路径替换为占位符（runtime 错误不把本机路径写进日志证据） */
function sanitize(message: string, ...paths: readonly string[]): string {
  let out = message
  for (const target of paths) {
    if (target === '') continue
    out = out.split(target).join('<ledger>').split(resolve(target)).join('<ledger>')
  }
  return out
}

/** 构造 STALL 分类 Error（message 首段 `STALL/<subcause>`，与 configInvalid 同风格） */
function stall(subcause: string, detail?: string): Error & ClassifiedError {
  const err = new Error(`STALL/${subcause}${detail === undefined ? '' : `：${detail}`}`) as Error &
    ClassifiedError
  err.category = 'STALL'
  err.subcause = subcause
  if (detail !== undefined) err.detail = detail
  return err
}

/** 已分类错误判定（保留原始分类，不二次包装） */
function isClassifiedError(err: unknown): err is Error & ClassifiedError {
  if (typeof err !== 'object' || err === null) return false
  const candidate = err as { category?: unknown; subcause?: unknown }
  return typeof candidate.category === 'string' && typeof candidate.subcause === 'string'
}

/** 进程存活判定：ESRCH=死；EPERM/其它=按存活处理（fail-closed，宁拒绝不双写） */
function isProcessAlive(pid: number): boolean {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return errnoOf(err) !== 'ESRCH'
  }
}

/** 锁内容解析：缺字段/类型不符=undefined（调用方按 unreadable fail-closed） */
function parseLeaseRecord(raw: string): LeaseFileContent | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const obj = parsed as Record<string, unknown>
  const pid = obj['pid']
  const owner = obj['owner']
  const at = obj['at']
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return undefined
  if (typeof owner !== 'string' || owner.trim() === '') return undefined
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) return undefined
  return { pid, owner, at }
}

/** 读锁文件原文：缺失=undefined；其它 IO 失败=STALL/writer-lease-io（不吞分类） */
function readLockRaw(lockPath: string): string | undefined {
  try {
    return readFileSync(lockPath, 'utf8')
  } catch (err) {
    if (errnoOf(err) === 'ENOENT') return undefined
    throw stall('writer-lease-io', `读取锁文件失败：${sanitize(errorMessage(err), lockPath)}`)
  }
}

/** 释放路径用的静默读：任何失败都当「读不到」（release 只做保守删除，不抛） */
function readLockRawQuietly(lockPath: string): string | undefined {
  try {
    return readFileSync(lockPath, 'utf8')
  } catch {
    return undefined
  }
}

/** 关闭 fd（失败不覆盖原始错误；连接随进程回收） */
function closeQuietly(fd: number): void {
  try {
    closeSync(fd)
  } catch {
    // 不覆盖原始分类
  }
}

/** 创建锁文件的 IO 失败分类：父目录不存在=路径问题；其余=STALL/io */
function classifyCreateFailure(err: unknown, lockPath: string): Error & ClassifiedError {
  if (errnoOf(err) === 'ENOENT') {
    configInvalid(
      'writer-lease-path-invalid',
      `锁文件父目录不存在：${sanitize(errorMessage(err), lockPath)}`,
    )
  }
  return stall('writer-lease-io', `创建锁文件失败：${sanitize(errorMessage(err), lockPath)}`)
}

/** 构造持有者冲突错误（detail 含持有者 pid/owner/at；message 首段 STALL/writer-lease-held） */
function heldError(holder: LeaseFileContent): Error & ClassifiedError {
  const detail = `台账写者租约已被 pid=${holder.pid} owner=${holder.owner} 持有（at=${holder.at}）；拒绝并发打开，未覆盖持锁文件`
  return stall('writer-lease-held', detail)
}

/** 把已写入的锁包装成句柄：release 按写入原文逐字校验（不误删他人锁） */
function makeLease(
  dbPath: string,
  lockPath: string,
  record: LeaseFileContent,
  writtenRaw: string,
): WriterLease {
  let released = false
  return {
    dbPath,
    lockPath,
    pid: record.pid,
    owner: record.owner,
    acquiredAt: record.at,
    release(): boolean {
      // 防旧 handle 误删同毫秒重取的新锁（同 pid/owner/at 时内容会逐字相同）
      if (released) return false
      released = true
      const current = readLockRawQuietly(lockPath)
      if (current === undefined || current !== writtenRaw) return false
      try {
        unlinkSync(lockPath)
        return true
      } catch {
        // 只删自己的锁：删除失败（IO/竞态）不抛、返回 false，残留由死 pid 清理兜底
        return false
      }
    },
  }
}

/**
 * 取台账写者租约（排他创建 `<db>.writer.lock`）。
 *
 * @param dbPath 台账库路径（内部 `path.resolve`；锁文件与库文件同目录）
 * @param owner  持有者标识（非空串；写进锁文件，拒绝时出现在 detail 里）
 * @throws CONFIG_INVALID/writer-lease-path-invalid|owner-invalid（入参/父目录）
 * @throws STALL/writer-lease-held（持有者进程存活；不覆盖、不等待）
 * @throws STALL/writer-lease-unreadable（锁内容不可解析；fail-closed）
 * @throws STALL/writer-lease-io（创建/读写/清理 IO 失败）
 * @throws STALL/writer-lease-contended（清理死锁一次后仍抢不到）
 */
export function acquireWriterLease(dbPath: string, owner: string): WriterLease {
  if (typeof owner !== 'string' || owner.trim() === '') {
    configInvalid('writer-lease-owner-invalid', 'owner 必须是非空字符串')
  }
  const target = resolveLedgerPath(dbPath)
  const lockPath = `${target}.writer.lock`
  const record: LeaseFileContent = { pid: process.pid, owner, at: Date.now() }
  const writtenRaw = `${JSON.stringify(record)}\n`
  /** 死 pid 只清理一次：防止两个新写者在同一把死锁上互相删除 */
  let cleanedDeadLock = false

  for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
    let fd: number
    try {
      fd = openSync(lockPath, 'wx', 0o600)
    } catch (err) {
      if (errnoOf(err) !== 'EEXIST') throw classifyCreateFailure(err, lockPath)
      // —— 已有锁：判持有者生死 ——
      const raw = readLockRaw(lockPath)
      if (raw === undefined) continue // 竞态：锁在 EEXIST 后消失，重试创建
      const holder = parseLeaseRecord(raw)
      if (holder === undefined) {
        throw stall(
          'writer-lease-unreadable',
          `锁文件存在但内容不可解析（pid/owner/at 非法）：${sanitize(raw.trim(), lockPath)}；` +
            '拒绝自动清理无法证明死亡的锁（fail-closed）',
        )
      }
      if (isProcessAlive(holder.pid)) throw heldError(holder)
      if (cleanedDeadLock) {
        throw stall(
          'writer-lease-contended',
          `已清理一次死 pid 锁（pid=${holder.pid} owner=${holder.owner}）后仍被占用；` +
            '不再二次清理（避免与新写者互删）',
        )
      }
      cleanedDeadLock = true
      // 清理前复核内容未被换手：内容变了就回循环重新判（不删别人的新锁）
      const again = readLockRaw(lockPath)
      if (again === undefined) continue
      if (again !== raw) continue
      try {
        unlinkSync(lockPath)
      } catch (unlinkErr) {
        if (errnoOf(unlinkErr) !== 'ENOENT') {
          throw stall(
            'writer-lease-io',
            `清理死 pid 锁失败：${sanitize(errorMessage(unlinkErr), lockPath)}`,
          )
        }
      }
      continue
    }

    // —— 赢家：写内容（pid/owner/at）→ fsync → 关闭 ——
    try {
      const written = writeSync(fd, writtenRaw)
      if (written !== Buffer.byteLength(writtenRaw, 'utf8')) {
        throw new Error(`写入字节数不符（${written}/${Buffer.byteLength(writtenRaw, 'utf8')}）`)
      }
      fsyncSync(fd)
    } catch (err) {
      closeQuietly(fd)
      try {
        unlinkSync(lockPath)
      } catch {
        // 刚创建的锁清理失败：不覆盖原始 IO 分类；残留由下次启动处理
      }
      throw stall('writer-lease-io', `写入锁内容失败：${sanitize(errorMessage(err), lockPath)}`)
    }
    try {
      closeSync(fd)
    } catch (err) {
      try {
        unlinkSync(lockPath)
      } catch {
        // 同上：不覆盖原始 IO 分类
      }
      throw stall('writer-lease-io', `关闭锁文件失败：${sanitize(errorMessage(err), lockPath)}`)
    }
    return makeLease(target, lockPath, record, writtenRaw)
  }

  throw stall('writer-lease-contended', `重试 ${MAX_ACQUIRE_ATTEMPTS} 轮仍未能取得写者租约`)
}

/**
 * 打开**受围栏约束**的台账写者：先取 lease → `openLedger`。
 *
 * 失败分类：
 *   - 取租约失败 → 原样上抛（CONFIG_INVALID/STALL 见 `acquireWriterLease`）；
 *   - `openLedger`（建库/migrate）失败 → **先释放本次 lease** 再上抛：已分类错误
 *     （CONFIG_INVALID/EVOLVE_REJECT 等）原样保留；未分类引擎错误包装为
 *     `STALL/db-open-failed`（detail 脱敏），不把租约留给下一个写者。
 *
 * `close()` 顺序：先 `db.close()`（原句柄），成功后释放 lease。关库失败时**不释放**租约
 * ——库句柄可能仍持有，放进第二个写者就是双写；残留锁由下次启动按死 pid 清理。
 * close 幂等（重复调用不再关库/释放）。**必须经 `close()`**：直接 `ledger.db.close()`
 * 会绕过租约释放（锁残留到下次启动的死 pid 清理）。
 *
 * @param dbPath 台账库路径
 * @param owner  持有者标识（缺省 `writer:<pid>`；写入锁文件）
 */
export function openLedgerWriter(dbPath: string, owner: string = `writer:${process.pid}`): Ledger {
  const lease = acquireWriterLease(dbPath, owner)
  let ledger: Ledger
  try {
    ledger = openLedger(lease.dbPath)
  } catch (err) {
    lease.release()
    if (isClassifiedError(err)) throw err
    throw stall(
      'db-open-failed',
      `台账打开/迁移失败：${sanitize(errorMessage(err), lease.dbPath)}；本次写者租约已释放`,
    )
  }

  let closed = false
  return {
    ...ledger,
    close(): void {
      if (closed) return
      ledger.close()
      closed = true
      lease.release()
    },
  }
}
