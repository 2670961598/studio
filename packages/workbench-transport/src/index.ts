/** WorkbenchTransport v1 公共入口（P1-1a） */
export { WorkbenchTransport, WORKBENCH_TRANSPORT_PROTOCOL } from './client.ts'
export type { WorkbenchTransportOptions } from './client.ts'
export { WorkbenchTransportError } from './errors.ts'
export { WB_ERROR_CODES } from './types.ts'
export type {
  AckResult,
  ClaimResult,
  HealthResult,
  InboxResult,
  Message,
  MessagePage,
  ReadResult,
  Room,
  SendResult,
  Wake,
  WbError,
  WbErrorCode,
  WbMethod,
  WbRequest,
  WbResponse,
} from './types.ts'
