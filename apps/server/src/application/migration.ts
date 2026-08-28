import type { ProjectRegistration } from '@roadmap/contracts'
import { inspectLocalWorkspace } from '../local/workspace.ts'
import { LOCAL_PROJECTS_PATH, readLocalProjectRegistry } from '../local-projects.ts'
import { CLASSIFICATION_RESULT_SCHEMA_MARKER } from './classification-contract.ts'
import type {
  HarnessCommand,
  LegacyHarnessCommand,
  LegacyRoadmapConfigurationV3,
  LegacyRoadmapConfigurationV4,
  RoadmapConfiguration,
} from './configuration.ts'
import { SESSION_REPORT_SCHEMA_MARKER } from './session-report-contract.ts'

export interface LegacyRoadmapConfiguration {
  schemaVersion: 1 | 2
  configurationVersion: number
  connections: RoadmapConfiguration['connections']
  projects: ProjectRegistration[]
}

export interface ConfigurationMigration {
  document: RoadmapConfiguration
  notices: string[]
}

const LOCAL_CONNECTION: RoadmapConfiguration['connections'][number] = {
  id: 'local',
  integration: 'local',
  name: 'Local',
  builtIn: true,
}

const LEGACY_CLASSIFICATION_PROMPT_TEMPLATE = `Perform a Roadmap Classification Run for the task ticket below.
Map pointer: {{roadmap.map}}
Ticket pointer: {{roadmap.ticket}}

Load both from the tracker. Do not claim, edit, or resolve anything.
Write only one JSON object to stdout matching this schema:
${CLASSIFICATION_RESULT_SCHEMA_MARKER}
`

const LEGACY_WAYFINDER_PROMPT_TEMPLATE = `Invoke the Wayfinder skill for exactly this map and ticket.
Map pointer: {{roadmap.map}}
Ticket pointer: {{roadmap.ticket}}

Reload both from the tracker. Confirm that the ticket is an open, unblocked, unassigned child of the map. If it is no longer on the frontier, stop without assigning it or making any other mutation. If it is still on the frontier, claim it before any work, then resolve exactly this ticket through the normal Wayfinder workflow. Do not choose or resolve another ticket.
Write only one JSON object to stdout matching this schema:
${SESSION_REPORT_SCHEMA_MARKER}
`

/** Migrates the one reachable v1 input and reads the legacy Registry only on that path. */
export async function migrateConfigurationV1(
  legacy: LegacyRoadmapConfiguration,
  legacyLocalProjectsPath = LOCAL_PROJECTS_PATH,
): Promise<ConfigurationMigration> {
  const registry = await readLocalProjectRegistry(legacyLocalProjectsPath)
  const notices = [...registry.warnings]
  const legacyLocalConnection = legacy.connections.find(
    (connection) => connection.integration === 'local',
  )
  const connections = migratedConnections(legacy.connections)
  const localConnection = connections.find((connection) => connection.integration === 'local')
  if (!localConnection) throw new Error('Local Connection migration invariant failed.')

  const projects = legacy.projects.map((project) => {
    const connectionId =
      legacyLocalConnection && project.connectionId === legacyLocalConnection.id
        ? localConnection.id
        : !legacyLocalConnection && project.connectionId === 'local'
          ? 'local-connection'
          : project.connectionId
    return connectionId === project.connectionId ? project : { ...project, connectionId }
  })
  for (const entry of registry.registrations) {
    const duplicatePath = projects.find(
      (project) => canonicalPath(project.workspace.path) === canonicalPath(entry.rootPath),
    )
    if (duplicatePath) {
      notices.push(
        `Skipped legacy Local Project ${JSON.stringify(entry.id)} because its folder is already registered.`,
      )
      continue
    }
    const duplicateKey = projects.find(
      (project) => project.key.integration === 'local' && project.key.id === entry.id,
    )
    if (duplicateKey) {
      notices.push(
        `Skipped legacy Local Project ${JSON.stringify(entry.id)} because its route key is already registered.`,
      )
      continue
    }

    const workspace = entry.rootExists
      ? await inspectLocalWorkspace(entry.rootPath).catch(() => ({ path: entry.rootPath }))
      : { path: entry.rootPath }
    projects.push({
      key: { integration: 'local', id: entry.id },
      connectionId: localConnection.id,
      locator: { integration: 'local', path: workspace.path },
      workspace,
      ...(entry.displayName ? { displayName: entry.displayName } : {}),
    })
  }

  return {
    document: {
      schemaVersion: 5,
      configurationVersion: legacy.configurationVersion + 1,
      connections,
      projects,
      automation: { enabled: false, enabledProjects: [] },
    },
    notices,
  }
}

/** Adds inert Automation configuration without replaying the one-time Registry import. */
export function migrateConfigurationV2(legacy: LegacyRoadmapConfiguration): ConfigurationMigration {
  return {
    document: {
      schemaVersion: 5,
      configurationVersion: legacy.configurationVersion + 1,
      connections: legacy.connections,
      projects: legacy.projects,
      automation: { enabled: false, enabledProjects: [] },
    },
    notices: [],
  }
}

/** Retains the safe command but resets Classification-only consent during the Automation cutover. */
export function migrateConfigurationV3(
  legacy: LegacyRoadmapConfigurationV3,
): ConfigurationMigration {
  return {
    document: {
      schemaVersion: 5,
      configurationVersion: legacy.configurationVersion + 1,
      connections: legacy.connections,
      projects: legacy.projects,
      automation: {
        enabled: false,
        ...(legacy.classification.command
          ? {
              classificationCommand: migrateHarnessCommand(
                legacy.classification.command,
                LEGACY_CLASSIFICATION_PROMPT_TEMPLATE,
              ),
            }
          : {}),
        enabledProjects: [],
      },
    },
    notices: [],
  }
}

/** Materializes the formerly built-in prompts while retaining inert Automation consent. */
export function migrateConfigurationV4(
  legacy: LegacyRoadmapConfigurationV4,
): ConfigurationMigration {
  return {
    document: {
      schemaVersion: 5,
      configurationVersion: legacy.configurationVersion + 1,
      connections: legacy.connections,
      projects: legacy.projects,
      automation: {
        enabled: legacy.automation.enabled,
        ...(legacy.automation.classificationCommand
          ? {
              classificationCommand: migrateHarnessCommand(
                legacy.automation.classificationCommand,
                LEGACY_CLASSIFICATION_PROMPT_TEMPLATE,
              ),
            }
          : {}),
        ...(legacy.automation.wayfinderCommand
          ? {
              wayfinderCommand: migrateHarnessCommand(
                legacy.automation.wayfinderCommand,
                LEGACY_WAYFINDER_PROMPT_TEMPLATE,
              ),
            }
          : {}),
        enabledProjects: legacy.automation.enabledProjects,
      },
    },
    notices: [],
  }
}

function migrateHarnessCommand(
  command: LegacyHarnessCommand,
  promptTemplate: string,
): HarnessCommand {
  return { ...command, promptTemplate }
}

function migratedConnections(
  connections: readonly RoadmapConfiguration['connections'][number][],
): RoadmapConfiguration['connections'] {
  const local = connections.find((connection) => connection.integration === 'local')
  const nonLocal = connections.filter((connection) => connection.integration !== 'local')
  return [
    local ? { ...local, id: 'local', integration: 'local', builtIn: true } : LOCAL_CONNECTION,
    ...nonLocal.map((connection) =>
      connection.id === 'local' ? { ...connection, id: `${connection.id}-connection` } : connection,
    ),
  ]
}

function canonicalPath(path: string): string {
  return process.platform === 'darwin' ? path.toLocaleLowerCase() : path
}
