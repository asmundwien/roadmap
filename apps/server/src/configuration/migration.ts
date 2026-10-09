import { realpath } from 'node:fs/promises'
import { CLASSIFICATION_RESULT_SCHEMA_MARKER } from '../application/classification-contract.ts'
import { SESSION_REPORT_SCHEMA_MARKER } from '../application/session-report-contract.ts'
import { LOCAL_PROJECTS_PATH, readLocalProjectRegistry } from '../local-projects.ts'
import type {
  ConfiguredConnection,
  HarnessCommand,
  LegacyHarnessCommand,
  ProjectConfiguration,
  ProjectConfigurationIntent,
} from '../projects/registry.ts'

export interface ConfigurationMigrationInput {
  schemaVersion: 1 | 2 | 3 | 4 | 5
  configurationVersion: number
  connections: ConfiguredConnection[]
  projects: ProjectConfigurationIntent[]
  classification?: {
    command?: LegacyHarnessCommand
    enabledProjects: { integration: 'local' | 'github'; id: string }[]
  }
  automation?: {
    enabled: boolean
    classificationCommand?: LegacyHarnessCommand | HarnessCommand
    wayfinderCommand?: LegacyHarnessCommand | HarnessCommand
    enabledProjects: { integration: 'local' | 'github'; id: string }[]
  }
}
export interface ConfigurationMigration {
  document: ProjectConfiguration
  notices: string[]
}
const LOCAL_CONNECTION: ConfiguredConnection = {
  id: 'local',
  integration: 'local',
  name: 'Local',
  builtIn: true,
}
const CLASSIFICATION_PROMPT = `Perform a Roadmap Classification Run for the task ticket below.
Map pointer: {{roadmap.map}}
Ticket pointer: {{roadmap.ticket}}

Load both from the tracker. Do not claim, edit, or resolve anything.
Write only one JSON object to stdout matching this schema:
${CLASSIFICATION_RESULT_SCHEMA_MARKER}
`
const WAYFINDER_PROMPT = `Invoke the Wayfinder skill for exactly this map and ticket.
Map pointer: {{roadmap.map}}
Ticket pointer: {{roadmap.ticket}}

Reload both from the tracker. Confirm that the ticket is an open, unblocked, unassigned child of the map. If it is no longer on the frontier, stop without assigning it or making any other mutation. If it is still on the frontier, claim it before any work, then resolve exactly this ticket through the normal Wayfinder workflow. Do not choose or resolve another ticket.
Write only one JSON object to stdout matching this schema:
${SESSION_REPORT_SCHEMA_MARKER}
`

/** Only v1 imports the historical Registry. Missing storage never discards its configured identity. */
export async function migrateConfiguration(
  input: ConfigurationMigrationInput,
  legacyPath = LOCAL_PROJECTS_PATH,
): Promise<ConfigurationMigration> {
  const notices: string[] = []
  let connections = input.connections
  let projects = input.projects
  if (input.schemaVersion === 1) {
    const registry = await readLocalProjectRegistry(legacyPath)
    notices.push(...registry.warnings)
    const priorLocal = connections.find((item) => item.integration === 'local')
    const local: ConfiguredConnection =
      priorLocal?.integration === 'local'
        ? { ...priorLocal, id: 'local', builtIn: true }
        : LOCAL_CONNECTION
    connections = [
      local,
      ...connections
        .filter((item) => item.integration !== 'local')
        .map((item) => (item.id === 'local' ? { ...item, id: 'local-connection' } : item)),
    ]
    projects = projects.map((project) => ({
      ...project,
      connectionId:
        priorLocal && project.connectionId === priorLocal.id
          ? 'local'
          : !priorLocal && project.connectionId === 'local'
            ? 'local-connection'
            : project.connectionId,
    }))
    for (const entry of registry.registrations) {
      const recordedPath = entry.rootExists
        ? await realpath(entry.rootPath).catch(() => entry.rootPath)
        : entry.rootPath
      if (projects.some((project) => pathKey(project.workspace.path) === pathKey(recordedPath))) {
        notices.push(
          `Skipped legacy Local Project ${JSON.stringify(entry.id)} because its folder is already registered.`,
        )
        continue
      }
      if (
        projects.some(
          (project) => project.ref.integration === 'local' && project.ref.projectId === entry.id,
        )
      ) {
        notices.push(
          `Skipped legacy Local Project ${JSON.stringify(entry.id)} because its route key is already registered.`,
        )
        continue
      }
      projects.push({
        ref: { integration: 'local', projectId: entry.id },
        connectionId: 'local',
        workspace: { path: recordedPath },
        ...(entry.displayName ? { displayName: entry.displayName } : {}),
      })
    }
  }
  let automation: ProjectConfiguration['automation'] = { enabled: false, enabledProjects: [] }
  if (input.schemaVersion === 3) {
    if (input.classification?.command)
      automation.classificationCommand = materialize(
        input.classification.command,
        CLASSIFICATION_PROMPT,
      )
  } else if (input.schemaVersion === 4 || input.schemaVersion === 5) {
    if (!input.automation) throw new Error('Decoded Automation migration input is missing.')
    automation = {
      enabled: input.automation.enabled,
      enabledProjects: input.automation.enabledProjects,
      ...(input.automation.classificationCommand
        ? {
            classificationCommand: materialize(
              input.automation.classificationCommand,
              CLASSIFICATION_PROMPT,
            ),
          }
        : {}),
      ...(input.automation.wayfinderCommand
        ? { wayfinderCommand: materialize(input.automation.wayfinderCommand, WAYFINDER_PROMPT) }
        : {}),
    }
  }
  return {
    document: {
      schemaVersion: 6,
      configurationVersion: input.configurationVersion + 1,
      connections,
      projects,
      automation,
    },
    notices,
  }
}
function materialize(
  command: LegacyHarnessCommand | HarnessCommand,
  template: string,
): HarnessCommand {
  return {
    ...command,
    promptTemplate: 'promptTemplate' in command ? command.promptTemplate : template,
  }
}
function pathKey(path: string): string {
  return process.platform === 'darwin' ? path.toLocaleLowerCase() : path
}
