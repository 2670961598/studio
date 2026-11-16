import { createMemoryStore } from './memory-store.ts'
import { createSqliteStore } from './sqlite-store.ts'
import { createPlatform } from './service.ts'
import type { IssuesOptions, IssuesPlatform } from './types.ts'

/**
 * `@studio-next/issues` — standalone first slice of the StudioNext issue
 * platform (plan v0.8). Public surface: DTOs, opaque cursors, stable error codes
 * and a host-facing daemon port. The storage port, adapters and SQL stay
 * internal (Part 2d §7.7.6).
 */

export { IssuesError, isIssuesError, isIssuesErrorCode } from './errors.ts'
export type { IssuesErrorCode } from './errors.ts'
export { STATE_CATALOG } from './catalog.ts'

export type {
  ActionName,
  ActorKind,
  AddCommentInput,
  AddCommentResult,
  AddEvidenceInput,
  ArchiveInput,
  ArchiveResult,
  AssignInput,
  BatchAddCommentItem,
  BatchAddCommentsInput,
  BatchItemError,
  BatchItemResult,
  BatchResult,
  BatchTransitionItem,
  BatchTransitionTicketsInput,
  CloseInput,
  CloseResult,
  Comment,
  CreatePrincipalInput,
  CreateProjectInput,
  CreateTicketInput,
  DaemonPort,
  DescendantNode,
  EventActor,
  EventEnvelope,
  Evidence,
  EvidenceKind,
  GateRequirements,
  GateRun,
  GetCommentsInput,
  GetCommentsResult,
  GetGateRunInput,
  GetTicketInput,
  GetTicketsInput,
  GetTicketsResult,
  GovernanceInput,
  GrantMembershipInput,
  IssuesOptions,
  IssuesPlatform,
  JsonObject,
  JsonValue,
  ListChildrenInput,
  ListCommentsInput,
  ListDescendantsInput,
  ListEventsInput,
  ListEvidenceInput,
  ListProjectEventsInput,
  ListTicketsInput,
  MembershipView,
  Page,
  Principal,
  PrincipalKind,
  Project,
  ProjectPolicy,
  ReassignInput,
  RecordGateEvidenceInput,
  RecordGateEvidenceResult,
  ReopenInput,
  ReopenResult,
  ReparentInput,
  Role,
  StateInfo,
  Ticket,
  TicketKind,
  TicketServiceApi,
  TicketSummary,
  TicketView,
  TransitionInput,
  TransitionResult,
  UpdatePolicyInput,
  UpdateTicketInput,
} from './types.ts'

/** Memory-backed platform (tests, demos). */
export function createMemoryIssues(options: IssuesOptions = {}): IssuesPlatform {
  return createPlatform(createMemoryStore(), options)
}

/**
 * File-backed platform. The caller supplies only engine-neutral options; the
 * adapter owns every storage-engine concern (version pin, journaling, DDL).
 */
export function createSqliteIssues(path: string, options: IssuesOptions = {}): IssuesPlatform {
  return createPlatform(createSqliteStore(path), options)
}
