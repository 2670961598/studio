/**
 * 测试支撑：WorkbenchTransport v1 真客户端驱动器会话（仅测试用；P1-2 wake lease 最小刀）。
 * 与 contract.nt.ts 内同名会话同构：spawn packages/workbench-transport/test/support/chatd-driver.ts
 * 子进程（真客户端），按 stage 消费其 stdout NDJSON 事件。chatd 与 transport 两包互不 import
 * （分层宪法 20-§十五），经子进程组合成真 socket 契约。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { CHATD_DRIVER } from './proc.ts'
import { sleep } from './proc.ts'

export interface DriverEvent {
  readonly stage: string
  readonly [key: string]: unknown
}

export class DriverSession {
  private readonly events: DriverEvent[] = []
  private exitCode: number | null = null
  private exited = false
  private stderrText = ''
  private readonly proc: ChildProcess

  constructor(args: string[]) {
    this.proc = spawn(process.execPath, ['--experimental-strip-types', CHATD_DRIVER, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    let buffer = ''
    this.proc.stdout?.setEncoding('utf8')
    this.proc.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
        if (line.trim() === '') continue
        this.events.push(JSON.parse(line) as DriverEvent)
      }
    })
    this.proc.stderr?.setEncoding('utf8')
    this.proc.stderr?.on('data', (chunk: string) => { this.stderrText += chunk })
    this.proc.once('exit', (code) => {
      this.exited = true
      this.exitCode = code
    })
  }

  async waitFor(stage: string, timeoutMs = 10_000): Promise<DriverEvent> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const index = this.events.findIndex((e) => e.stage === stage)
      if (index >= 0) return this.events.splice(index, 1)[0] as DriverEvent
      if (this.exited) throw new Error(`驱动器已退出（code=${String(this.exitCode)}）等不到 ${stage}；events=${JSON.stringify(this.events)} stderr=${this.stderrText}`)
      if (Date.now() > deadline) throw new Error(`等待事件 ${stage} 超时；events=${JSON.stringify(this.events)} stderr=${this.stderrText}`)
      await sleep(20)
    }
  }

  /** 尚未被 waitFor 消费的事件。 */
  collected(): readonly DriverEvent[] {
    return this.events
  }

  release(line: string): void {
    this.proc.stdin?.write(`${line}\n`)
  }

  async done(timeoutMs = 10_000): Promise<number> {
    const deadline = Date.now() + timeoutMs
    while (!this.exited) {
      if (Date.now() > deadline) throw new Error(`等待驱动器退出超时；events=${JSON.stringify(this.events)} stderr=${this.stderrText}`)
      await sleep(20)
    }
    return this.exitCode ?? -1
  }
}
