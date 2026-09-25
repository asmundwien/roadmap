import type { Route } from '@/router'
import { AutomationSettings } from './automation-settings'
import { ConnectionSettings } from './connection-settings'
import { ProjectSettings } from './project-settings'

type SettingsRoute = Extract<
  Route,
  { screen: 'project-settings' | 'connection-settings' | 'automation-settings' }
>

type SettingsPageProps = { route: SettingsRoute }

export function SettingsPage({ route }: SettingsPageProps) {
  switch (route.screen) {
    case 'project-settings':
      return <ProjectSettings />
    case 'connection-settings':
      return <ConnectionSettings />
    case 'automation-settings':
      return <AutomationSettings />
  }
}
