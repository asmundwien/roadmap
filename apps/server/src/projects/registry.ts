import { isAbsolute, normalize } from 'node:path'

export type ProjectRef = { integration: 'local' | 'github'; projectId: string }
export type LocalProjectRef = { integration: 'local'; projectId: string }
type GitHubProjectRef = { integration: 'github'; projectId: string }
export interface LocalConnection {
  id: string
  integration: 'local'
  name: string
  builtIn: true
}
export interface GitHubConnection {
  id: string
  integration: 'github'
  name: string
  builtIn: false
  githubIdentity: { id: string; login: string }
}
export type ConfiguredConnection = LocalConnection | GitHubConnection
interface RecordedLocalWorkspace {
  path: string
  gitIdentity?: string
}
export interface LocalProjectIntent {
  ref: LocalProjectRef
  connectionId: string
  displayName?: string
  workspace: RecordedLocalWorkspace
}
export interface GitHubProjectIntent {
  ref: GitHubProjectRef
  connectionId: string
  displayName?: string
  locator: { repositoryId: string; nameWithOwner: string }
  workspace: { path: string }
}
export type ProjectConfigurationIntent = LocalProjectIntent | GitHubProjectIntent
export interface LegacyHarnessCommand {
  command: string
  args: string[]
  promptDelivery: 'argument' | 'stdin'
}
export interface HarnessCommand extends LegacyHarnessCommand {
  promptTemplate: string
}
export interface ProjectConfiguration {
  schemaVersion: 6
  configurationVersion: number
  connections: ConfiguredConnection[]
  projects: ProjectConfigurationIntent[]
  automation: {
    enabled: boolean
    classificationCommand?: HarnessCommand
    wayfinderCommand?: HarnessCommand
    enabledProjects: { integration: 'local' | 'github'; id: string }[]
  }
}
export interface GitHubProviderRead {
  restGet(path: string): Promise<unknown>
  graphql(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<{
    readonly data: Record<string, unknown>
    readonly errors: readonly { readonly path: readonly (string | number)[] | null }[]
  }>
}
export interface GitHubConnectionAccess {
  connectionId: string
  accountId: string
  access: GitHubProviderRead
}
export type GitHubAccessFailure =
  | 'network'
  | 'malformed-response'
  | 'unavailable'
  | 'authorization-required'
  | 'rejected-credential'
  | 'account-mismatch'

/** Classified Connection access failure. Provider and credential details never cross this seam. */
export class GitHubAccessError extends Error {
  readonly failure: GitHubAccessFailure

