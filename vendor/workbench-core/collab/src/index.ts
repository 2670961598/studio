import { MemoryChatStore } from './memory-store.ts'
import { ChatService } from './service.ts'
import { SqliteChatStore } from './sqlite-store.ts'
import type { CollabOptions } from './types.ts'

export { CollabError, isCollabError } from './errors.ts'
export type { CollabErrorCode, CollabErrorDetails } from './errors.ts'
export { ChatService } from './service.ts'
export { ACTOR_ID_HINT, ACTOR_ID_PATTERN, dmKey, dmPair } from './keys.ts'
export type {
  AckDeliveryInput,
  AckFailure,
  AckResult,
  Actor,
  ActorKind,
  ActorStatus,
  BatchGetResult,
  BatchItemError,
  BatchItemResult,
  BatchResult,
  CheckInboxInput,
  CollabOptions,
  CreateActorInput,
  CreateGroupRoomInput,
  GetMessagesInput,
  GetWakeStateInput,
  InboxDigest,
  InboxRoomDigest,
  LastMessageMeta,
  ListMessagesInput,
  MarkReadInput,
  MarkReadResult,
  MemberRole,
  MentionDigest,
  Message,
  MessageKind,
  MessagePage,
  ReadState,
  Room,
  RoomKind,
  RoomMember,
  RoomNameInput,
  RoomStats,
  SendMessageInput,
  SendResult,
  WakeCause,
  WakeChannel,
  WakePriority,
  WakeState,
  WakeStatus,
} from './types.ts'

/** In-memory kernel: tests, demos, embedded host with no persistence. */
export function createMemoryCollab(options: CollabOptions = {}): ChatService {
  return new ChatService(new MemoryChatStore(), options)
}

/**
 * SQLite-backed kernel (the production default): single process, single writer,
 * WAL. This factory is the only place the engine-specific adapter is named; no
 * SQLite type, SQL text or row id crosses the public API.
 */
export function createSqliteCollab(path: string, options: CollabOptions = {}): ChatService {
  return new ChatService(new SqliteChatStore(path), options)
}
