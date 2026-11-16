import type {
  AddCommentInput,
  AddCommentResult,
  AddEvidenceInput,
  ArchiveInput,
  ArchiveResult,
  AssignInput,
  BatchAddCommentsInput,
  BatchResult,
  BatchTransitionTicketsInput,
  CloseInput,
  CloseResult,
  Comment,
  CreatePrincipalInput,
  CreateProjectInput,
  CreateTicketInput,
  DaemonPort,
  DescendantNode,
  EventEnvelope,
  Evidence,
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
  Project,
  ReassignInput,
  ReopenInput,
  ReopenResult,
  ReparentInput,
  Ticket,
  TicketServiceApi,
  TicketSummary,
  TicketView,
  TransitionInput,
  TransitionResult,
  UpdatePolicyInput,
  UpdateTicketInput,
} from './types.ts'
import type { GateRunRow, TicketStore } from './store.ts'
import { ServiceCore } from './core.ts'
import type { ServiceCoreOptions } from './core.ts'
import {
  createPrincipal,
  createProject,
  getProject,
  grantMembership,
  updatePolicy,
} from './service-admin.ts'
import {
  archive,
  assign,
  createTicket,
  getTicket,
  governance,
  listTickets,
  reassign,
  updateTicket,
} from './service-tickets.ts'
import { close, reopen, transition } from './service-workflow.ts'
import {
  addComment,
  listChildren,
  listComments,
  listDescendants,
  reparent,
} from './service-parent-comment.ts'
import { DaemonGate, addEvidence, getGateRun, listEvidence } from './service-evidence.ts'
import { getComments, getTickets, listEvents, listProjectEvents } from './service-queries.ts'
import { batchAddComments, batchTransitionTickets } from './service-batch.ts'

/** Public service surface. The store port and SQL are never reachable from it. */
export class TicketService implements TicketServiceApi {
  private readonly core: ServiceCore
  readonly daemon: DaemonPort

  constructor(store: TicketStore, options: IssuesOptions = {}) {
    const coreOptions: ServiceCoreOptions = {}
    if (options.now !== undefined) coreOptions.now = options.now
    if (options.newId !== undefined) coreOptions.newId = options.newId
    if (options.cursorKey !== undefined) coreOptions.cursorKey = options.cursorKey
    if (options.evidenceRoot !== undefined) coreOptions.evidenceRoot = options.evidenceRoot
    if (options.defaultPolicy !== undefined) coreOptions.defaultPolicy = options.defaultPolicy
    this.core = new ServiceCore(store, coreOptions)
    this.daemon = new DaemonGate(this.core)
  }

  createPrincipal(input: CreatePrincipalInput): Promise<Principal> {
    return createPrincipal(this.core, input)
  }

  createProject(actorId: string, input: CreateProjectInput): Promise<Project> {
    return createProject(this.core, actorId, input)
  }

  grantMembership(actorId: string, input: GrantMembershipInput): Promise<MembershipView> {
    return grantMembership(this.core, actorId, input)
  }

  getProject(actorId: string, projectId: string): Promise<Project> {
    return getProject(this.core, actorId, projectId)
  }

  updatePolicy(actorId: string, input: UpdatePolicyInput): Promise<Project> {
    return updatePolicy(this.core, actorId, input)
  }

  createTicket(actorId: string, input: CreateTicketInput): Promise<Ticket> {
    return createTicket(this.core, actorId, input)
  }

  getTicket(actorId: string, input: GetTicketInput): Promise<TicketView> {
    return getTicket(this.core, actorId, input)
  }

  listTickets(actorId: string, input: ListTicketsInput): Promise<Page<TicketSummary>> {
    return listTickets(this.core, actorId, input)
  }

  updateTicket(actorId: string, input: UpdateTicketInput): Promise<Ticket> {
    return updateTicket(this.core, actorId, input)
  }

  assign(actorId: string, input: AssignInput): Promise<Ticket> {
    return assign(this.core, actorId, input)
  }

  reassign(actorId: string, input: ReassignInput): Promise<Ticket> {
    return reassign(this.core, actorId, input)
  }

  governance(actorId: string, input: GovernanceInput): Promise<Ticket> {
    return governance(this.core, actorId, input)
  }

  transition(actorId: string, input: TransitionInput): Promise<TransitionResult> {
    return transition(this.core, actorId, input)
  }

  reopen(actorId: string, input: ReopenInput): Promise<ReopenResult> {
    return reopen(this.core, actorId, input)
  }

  close(actorId: string, input: CloseInput): Promise<CloseResult> {
    return close(this.core, actorId, input)
  }

  archive(actorId: string, input: ArchiveInput): Promise<ArchiveResult> {
    return archive(this.core, actorId, input)
  }

  addComment(actorId: string, input: AddCommentInput): Promise<AddCommentResult> {
    return addComment(this.core, actorId, input)
  }

  listComments(actorId: string, input: ListCommentsInput): Promise<Page<Comment>> {
    return listComments(this.core, actorId, input)
  }

  reparent(actorId: string, input: ReparentInput): Promise<Ticket> {
    return reparent(this.core, actorId, input)
  }

  listChildren(actorId: string, input: ListChildrenInput): Promise<TicketSummary[]> {
    return listChildren(this.core, actorId, input)
  }

  listDescendants(actorId: string, input: ListDescendantsInput): Promise<DescendantNode[]> {
    return listDescendants(this.core, actorId, input)
  }

  addEvidence(actorId: string, input: AddEvidenceInput): Promise<Evidence> {
    return addEvidence(this.core, actorId, input)
  }

  listEvidence(actorId: string, input: ListEvidenceInput): Promise<Evidence[]> {
    return listEvidence(this.core, actorId, input)
  }

  getGateRun(actorId: string, input: GetGateRunInput): Promise<GateRun | null> {
    return getGateRun(this.core, actorId, input)
  }

  listEvents(actorId: string, input: ListEventsInput): Promise<Page<EventEnvelope>> {
    return listEvents(this.core, actorId, input)
  }

  listProjectEvents(
    actorId: string,
    input: ListProjectEventsInput,
  ): Promise<Page<EventEnvelope>> {
    return listProjectEvents(this.core, actorId, input)
  }

  getTickets(actorId: string, input: GetTicketsInput): Promise<GetTicketsResult> {
    return getTickets(this.core, actorId, input)
  }

  getComments(actorId: string, input: GetCommentsInput): Promise<GetCommentsResult> {
    return getComments(this.core, actorId, input)
  }

  batchAddComments(
    actorId: string,
    input: BatchAddCommentsInput,
  ): Promise<BatchResult<Comment>> {
    return batchAddComments(this.core, actorId, input)
  }

  batchTransitionTickets(
    actorId: string,
    input: BatchTransitionTicketsInput,
  ): Promise<BatchResult<TransitionResult>> {
    return batchTransitionTickets(this.core, actorId, input)
  }
}

/** Assemble a platform over any TicketStore implementation (contract tests use this). */
export function createPlatform(store: TicketStore, options: IssuesOptions = {}): {
  service: TicketService
  daemon: DaemonPort
  close: () => void
} {
  const service = new TicketService(store, options)
  return {
    service,
    daemon: service.daemon,
    close: () => store.close(),
  }
}

/** Internal helper: the row type used by adapters for gate verdicts. */
export type { GateRunRow }
