import { Alert } from '@roadmap/ui/alert'
import { Badge } from '@roadmap/ui/badge'
import { PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import type { ReactNode } from 'react'
import { Link } from '@/navigation'
import { projectPath, routePaths } from '@/router'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import type { AttentionItem, ProjectPortfolio, ProjectPresentation } from './project-presentation'
import { formatMonth, formatRecency } from './recency'

type OverviewHeaderProps = {
  capturedAt: number
  portfolio: ProjectPortfolio
}

export function OverviewHeader({ capturedAt, portfolio }: OverviewHeaderProps) {
  return (
    <PageHeader>
      <PageTitle>Roadmap</PageTitle>
      <PageDescription>The whole of things · updated {formatClock(capturedAt)}</PageDescription>
      <PageDescription>
        {portfolio.projects.length} projects · {portfolio.active.length} active ·{' '}
        {portfolio.resting.length} at rest · {portfolio.attention.length} need attention
      </PageDescription>
    </PageHeader>
  )
}

type ProjectOverviewSectionsProps = { portfolio: ProjectPortfolio }

export function ProjectOverviewSections({ portfolio }: ProjectOverviewSectionsProps) {
  return (
    <>
      {portfolio.attention.length > 0 && (
        <OverviewSection label="Needs attention">
          {portfolio.attention.map((item) => (
            <AttentionRow key={item.key} item={item} />
          ))}
        </OverviewSection>
      )}

      <OverviewSection label="Active work · priority">
        {portfolio.active.map((project) => (
          <ActiveProjectRow key={projectKey(project)} presentation={project} />
        ))}
        {portfolio.active.length === 0 && <p>No Projects have an open map.</p>}
      </OverviewSection>

      <OverviewSection label="Projects at rest">
        {portfolio.resting.map((project) => (
          <RestingProjectRow key={projectKey(project)} presentation={project} />
        ))}
        {portfolio.resting.length === 0 && <p>No Projects are at rest.</p>}
      </OverviewSection>

      <OverviewSection label="Waiting for a first map">
        {portfolio.waiting.map((project) => (
          <WaitingProjectRow key={projectKey(project)} presentation={project} />
        ))}
        {portfolio.waiting.length === 0 && (
          <p>
            {portfolio.projects.length === 0
              ? 'No Projects registered yet.'
              : 'Every Project has a Wayfinder map.'}
          </p>
        )}
      </OverviewSection>
    </>
  )
}

type OverviewSectionProps = { children: ReactNode; label: string }

function OverviewSection({ children, label }: OverviewSectionProps) {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>{label}</SectionTitle>
      </SectionHeader>
      <SectionBody>{children}</SectionBody>
    </Section>
  )
}

type AttentionRowProps = { item: AttentionItem }

function AttentionRow({ item }: AttentionRowProps) {
  return (
    <Alert>
      <strong>{item.title}</strong>
      <span>{item.detail}</span>
      {item.kind === 'project' && <Link href={projectPath(item.project)}>Open project</Link>}
      {item.kind === 'connection' && <Link href={routePaths.connections}>Connections</Link>}
    </Alert>
  )
}

type ActiveProjectRowProps = { presentation: ProjectPresentation }

function ActiveProjectRow({ presentation }: ActiveProjectRowProps) {
  const { project, connection, destination, decisions, openTickets, hasFog, priorities } =
    presentation
  const unavailable = project.availability.status === 'unavailable'
  return (
    <Surface>
      <SurfaceTitle>
        <Link href={projectPath(project.key)}>{project.name}</Link>{' '}
        <IntegrationBadge integration={project.key.integration} />
      </SurfaceTitle>
      {connection && <SurfaceDescription>{connection.name}</SurfaceDescription>}
      <SurfaceDescription>{destination}</SurfaceDescription>
      <SurfaceDescription>
        {decisions === null ? 'Decision count unknown' : `${decisions} decided`} ·{' '}
        {openTickets === null ? 'Open ticket count unknown' : `${openTickets} open`}
        {hasFog ? ' · fog ahead' : ''}
      </SurfaceDescription>
      {priorities.length > 0 && (
        <SurfaceDescription>Priority · {priorities.join(' · ')}</SurfaceDescription>
      )}
      <div>
        <Badge variant={unavailable ? 'danger' : 'info'}>
          {unavailable
            ? 'Unavailable'
            : `Active · ${formatRecency(presentation.activityAt ?? 0, Date.now())}`}
        </Badge>
      </div>
    </Surface>
  )
}

type RestingProjectRowProps = { presentation: ProjectPresentation }

function RestingProjectRow({ presentation }: RestingProjectRowProps) {
  const { project, mapCount, decisions, activityAt } = presentation
  return (
    <Surface>
      <SurfaceTitle>
        <Link href={projectPath(project.key)}>{project.name}</Link>{' '}
        <IntegrationBadge integration={project.key.integration} />
      </SurfaceTitle>
      <SurfaceDescription>
        All {mapCount === 1 ? '1 map' : `${mapCount} maps`} closed ·{' '}
        {decisions === null ? 'Decision count unknown' : `${decisions} decisions recorded`}
      </SurfaceDescription>
      <SurfaceDescription>
        At rest{activityAt === undefined ? '' : ` · ${formatMonth(activityAt)}`}
      </SurfaceDescription>
    </Surface>
  )
}

type WaitingProjectRowProps = { presentation: ProjectPresentation }

function WaitingProjectRow({ presentation }: WaitingProjectRowProps) {
  const { project, connection } = presentation
  const unavailableCause =
    project.availability.status === 'unavailable' ? project.availability.cause : null
  return (
    <Surface>
      <SurfaceTitle>
        <Link href={projectPath(project.key)}>{project.name}</Link>{' '}
        <IntegrationBadge integration={project.key.integration} />
      </SurfaceTitle>
      <SurfaceDescription>
        {unavailableCause !== null
          ? unavailableCause
          : `Registered${connection ? ` through ${connection.name}` : ''} · no Wayfinder maps yet`}
      </SurfaceDescription>
      <div>
        <Badge variant={unavailableCause !== null ? 'danger' : 'neutral'}>
          {unavailableCause !== null ? 'Unavailable' : 'Waiting'}
        </Badge>
      </div>
    </Surface>
  )
}

function projectKey(presentation: ProjectPresentation): string {
  return `${presentation.project.key.integration}:${presentation.project.key.id}`
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString()
}
