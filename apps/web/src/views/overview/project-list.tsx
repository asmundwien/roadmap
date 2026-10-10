import { Alert } from '@roadmap/ui/alert'
import { Badge } from '@roadmap/ui/badge'
import { PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Section, SectionBody, SectionHeader, SectionTitle } from '@roadmap/ui/section'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import type { ReactNode } from 'react'
import { Link } from '@/navigation'
import type {
  AttentionItem,
  AutomationResult,
  KnownProjectResult,
  ProjectPortfolio,
} from '@/resources/results'
import { mapPath, projectPath, routePaths, ticketPath } from '@/router'
import { IntegrationBadge } from '@/views/shared/integration-badge'
import { formatMonth, formatRecency } from './recency'

type OverviewHeaderProps = {
  capturedAt: number
  portfolio: ProjectPortfolio
}

export function OverviewHeader({ capturedAt, portfolio }: OverviewHeaderProps) {
  return (
    <PageHeader>
      <PageTitle>Roadmap</PageTitle>
      <PageDescription>Published {new Date(capturedAt).toLocaleTimeString()}</PageDescription>
      <PageDescription>
        {portfolio.projects.length} projects · {portfolio.active.length} active ·{' '}
        {portfolio.resting.length} at rest · {portfolio.uncertain.length} uncertain ·{' '}
        {portfolio.attention.length} need attention
      </PageDescription>
    </PageHeader>
  )
}

type ProjectOverviewSectionsProps = { portfolio: ProjectPortfolio; automation: AutomationResult }

export function ProjectOverviewSections({ portfolio, automation }: ProjectOverviewSectionsProps) {
  return (
    <>
      {portfolio.attention.length > 0 && (
        <OverviewSection label="Needs attention">
          {portfolio.attention.map((item) => (
            <AttentionRow key={item.key} item={item} />
          ))}
        </OverviewSection>
      )}
      {automation.interruptions.length > 0 && (
        <OverviewSection label="Automation review required">
          {automation.interruptions.map((interruption) => (
            <Alert key={ticketPath(interruption.navigation.ticket)}>
              <span>{interruption.reason}</span>
              <span>{interruption.project.message}</span>
              <span>{interruption.map.message}</span>
              <span>{interruption.ticket.message}</span>
              <Link href={ticketPath(interruption.navigation.ticket)}>Review interruption</Link>
            </Alert>
          ))}
        </OverviewSection>
      )}

      <OverviewSection label="Active work · priority">
        {portfolio.active.map((project) => (
          <ActiveProjectRow key={project.key} presentation={project} />
        ))}
        {portfolio.active.length === 0 && <p>No current active map is established.</p>}
      </OverviewSection>

      <OverviewSection label="Projects at rest">
        {portfolio.resting.map((project) => (
          <RestingProjectRow key={project.key} presentation={project} />
        ))}
        {portfolio.resting.length === 0 && <p>No Projects are at rest.</p>}
      </OverviewSection>

      <OverviewSection label="Source or ordering uncertain">
        {portfolio.uncertain.map((project) => (
          <WaitingProjectRow key={project.key} presentation={project} />
        ))}
      </OverviewSection>

      <OverviewSection label="Known empty map membership">
        {portfolio.waiting.map((project) => (
          <WaitingProjectRow key={project.key} presentation={project} />
        ))}
        {portfolio.waiting.length === 0 && (
          <p>
            {portfolio.projects.length === 0
              ? 'No Projects registered yet.'
              : 'No Projects have confirmed empty map membership.'}
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

type ActiveProjectRowProps = { presentation: KnownProjectResult }

function ActiveProjectRow({ presentation }: ActiveProjectRowProps) {
  const {
    name,
    integration,
    connection,
    navigation,
    destination,
    decisions,
    openTickets,
    hasFog,
    priorities,
    availability,
    activity,
  } = presentation
  return (
    <Surface>
      <SurfaceTitle>
        <Link href={projectPath(navigation.project)}>{name}</Link>{' '}
        <IntegrationBadge integration={integration} />
      </SurfaceTitle>
      {connection && <SurfaceDescription>{connection.name}</SurfaceDescription>}
      <SurfaceDescription>{availability.message}</SurfaceDescription>
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
        <Badge variant={presentation.journeyVariant}>
          {presentation.journeyLabel} ·{' '}
          {activity.kind === 'known'
            ? formatRecency(activity.at, Date.now())
            : 'Source activity unknown'}
        </Badge>
        <Badge>{availability.label}</Badge>
      </div>
    </Surface>
  )
}

type RestingProjectRowProps = { presentation: KnownProjectResult }

function RestingProjectRow({ presentation }: RestingProjectRowProps) {
  const { name, integration, navigation, decisions, activity } = presentation
  return (
    <Surface>
      <SurfaceTitle>
        <Link href={projectPath(navigation.project)}>{name}</Link>{' '}
        <IntegrationBadge integration={integration} />
      </SurfaceTitle>
      <SurfaceDescription>
        {presentation.description} ·{' '}
        {decisions === null ? 'Decision count unknown' : `${decisions} decisions recorded`}
      </SurfaceDescription>
      <SurfaceDescription>
        {presentation.journeyLabel} ·{' '}
        {activity.kind === 'known' ? formatMonth(activity.at) : 'Source activity unknown'}
      </SurfaceDescription>
      <SurfaceDescription>{presentation.availability.message}</SurfaceDescription>
    </Surface>
  )
}

type WaitingProjectRowProps = { presentation: KnownProjectResult }

function WaitingProjectRow({ presentation }: WaitingProjectRowProps) {
  const { name, integration, navigation } = presentation
  return (
    <Surface>
      <SurfaceTitle>
        <Link href={projectPath(navigation.project)}>{name}</Link>{' '}
        <IntegrationBadge integration={integration} />
      </SurfaceTitle>
      <SurfaceDescription>
        {presentation.availability.message} {presentation.description}
      </SurfaceDescription>
      {presentation.orderWarning && (
        <SurfaceDescription>{presentation.orderWarning}</SurfaceDescription>
      )}
      <SurfaceDescription>
        {presentation.mapCount === null
          ? 'Current map count unknown'
          : `${presentation.mapCount} current maps`}{' '}
        ·{' '}
        {presentation.decisions === null
          ? 'Decision count unknown'
          : `${presentation.decisions} decisions recorded`}
      </SurfaceDescription>
      {presentation.maps.map((map) => (
        <Link key={map.key} href={mapPath(map.ref)}>
          Inspect map {map.displayId}
        </Link>
      ))}
      <div>
        <Badge variant={presentation.journeyVariant}>{presentation.journeyLabel}</Badge>
      </div>
    </Surface>
  )
}
