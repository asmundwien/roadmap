import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import type { ConnectionResult } from '@/resources/results'
import { AuthorizationGroup, RemoveConnectionGroup } from './management-sections'

type ManageSectionProps = {
  connection: Extract<ConnectionResult, { kind: 'known' }>
  onRemove: () => void
}

export function ManageSection({ connection, onRemove }: ManageSectionProps) {
  if (connection.builtIn) return null

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Manage connection</SectionTitle>
      </SectionHeader>
      <SectionBody>
        {connection.integration === 'github' && <AuthorizationGroup connection={connection} />}
        <RemoveConnectionGroup connection={connection} onRemove={onRemove} />
      </SectionBody>
    </Section>
  )
}
