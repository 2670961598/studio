import type { WbError, WbErrorCode } from './types.ts'

/** 传输层稳定错误（code 来自冻结词表；socket/timeout 也归稳定码，不抛裸 Error 给调用方） */
export class WorkbenchTransportError extends Error {
  readonly code: WbErrorCode
  readonly retryable: boolean
  readonly details: Readonly<Record<string, unknown>> | undefined
  constructor(error: WbError) {
    super(`${error.code}: ${error.message}`)
    this.name = 'WorkbenchTransportError'
    this.code = error.code
    this.retryable = error.retryable ?? false
    this.details = error.details
  }
}
