import { readFileSync, lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'
import { IssuesError } from './errors.ts'
import type { JsonObject } from './types.ts'
import { MAX_EVIDENCE_BYTES } from './catalog.ts'
import { sha256Bytes } from './util.ts'

/**
 * Evidence is a bound reference, not a free path (Part 1 §3.3 / F4):
 * root-relative only, `sha256` computed by the platform rather than trusted from
 * the caller, symlink/dir/FIFO/absolute/`..`/scheme references rejected, and the
 * on-disk hash re-checked when a verdict is validated at `T7`.
 *
 * The `artifact://` scheme is accepted by the plan for artifacts outside the
 * evidence root; this slice supports only root-relative files (README gap).
 */

export interface EvidenceFileInfo {
  uri: string
  sha256: string
  bytes: number
}

export function inspectEvidenceFile(
  evidenceRoot: string | null,
  uri: unknown,
): EvidenceFileInfo {
  const checkedUri = validateUriShape(uri)
  const absolutePath = resolveContainedPath(evidenceRoot, checkedUri)
  const buffer = readEvidenceBuffer(absolutePath, checkedUri, 'EVIDENCE_PATH_INVALID')
  return {
    uri: normalizeUri(checkedUri),
    sha256: sha256Bytes(buffer),
    bytes: buffer.byteLength,
  }
}

/** Re-hash at `T7`/verdict validation; a swap or deletion is `EVIDENCE_INVALIDATED`. */
export function verifyEvidenceFile(
  evidenceRoot: string | null,
  uri: string,
  expectedSha256: string,
): void {
  const absolutePath = resolveContainedPath(evidenceRoot, uri)
  let buffer: Buffer
  try {
    buffer = readEvidenceBuffer(absolutePath, uri, 'EVIDENCE_INVALIDATED')
  } catch (error) {
    if (error instanceof IssuesError) throw error
    throw new IssuesError('EVIDENCE_INVALIDATED', 'evidence file is no longer readable', { uri })
  }
  const actual = sha256Bytes(buffer)
  if (actual !== expectedSha256) {
    throw new IssuesError('EVIDENCE_INVALIDATED', 'evidence content hash no longer matches', {
      uri,
      expectedSha256,
      actualSha256: actual,
    })
  }
}

function invalidPath(reason: string): IssuesError {
  return new IssuesError('EVIDENCE_PATH_INVALID', reason, { code: 'EVIDENCE_PATH_INVALID' })
}

function validateUriShape(uri: unknown): string {
  if (typeof uri !== 'string' || uri.length === 0) {
    throw invalidPath('evidence uri must be a non-empty string')
  }
  if (uri.length > 1024) throw invalidPath('evidence uri is too long')
  if (uri.includes('\u0000')) throw invalidPath('evidence uri must not contain NUL')
  if (uri.includes('\\')) throw invalidPath('evidence uri must use forward slashes')
  if (isAbsolute(uri)) throw invalidPath('absolute evidence paths are rejected')
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(uri)) {
    throw invalidPath('evidence uri must be root-relative; url/file schemes are rejected')
  }
  const segments = uri.split('/')
  for (const segment of segments) {
    if (segment === '..') throw invalidPath('evidence uri must not contain .. segments')
  }
  return uri
}

function normalizeUri(uri: string): string {
  return uri
    .split('/')
    .filter(segment => segment !== '' && segment !== '.')
    .join('/')
}

function resolveContainedPath(evidenceRoot: string | null, uri: string): string {
  if (evidenceRoot === null) {
    throw new IssuesError('EVIDENCE_PATH_INVALID', 'no evidence root is configured', {
      code: 'EVIDENCE_ROOT_MISSING',
    })
  }
  const root = resolve(evidenceRoot)
  const checkedUri = normalizeUri(validateUriShape(uri))
  if (checkedUri.length === 0 || checkedUri === '.') {
    throw invalidPath('evidence uri must name a file, not the root directory')
  }
  const candidate = resolve(root, checkedUri)
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw invalidPath('evidence path escapes the configured root')
  }
  let stat
  try {
    stat = lstatSync(candidate)
  } catch {
    throw new IssuesError('EVIDENCE_PATH_INVALID', 'evidence file does not exist', {
      code: 'EVIDENCE_FILE_MISSING',
      uri,
    })
  }
  if (stat.isSymbolicLink()) throw invalidPath('symlink evidence is rejected')
  if (stat.isDirectory()) throw invalidPath('directory evidence is rejected')
  if (!stat.isFile()) throw invalidPath('evidence must be a regular file')
  if (stat.size > MAX_EVIDENCE_BYTES) {
    throw new IssuesError('EVIDENCE_PATH_INVALID', 'evidence file exceeds 64 MiB', {
      code: 'EVIDENCE_TOO_LARGE',
      uri,
      bytes: stat.size,
    })
  }
  let realRoot: string
  let realCandidate: string
  try {
    realRoot = realpathSync(root)
    realCandidate = realpathSync(candidate)
  } catch {
    throw invalidPath('evidence path cannot be resolved')
  }
  if (realCandidate !== realRoot && !realCandidate.startsWith(realRoot + sep)) {
    throw invalidPath('evidence real path escapes the configured root')
  }
  return realCandidate
}

function readEvidenceBuffer(
  absolutePath: string,
  uri: string,
  code: 'EVIDENCE_PATH_INVALID' | 'EVIDENCE_INVALIDATED',
): Buffer {
  try {
    return readFileSync(absolutePath)
  } catch {
    throw new IssuesError(code, 'evidence file is not readable', { uri })
  }
}

export function evidencePathDetails(error: unknown): JsonObject | null {
  if (error instanceof IssuesError && error.details !== undefined) {
    const details: Record<string, unknown> = { ...error.details }
    const mapped: JsonObject = {}
    for (const [key, value] of Object.entries(details)) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value === null
      ) {
        mapped[key] = value
      }
    }
    return mapped
  }
  return null
}
