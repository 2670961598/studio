#!/usr/bin/env node
// backup-wrapper —— launchd → node → bash 转接（TCC：node 具 FDA，bash/sqlite3 直起读不了外置数据盘）
// 用法：node backup-wrapper.mjs <script> [args...]
import { spawn } from 'node:child_process'
const [script, ...args] = process.argv.slice(2)
if (!script) { console.error('backup-wrapper: 缺 script 参数'); process.exit(2) }
const child = spawn('/bin/bash', [script, ...args], { stdio: 'inherit', env: process.env, cwd: process.env.HOME ?? '/' })
child.on('exit', (code, signal) => { if (signal) { console.error(`backup-wrapper: child killed by ${signal}`); process.exit(1) } process.exit(code ?? 1) })
child.on('error', (err) => { console.error('backup-wrapper: spawn error:', err.message); process.exit(1) })