  constructor(failure: GitHubAccessFailure) {
    super(
      failure === 'rejected-credential' ||
        failure === 'account-mismatch' ||
        failure === 'authorization-required'
        ? 'GitHub authorization must be renewed for this Connection.'
        : 'GitHub access is temporarily unavailable for this Connection.',
    )
    this.name = 'GitHubAccessError'
    this.failure = failure
  }
}

export interface AdmissionRuntime {
  github(connection: GitHubConnection): Promise<GitHubConnectionAccess>
}
export interface AdmissionFailure {
  code: 'admission-failed' | 'authorization-failed' | 'not-supported'
  message: string
  field?: string
  filesystemCode?: 'ENOENT' | 'EACCES' | 'other'
  githubAccessFailure?: GitHubAccessFailure
}
export type EvidenceResult<T> = { ok: true; value: T } | { ok: false; error: AdmissionFailure }
export interface LocalWorkspaceInspection {
  integration: 'local'
  path: string
  readable: true
  searchable: true
  gitIdentity?: string
}
export interface GitHubWorkspaceInspection {
  integration: 'github'
  path: string
  readable: true
  searchable: true
  worktreeRoot: true
  matchedRepositoryId: string
  verifiedConnectionId: string
  nameWithOwner: string
}
export interface GitHubSourceAccessEvidence {
  connectionId: string
  accountId: string
  repositoryId: string
  access: GitHubProviderRead
}
const localProofBrand: unique symbol = Symbol('LocalWorkspaceProof')
const githubProofBrand: unique symbol = Symbol('GitHubWorkspaceProof')
const sourceAccessBrand: unique symbol = Symbol('GitHubSourceAccess')
export interface LocalWorkspaceProof extends RecordedLocalWorkspace {
  readonly [localProofBrand]: true
}
interface GitHubWorkspaceProof {
  readonly path: string
  readonly matchedRepositoryId: string
  readonly verifiedConnectionId: string
  readonly [githubProofBrand]: true
}
export interface LocalProjectRegistration extends Omit<LocalProjectIntent, 'workspace'> {
  workspace: LocalWorkspaceProof
}
interface GitHubProjectRegistration extends Omit<GitHubProjectIntent, 'workspace'> {
  workspace: GitHubWorkspaceProof
}
export interface GitHubSourceAccess {
  readonly ref: GitHubProjectRef
  readonly connectionId: string
  readonly accountId: string
  readonly repositoryId: string
  readonly locator: { readonly nameWithOwner: string }
  readonly access: GitHubProviderRead
  readonly [sourceAccessBrand]: true
}
type SourceAdmission =
  | { status: 'unverified' }
  | { status: 'ready'; value: LocalProjectRegistration | GitHubSourceAccess }
  | { status: 'unavailable'; error: AdmissionFailure }
export type WorkspaceAdmission =
  | { status: 'unverified' }
  | { status: 'admitted'; proof: LocalWorkspaceProof | GitHubWorkspaceProof }
  | { status: 'unavailable'; error: AdmissionFailure }
export interface ProjectAdmissionRecord {
  readonly intent: ProjectConfigurationIntent
  readonly source: SourceAdmission
  readonly workspace: WorkspaceAdmission
}
export interface CommittedConfiguration extends ProjectConfiguration {
  readonly admissions: readonly ProjectAdmissionRecord[]
}
export type AdmissionOutcome =
  | { integration: 'local'; workspace: EvidenceResult<LocalWorkspaceInspection> }
  | {
      integration: 'github'
      source: EvidenceResult<GitHubSourceAccessEvidence>
      workspace: EvidenceResult<GitHubWorkspaceInspection>
      locator?: { repositoryId: string; nameWithOwner: string }
    }
export interface ProjectAdmissionRequest {
  integration: 'local' | 'github'
  connection: ConfiguredConnection
  path: string
  displayName?: string
}
export interface ProjectRevalidationRequest {
  intent: ProjectConfigurationIntent
  connection: ConfiguredConnection
  path: string
}
export interface ProjectAdmission {
  admit(request: ProjectAdmissionRequest, runtime: AdmissionRuntime): Promise<AdmissionOutcome>
  repair(request: ProjectRevalidationRequest, runtime: AdmissionRuntime): Promise<AdmissionOutcome>
  revalidate(
    request: ProjectRevalidationRequest,
    runtime: AdmissionRuntime,
  ): Promise<AdmissionOutcome>
}
interface ProjectRegistrationIntent {
  integration: 'local' | 'github'
  connectionId: string
  path: string
  displayName?: string
}
export type RegistryMutation = EvidenceResult<{
  configuration: ProjectConfiguration
  project: ProjectRef
}>
export interface ProjectRegistry {
  prepare(
    configuration: ProjectConfiguration,
    previous?: CommittedConfiguration,
    options?: { revalidateConnections?: readonly string[] },
  ): Promise<CommittedConfiguration>
  admit(
    candidate: ProjectRegistrationIntent,
    configuration: CommittedConfiguration,
  ): Promise<RegistryMutation>
  repair(
    candidate: { project: ProjectRef; path: string },
    configuration: CommittedConfiguration,
  ): Promise<RegistryMutation>
  rename(
    candidate: { project: ProjectRef; displayName: string },
    configuration: CommittedConfiguration,
  ): RegistryMutation
  remove(project: ProjectRef, configuration: CommittedConfiguration): RegistryMutation
  resolveWorkspace(
    project: ProjectRef,
    configuration: CommittedConfiguration,
  ): Promise<WorkspaceAdmission>
}

export function refineLocalWorkspaceProof({
  inspection,
}: {
  inspection: LocalWorkspaceInspection
}): EvidenceResult<LocalWorkspaceProof> {
  if (
    inspection.integration !== 'local' ||
    inspection.readable !== true ||
    inspection.searchable !== true ||
    !canonical(inspection.path)
  ) {
    return failure('workspace.path', 'Choose a readable, searchable canonical local directory.')
  }
  return {
    ok: true,
    value: Object.freeze({
      path: inspection.path,
      ...(inspection.gitIdentity ? { gitIdentity: inspection.gitIdentity } : {}),
      [localProofBrand]: true,
    } satisfies LocalWorkspaceProof),
  }
}
function refineGitHubWorkspaceProof({
  inspection,
  connectionId,
  repositoryId,
}: {
  inspection: GitHubWorkspaceInspection
  connectionId: string
  repositoryId: string
}): EvidenceResult<GitHubWorkspaceProof> {
  if (
    inspection.integration !== 'github' ||
    inspection.readable !== true ||
    inspection.searchable !== true ||
    inspection.worktreeRoot !== true ||
    !canonical(inspection.path) ||
    inspection.verifiedConnectionId !== connectionId ||
    inspection.matchedRepositoryId !== repositoryId
  ) {
    return failure(
      'workspace.path',
      'Workspace evidence does not identify this repository through its Connection.',
    )
  }
  return {
    ok: true,
    value: Object.freeze({
      path: inspection.path,
      matchedRepositoryId: repositoryId,
      verifiedConnectionId: connectionId,
      [githubProofBrand]: true,
    } satisfies GitHubWorkspaceProof),
  }
}
export function refineGitHubSourceAccess({
  intent,
  connection,
  evidence,
}: {
  intent: GitHubProjectIntent
  connection: GitHubConnection
  evidence: GitHubSourceAccessEvidence
}): EvidenceResult<GitHubSourceAccess> {
  if (
    intent.ref.integration !== 'github' ||
    connection.integration !== 'github' ||
    connection.builtIn ||
    !connection.githubIdentity.id ||
    intent.connectionId !== connection.id ||
    evidence.connectionId !== connection.id ||
    evidence.accountId !== connection.githubIdentity.id ||
    evidence.repositoryId !== intent.locator.repositoryId ||
    typeof evidence.access?.restGet !== 'function' ||
    typeof evidence.access.graphql !== 'function'
  ) {
    return {
      ok: false,
      error: {
        code: 'authorization-failed',
        field: 'connectionId',
        message:
          'GitHub access does not belong to this repository and canonical Connection account.',
        githubAccessFailure:
          evidence.connectionId === connection.id &&
          evidence.accountId !== connection.githubIdentity.id
            ? 'account-mismatch'
            : 'unavailable',
      },
    }
  }
  return {
    ok: true,
    value: Object.freeze({
      ref: Object.freeze({ ...intent.ref }),
      connectionId: connection.id,
      accountId: connection.githubIdentity.id,
      repositoryId: intent.locator.repositoryId,
      locator: Object.freeze({ nameWithOwner: intent.locator.nameWithOwner }),
      access: evidence.access,
      [sourceAccessBrand]: true,
    } satisfies GitHubSourceAccess),
  }
}
export function createLocalProjectRegistration({
  ref,
  connection,
  workspace,
  displayName,
  projects = [],
}: {
  ref: LocalProjectRef
  connection: LocalConnection
  workspace: LocalWorkspaceProof
  displayName?: string
  projects?: readonly ProjectConfigurationIntent[]
}): EvidenceResult<LocalProjectRegistration> {
  if (
    ref.integration !== 'local' ||
    !ref.projectId.trim() ||
    connection.integration !== 'local' ||
    connection.id !== 'local' ||
    connection.builtIn !== true ||
    workspace[localProofBrand] !== true
  )
    return failure(
      'connectionId',
      'Local registration requires its built-in Connection and current Workspace proof.',
    )
  const intent: LocalProjectRegistration = {
    ref: Object.freeze({ ...ref }),
    connectionId: connection.id,
    workspace,
    ...name(displayName),
  }
  const occupied = checkOccupancy(intent, projects)
  return occupied ?? { ok: true, value: Object.freeze(intent) }
}
function createGitHubProjectRegistration({
  ref,
  connection,
  locator,
  workspace,
  displayName,
  projects = [],
}: {
  ref: GitHubProjectRef
  connection: GitHubConnection
  locator: GitHubProjectIntent['locator']
  workspace: GitHubWorkspaceProof
  displayName?: string
  projects?: readonly ProjectConfigurationIntent[]
}): EvidenceResult<GitHubProjectRegistration> {
  if (
    ref.integration !== 'github' ||
    !ref.projectId.trim() ||
    connection.integration !== 'github' ||
    connection.builtIn !== false ||
    !connection.githubIdentity.id ||
    !locator.repositoryId ||
    !locator.nameWithOwner ||
    workspace[githubProofBrand] !== true ||
    workspace.verifiedConnectionId !== connection.id ||
    workspace.matchedRepositoryId !== locator.repositoryId
  )
    return failure(
      'workspace.path',
      'GitHub registration requires matching repository, Connection and current Workspace proof.',
    )
  const intent: GitHubProjectRegistration = {
    ref: Object.freeze({ ...ref }),
    connectionId: connection.id,
    locator: Object.freeze({ ...locator }),
    workspace,
    ...name(displayName),
  }
  const occupied = checkOccupancy(intent, projects)
  return occupied ?? { ok: true, value: Object.freeze(intent) }
}

export function createProjectRegistry({
  admissions,
  runtime,
}: {
  admissions: Partial<Record<'local' | 'github', ProjectAdmission>>
  runtime: AdmissionRuntime
}): ProjectRegistry {
  const candidates = new WeakMap<ProjectConfiguration, CommittedConfiguration>()
  // Workspace results survive immutable record copies and host-operation reproof publication.
  // Resolved paths prove occupancy, even when identity or collisions deny Workspace authority.
  const canonicalOccupancyPaths = new WeakMap<WorkspaceAdmission, string>()
  function restrictWorkspace(record: ProjectAdmissionRecord, path: string): ProjectAdmissionRecord {
    const error: AdmissionFailure = {
      code: 'admission-failed',
      field: 'workspace.path',
      message: 'That canonical Workspace is already registered.',
    }
    const restricted: ProjectAdmissionRecord = {
      ...record,
      workspace: { status: 'unavailable', error },
      source:
        record.intent.ref.integration === 'local'
          ? { status: 'unavailable', error }
          : record.source,
    }
    canonicalOccupancyPaths.set(restricted.workspace, path)
    return restricted
  }
  function restrictWorkspaceOccupancy(
    records: readonly ProjectAdmissionRecord[],
  ): ProjectAdmissionRecord[] {
    const occupied = new Map<string, number>()
    for (const record of records) {
      const path =
        record.workspace.status === 'admitted'
          ? record.workspace.proof.path
          : canonicalOccupancyPaths.get(record.workspace)
      if (!path) continue
      const key = pathKey(path)
      occupied.set(key, (occupied.get(key) ?? 0) + 1)
    }
    return records.map((record) =>
      record.workspace.status === 'admitted' &&
      (occupied.get(pathKey(record.workspace.proof.path)) ?? 0) > 1
        ? restrictWorkspace(record, record.workspace.proof.path)
        : record,
    )
  }
  function occupancyFacts(configuration: CommittedConfiguration): ProjectConfigurationIntent[] {
    return configuration.projects.map((intent) => {
      const admission = configuration.admissions.find((item) =>
        sameProject(item.intent.ref, intent.ref),
      )
      const path =
        admission?.workspace.status === 'admitted'
          ? admission.workspace.proof.path
          : admission && canonicalOccupancyPaths.get(admission.workspace)
      return path ? { ...intent, workspace: { ...intent.workspace, path } } : intent
    })
  }
  function remember(
    configuration: ProjectConfiguration,
    records: readonly ProjectAdmissionRecord[],
  ): ProjectConfiguration {
    candidates.set(configuration, freezeConfiguration({ ...configuration, admissions: records }))
    return Object.freeze(configuration)
  }
  async function inspect(
    intent: ProjectConfigurationIntent,
    connections: ConfiguredConnection[],
  ): Promise<ProjectAdmissionRecord> {
    const connection = connections.find((item) => item.id === intent.connectionId)
    if (!connection || connection.integration !== intent.ref.integration)
      return unavailable(
        intent,
        'Configured Connection does not exist or does not match this Project.',
      )
    const admission = admissions[intent.ref.integration]
    if (!admission) return unavailable(intent, 'This Integration is not supported.')
    let outcome: AdmissionOutcome
    try {
      outcome = await admission.revalidate(
        { intent, connection, path: intent.workspace.path },
        runtime,
      )
    } catch {
      return unavailable(intent, 'Project admission could not be revalidated.')
    }
    return refineRecord(intent, connection, outcome, canonicalOccupancyPaths)
  }
  return {
    async prepare(configuration, previous, options = {}) {
      const prepared = candidates.get(configuration)
      if (prepared && !options.revalidateConnections?.length) return prepared
      const admissions = await Promise.all(
        configuration.projects.map(async (intent) => {
          const old = previous?.admissions.find((item) => sameProject(item.intent.ref, intent.ref))
          const force = options.revalidateConnections?.includes(intent.connectionId) ?? false
          const connection = configuration.connections.find(
            (item) => item.id === intent.connectionId,
          )
          const priorConnection = previous?.connections.find(
            (item) => item.id === intent.connectionId,
          )
          if (
            !force &&
            old &&
            !canonicalOccupancyPaths.has(old.workspace) &&
            sameAdmissionIntent(old.intent, intent) &&
            sameConnectionAuthority(connection, priorConnection)
          )
            return { ...old, intent }
          const refined = await inspect(intent, configuration.connections)
          if (
            !force &&
            old &&
            'locator' in intent &&
            'locator' in old.intent &&
            intent.connectionId === old.intent.connectionId &&
            intent.locator.repositoryId === old.intent.locator.repositoryId &&
            sameConnectionAuthority(connection, priorConnection)
          ) {
            return { ...refined, source: old.source }
          }
          return refined
        }),
      )
      return freezeConfiguration({
        ...configuration,
        admissions: restrictWorkspaceOccupancy(admissions),
      })
    },
    async admit(candidate, configuration) {
      const connection = configuration.connections.find(
        (item) => item.id === candidate.connectionId,
      )
      if (!connection || connection.integration !== candidate.integration)
        return failure('connectionId', 'The selected Integration Connection does not exist.')
      const admission = admissions[candidate.integration]
      if (!admission) return failure('integration', 'This Integration is not supported.')
      let outcome: AdmissionOutcome
      try {
        outcome = await admission.admit({ ...candidate, connection }, runtime)
      } catch {
        return failure(
          'workspace.path',
          'Project admission could not inspect the selected Workspace.',
        )
      }
      if (outcome.integration === 'local' && connection.integration === 'local') {
        if (!outcome.workspace.ok) return outcome.workspace
        const proof = refineLocalWorkspaceProof({ inspection: outcome.workspace.value })
        if (!proof.ok) return proof
        const ref: LocalProjectRef = {
          integration: 'local',
          projectId: allocateId(
            proof.value.path.split('/').at(-1) || 'local-project',
            'local',
            configuration.projects,
          ),
        }
        const registration = createLocalProjectRegistration({
          ref,
          connection,
          workspace: proof.value,
          displayName: candidate.displayName,
          projects: occupancyFacts(configuration),
        })
        if (!registration.ok) return registration
        const intent = toIntent(registration.value)
        const next = nextConfiguration(configuration, [...configuration.projects, intent])
        return {
          ok: true,
          value: {
            configuration: remember(next, [
              ...configuration.admissions,
              {
                intent,
                source: { status: 'ready', value: registration.value },
                workspace: { status: 'admitted', proof: proof.value },
              },
            ]),
            project: ref,
          },
        }
      }
      if (outcome.integration !== 'github' || connection.integration !== 'github')
        return failure('integration', 'Admission evidence does not match this Integration.')
      if (!outcome.source.ok) return outcome.source
      if (!outcome.workspace.ok) return outcome.workspace
      const locator = outcome.locator ?? {
        repositoryId: outcome.workspace.value.matchedRepositoryId,
        nameWithOwner: outcome.workspace.value.nameWithOwner,
      }
      const proof = refineGitHubWorkspaceProof({
        inspection: outcome.workspace.value,
        connectionId: connection.id,
        repositoryId: locator.repositoryId,
      })
      if (!proof.ok) return proof
      const ref: GitHubProjectRef = {
        integration: 'github',
        projectId: allocateId(
          locator.nameWithOwner.split('/').at(-1) || `github-${locator.repositoryId}`,
          'github',
          configuration.projects,
        ),
      }
      const registration = createGitHubProjectRegistration({
        ref,
        connection,
        locator,
        workspace: proof.value,
        displayName: candidate.displayName,
        projects: occupancyFacts(configuration),
      })
      if (!registration.ok) return registration
      const intent = toIntent(registration.value)
      if (intent.ref.integration !== 'github' || !('locator' in intent))
        return failure('integration', 'GitHub registration refinement failed.')
      const source = refineGitHubSourceAccess({
        intent,
        connection,
        evidence: outcome.source.value,
      })
      if (!source.ok) return source
      const next = nextConfiguration(configuration, [...configuration.projects, intent])
      return {
        ok: true,
        value: {
          configuration: remember(next, [
            ...configuration.admissions,
            {
              intent,
              source: { status: 'ready', value: source.value },
              workspace: { status: 'admitted', proof: proof.value },
            },
          ]),
          project: ref,
        },
      }
    },
    async repair(candidate, configuration) {
      const existing = configuration.projects.find((item) =>
        sameProject(item.ref, candidate.project),
      )
      if (!existing) return failure('project', 'Project does not exist.')
      const connection = configuration.connections.find((item) => item.id === existing.connectionId)
      if (!connection || connection.integration !== existing.ref.integration)
        return failure('connectionId', 'Configured Connection does not match this Project.')
      const admission = admissions[existing.ref.integration]
      if (!admission) return failure('integration', 'This Integration is not supported.')
      let outcome: AdmissionOutcome
      try {
        outcome = await admission.repair(
          { intent: existing, connection, path: candidate.path },
          runtime,
        )
      } catch {
        return failure(
          'workspace.path',
          'Workspace repair could not inspect the selected directory.',
        )
      }
      if (!outcome.workspace.ok) return outcome.workspace
      let intent: ProjectConfigurationIntent
      if (!('locator' in existing)) {
        if (outcome.integration !== 'local')
          return failure('integration', 'Workspace evidence does not match Local.')
        const proof = refineLocalWorkspaceProof({ inspection: outcome.workspace.value })
        if (!proof.ok) return proof
        const old = configuration.admissions.find((item) =>
          sameProject(item.intent.ref, existing.ref),
        )
        const recordedPath =
          old?.workspace.status === 'admitted' ? old.workspace.proof.path : existing.workspace.path
        const recordedIdentity =
          'gitIdentity' in existing.workspace ? existing.workspace.gitIdentity : undefined
        // Resolved canonical paths must match exactly to prove the same directory.
        if (
          proof.value.path !== recordedPath &&
          (!recordedIdentity || proof.value.gitIdentity !== recordedIdentity)
        )
          return failure(
            'workspace.path',
            'A different directory must have the recorded Git-history identity.',
          )
        intent = {
          ref: { integration: 'local', projectId: existing.ref.projectId },
          connectionId: existing.connectionId,
          ...name(existing.displayName),
          workspace: {
            path: proof.value.path,
            ...(recordedIdentity || proof.value.gitIdentity
              ? { gitIdentity: recordedIdentity ?? proof.value.gitIdentity }
              : {}),
          },
        }
      } else {
        if (
          !('locator' in existing) ||
          outcome.integration !== 'github' ||
          connection.integration !== 'github'
        )
          return failure('integration', 'Workspace evidence does not match GitHub.')
        if (!outcome.source.ok) return outcome.source
        const source = refineGitHubSourceAccess({
          intent: existing,
          connection,
          evidence: outcome.source.value,
        })
        if (!source.ok) return source
        const proof = refineGitHubWorkspaceProof({
          inspection: outcome.workspace.value,
          connectionId: existing.connectionId,
          repositoryId: existing.locator.repositoryId,
        })
        if (!proof.ok) return proof
        const registration = createGitHubProjectRegistration({
          ref: existing.ref,
          connection,
          locator: {
            repositoryId: existing.locator.repositoryId,
            nameWithOwner: outcome.workspace.value.nameWithOwner,
          },
          workspace: proof.value,
          displayName: existing.displayName,
        })
        if (!registration.ok) return registration
        intent = toIntent(registration.value)
      }
      const occupied = checkOccupancy(
        intent,
        occupancyFacts(configuration).filter((item) => !sameProject(item.ref, existing.ref)),
      )
      if (occupied) return occupied
      const next = nextConfiguration(
        configuration,
        configuration.projects.map((item) => (sameProject(item.ref, existing.ref) ? intent : item)),
      )
      const record = refineRecord(intent, connection, outcome, canonicalOccupancyPaths)
      const prior = configuration.admissions.find((item) =>
        sameProject(item.intent.ref, existing.ref),
      )
      const repaired =
        'locator' in intent && prior
          ? { ...record, source: prior.source.status === 'ready' ? prior.source : record.source }
          : record
      return {
        ok: true,
        value: {
          configuration: remember(
            next,
            configuration.admissions.map((item) =>
              sameProject(item.intent.ref, existing.ref) ? repaired : item,
            ),
          ),
          project: existing.ref,
        },
      }
    },
    rename(candidate, configuration) {
      const existing = configuration.projects.find((item) =>
        sameProject(item.ref, candidate.project),
      )
      if (!existing) return failure('project', 'Project does not exist.')
      if (!candidate.displayName.trim())
        return failure('displayName', 'Project name must not be empty.')
      return {
        ok: true,
        value: {
          configuration: nextConfiguration(
            configuration,
            configuration.projects.map((item) =>
              sameProject(item.ref, candidate.project)
                ? { ...item, displayName: candidate.displayName.trim() }
                : item,
            ),
          ),
          project: existing.ref,
        },
      }
    },
    remove(project, configuration) {
      if (!configuration.projects.some((item) => sameProject(item.ref, project)))
        return failure('project', 'Project does not exist.')
      const next = nextConfiguration(
        configuration,
        configuration.projects.filter((item) => !sameProject(item.ref, project)),
      )
      next.automation = {
        ...next.automation,
        enabledProjects: next.automation.enabledProjects.filter(
          (item) => item.integration !== project.integration || item.id !== project.projectId,
        ),
      }
      return { ok: true, value: { configuration: next, project } }
    },
    async resolveWorkspace(project, configuration) {
      const intent = configuration.projects.find((item) => sameProject(item.ref, project))
      if (!intent)
        return {
          status: 'unavailable',
          error: { code: 'admission-failed', field: 'project', message: 'Project does not exist.' },
        }
      const record = await inspect(intent, configuration.connections)
      if (record.workspace.status !== 'admitted') return record.workspace
      const otherRecords = await Promise.all(
        configuration.projects
          .filter((other) => !sameProject(other.ref, project))
          .map((other) => inspect(other, configuration.connections)),
      )
      const root = pathKey(record.workspace.proof.path)
      const occupied = otherRecords.some((other) => {
        const path =
          other.workspace.status === 'admitted'
            ? other.workspace.proof.path
            : canonicalOccupancyPaths.get(other.workspace)
        return path !== undefined && pathKey(path) === root
      })
      return occupied
        ? restrictWorkspace(record, record.workspace.proof.path).workspace
        : record.workspace
    },
  }
}

function refineRecord(
  intent: ProjectConfigurationIntent,
  connection: ConfiguredConnection,
  outcome: AdmissionOutcome,
  canonicalOccupancyPaths: WeakMap<WorkspaceAdmission, string>,
): ProjectAdmissionRecord {
  if (
    intent.ref.integration === 'local' &&
    !('locator' in intent) &&
    connection.integration === 'local' &&
    outcome.integration === 'local'
  ) {
    const proof = outcome.workspace.ok
      ? refineLocalWorkspaceProof({ inspection: outcome.workspace.value })
      : outcome.workspace
    if (!proof.ok)
      return {
        intent,
        source: { status: 'unavailable', error: proof.error },
        workspace: { status: 'unavailable', error: proof.error },
      }
    if (
      proof.value.path !== intent.workspace.path &&
      (!intent.workspace.gitIdentity || proof.value.gitIdentity !== intent.workspace.gitIdentity)
    ) {
      const error: AdmissionFailure = {
        code: 'admission-failed',
        field: 'workspace.path',
        message: 'A different directory must have the recorded Git-history identity.',
      }
      const record: ProjectAdmissionRecord = {
        intent,
        source: { status: 'unavailable', error },
        workspace: { status: 'unavailable', error },
      }
      canonicalOccupancyPaths.set(record.workspace, proof.value.path)
      return record
    }
    const registration = createLocalProjectRegistration({
      ref: intent.ref,
      connection,
      workspace: proof.value,
      displayName: intent.displayName,
    })
    return {
      intent,
      source: registration.ok
        ? { status: 'ready', value: registration.value }
        : { status: 'unavailable', error: registration.error },
      workspace: { status: 'admitted', proof: proof.value },
    }
  }
  if (
    intent.ref.integration !== 'github' ||
    !('locator' in intent) ||
    connection.integration !== 'github' ||
    outcome.integration !== 'github'
  )
    return unavailable(intent, 'Admission evidence does not match the configured Integration.')
  const source = outcome.source.ok
    ? refineGitHubSourceAccess({ intent, connection, evidence: outcome.source.value })
    : outcome.source
  const proof = outcome.workspace.ok
    ? refineGitHubWorkspaceProof({
        inspection: outcome.workspace.value,
        connectionId: connection.id,
        repositoryId: intent.locator.repositoryId,
      })
    : outcome.workspace
  const registration = proof.ok
    ? createGitHubProjectRegistration({
        ref: intent.ref,
        connection,
        locator: intent.locator,
        workspace: proof.value,
        displayName: intent.displayName,
      })
    : proof
  return {
    intent,
    source: source.ok
      ? { status: 'ready', value: source.value }
      : { status: 'unavailable', error: source.error },
    workspace: registration.ok
      ? { status: 'admitted', proof: registration.value.workspace }
      : { status: 'unavailable', error: registration.error },
  }
}
function unavailable(intent: ProjectConfigurationIntent, message: string): ProjectAdmissionRecord {
  const error: AdmissionFailure = { code: 'admission-failed', message, field: 'workspace.path' }
  return {
    intent,
    source: { status: 'unavailable', error },
    workspace: { status: 'unavailable', error },
  }
}
function canonical(path: string): boolean {
  return isAbsolute(path) && normalize(path) === path
}
function pathKey(path: string): string {
  return process.platform === 'darwin' ? path.toLocaleLowerCase() : path
}
function sameProject(left: ProjectRef, right: ProjectRef): boolean {
  return left.integration === right.integration && left.projectId === right.projectId
}
function name(displayName?: string): { displayName?: string } {
  return displayName?.trim() ? { displayName: displayName.trim() } : {}
}
function failure(field: string, message: string): { ok: false; error: AdmissionFailure } {
  return { ok: false, error: { code: 'admission-failed', field, message } }
}
function allocateId(
  base: string,
  integration: ProjectRef['integration'],
  projects: readonly ProjectConfigurationIntent[],
): string {
  const occupied = new Set(
    projects
      .filter((item) => item.ref.integration === integration)
      .map((item) => item.ref.projectId.toLocaleLowerCase()),
  )
  if (!occupied.has(base.toLocaleLowerCase())) return base
  let suffix = 2
  while (occupied.has(`${base}-${suffix}`.toLocaleLowerCase())) suffix += 1
  return `${base}-${suffix}`
}
function checkOccupancy(
  intent: ProjectConfigurationIntent,
  projects: readonly ProjectConfigurationIntent[],
): { ok: false; error: AdmissionFailure } | undefined {
  if (projects.some((item) => sameProject(item.ref, intent.ref)))
    return failure('project', 'Project identity is already registered.')
  if (projects.some((item) => pathKey(item.workspace.path) === pathKey(intent.workspace.path)))
    return failure('workspace.path', 'That canonical Workspace is already registered.')
  if (
    'locator' in intent &&
    projects.some(
      (item) => 'locator' in item && item.locator.repositoryId === intent.locator.repositoryId,
    )
  )
    return failure('workspace.path', 'That GitHub repository is already registered.')
}
function toIntent(
  registration: LocalProjectRegistration | GitHubProjectRegistration,
): ProjectConfigurationIntent {
  if ('locator' in registration)
    return {
      ref: registration.ref,
      connectionId: registration.connectionId,
      locator: { ...registration.locator },
      workspace: { path: registration.workspace.path },
      ...name(registration.displayName),
    }
  return {
    ref: registration.ref,
    connectionId: registration.connectionId,
    workspace: {
      path: registration.workspace.path,
      ...(registration.workspace.gitIdentity
        ? { gitIdentity: registration.workspace.gitIdentity }
        : {}),
    },
    ...name(registration.displayName),
  }
}
function nextConfiguration(
  configuration: ProjectConfiguration,
  projects: ProjectConfigurationIntent[],
): ProjectConfiguration {
  return {
    schemaVersion: 6,
    configurationVersion: configuration.configurationVersion + 1,
    connections: configuration.connections,
    projects,
    automation: configuration.automation,
  }
}
function sameAdmissionIntent(
  left: ProjectConfigurationIntent,
  right: ProjectConfigurationIntent,
): boolean {
  return (
    left.ref.integration === right.ref.integration &&
    left.connectionId === right.connectionId &&
    left.workspace.path === right.workspace.path &&
    ('locator' in left
      ? 'locator' in right && left.locator.repositoryId === right.locator.repositoryId
      : !('locator' in right) && left.workspace.gitIdentity === right.workspace.gitIdentity)
  )
}
function sameConnectionAuthority(
  left: ConfiguredConnection | undefined,
  right: ConfiguredConnection | undefined,
): boolean {
  if (!left || !right || left.id !== right.id || left.integration !== right.integration)
    return false
  return left.integration === 'local'
    ? right.integration === 'local' && left.builtIn === right.builtIn
    : right.integration === 'github' && left.githubIdentity.id === right.githubIdentity.id
}
function freezeConfiguration(configuration: CommittedConfiguration): CommittedConfiguration {
  for (const connection of configuration.connections) {
    if (connection.integration === 'github') Object.freeze(connection.githubIdentity)
    Object.freeze(connection)
  }
  for (const intent of configuration.projects) {
    Object.freeze(intent.ref)
    Object.freeze(intent.workspace)
    if ('locator' in intent) Object.freeze(intent.locator)
    Object.freeze(intent)
  }
  for (const record of configuration.admissions) {
    Object.freeze(record.source)
    Object.freeze(record.workspace)
    Object.freeze(record)
  }
  for (const command of [
    configuration.automation.classificationCommand,
    configuration.automation.wayfinderCommand,
  ])
    if (command) {
      Object.freeze(command.args)
      Object.freeze(command)
    }
  configuration.automation.enabledProjects.forEach(Object.freeze)
  Object.freeze(configuration.automation.enabledProjects)
  Object.freeze(configuration.automation)
  Object.freeze(configuration.connections)
  Object.freeze(configuration.projects)
  Object.freeze(configuration.admissions)
  return Object.freeze(configuration)
}
