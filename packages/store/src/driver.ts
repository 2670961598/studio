/**
 * driver —— node:sqlite 打开边界（本包唯一的引擎触点）
 *
 * 探测结论（2026-10-16，v0.2 首刀前置探测，如实记录）：
 *   - 仓内登记选型「node:sqlite + drizzle migration」（docs/16-§二），骨架期 package.json
 *     预挂了 drizzle-orm ^0.44.0；实测 **drizzle-orm 稳定线（0.44.7 / 最新 0.45.4）不含
 *     node:sqlite 驱动**（tarball 无 node-sqlite/ 目录，仅 better-sqlite3/bun-sqlite/libsql 等）。
 *   - node:sqlite 驱动（drizzle-orm/node-sqlite + migrator）只存在于 **1.0.0-RC 线**
 *     （1.0.0-rc.4 tarball 实测含 node-sqlite/driver.js 与 migrator）；且 drizzle-kit 迁移
 *     工具对 node:sqlite 无驱动支持（drizzle-orm #5471），migration 反正要手写。
 *   - 结论：按任务预案走「不支持」分支——**纯 node:sqlite（DatabaseSync 原生 API）+
 *     手写薄 migration runner（migrations.ts，schema_version 表）**；drizzle 留待后续单
 *     （待其稳定线带 node-sqlite 驱动后再评估），drizzle-orm 依赖已从 package.json 移除。
 *
 * 风险与回退（docs/16-§六）：node:sqlite RC → better-sqlite3 一行切换。
 * **全部引擎调用收口在本文件 + 各模块经 Ledger.db 句柄使用 DatabaseSync 标准面**；
 * 换引擎时只改本文件的 open()，DDL/语句不感知（语句本身是标准 SQL）。
 *
 * PRAGMA 对齐（骨架 TODO「WAL、busy_timeout、PRAGMA 对齐」落地）：
 *   journal_mode=WAL（单写多读）｜ synchronous=NORMAL（WAL 常规搭档）｜
 *   foreign_keys=ON（v1 三表暂无 FK，先对齐开关不留暗默）｜ busy_timeout=5000ms。
 */
import { DatabaseSync } from 'node:sqlite'

/**
 * 打开（或创建）SQLite 台账库文件，并对齐 PRAGMA。
 * path 为文件路径（测试/演习一律真文件，不用 :memory:——重建演习要真文件）。
 */
export function openSqlite(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  return db
}
