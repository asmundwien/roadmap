import type { TicketId } from '@roadmap/contracts/identity'
import type { MapBody } from '@roadmap/contracts/state'
import classNames from 'classnames/bind'
import type { MapResult } from '@/resources/results'
import styles from './map-content.module.css'
import { Prose } from './prose'

const cx = classNames.bind(styles)

export type MapContentProps = {
  map: Extract<MapResult, { kind: 'known' }>
  onOpenTicket: (id: TicketId) => void
  onOpenMap: () => void
}

export function MapContent({ map, onOpenTicket, onOpenMap }: MapContentProps) {
  const content = map.content
  if (content === null) return null
  const markdown =
    content.body.raw.trim() !== '' ? content.body.raw : structuredMarkdown(content.body)

  return (
    <div className={cx('body')}>
      <h2>Map content</h2>
      {markdown.trim() !== '' ? (
        <Prose
          map={map.resource}
          sourcePath={map.source.kind === 'file' ? map.source.path : undefined}
          markdown={markdown}
          onOpenTicket={onOpenTicket}
          onOpenMap={onOpenMap}
        />
      ) : (
        <p>No map body content is available.</p>
      )}
    </div>
  )
}

function markdownList(items: string[]): string {
  return items.map((item) => `- ${item.replaceAll('\n', '\n  ')}`).join('\n')
}

function structuredMarkdown(body: MapBody): string {
  const sections = body.sections.map((section) => ({
    heading: section.heading,
    text: section.text.trim() !== '' ? section.text : markdownList(section.items),
  }))
  const fallbacks = [
    { heading: 'Destination', aliases: ['destination'], text: body.destination },
    { heading: 'Notes', aliases: ['notes'], text: markdownList(body.notes) },
    {
      heading: 'Decisions so far',
      aliases: ['decisions so far', 'decisions'],
      text: markdownList(
        body.decisions.map((decision) => {
          if (decision.raw.trim() !== '') return decision.raw
          const title = decision.url ? `[${decision.title}](${decision.url})` : decision.title
          return decision.gist.trim() !== '' ? `${title}: ${decision.gist}` : title
        }),
      ),
    },
    {
      heading: 'Not yet specified',
      aliases: ['not yet specified', 'fog of war', 'fog'],
      text: [markdownList(body.notYetSpecified), body.notYetSpecifiedNote]
        .filter((text) => text.trim() !== '')
        .join('\n\n'),
    },
    { heading: 'Out of scope', aliases: ['out of scope'], text: markdownList(body.outOfScope) },
  ]

  for (const fallback of fallbacks) {
    const present = sections.some((section) =>
      fallback.aliases.includes(section.heading.toLowerCase().replaceAll('-', ' ').trim()),
    )
    if (!present && fallback.text.trim() !== '') sections.push(fallback)
  }

  return sections.map((section) => `## ${section.heading}\n\n${section.text}`).join('\n\n')
}
