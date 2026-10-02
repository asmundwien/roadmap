import type { WayfinderMap } from '@roadmap/contracts'
import classNames from 'classnames/bind'
import { type ReactNode, useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { type ProseLinkTarget, resolveProseLink } from '@/views/map/link-targets'
import type { ResolvedSelection } from '@/views/map/selection'
import styles from './prose.module.css'

const cx = classNames.bind(styles)
const remarkPlugins = [remarkGfm]

export type ProseProps = {
  map: WayfinderMap
  sourcePath?: string
  markdown: string
  onOpenTicket: (id: string) => void
  onOpenMap: () => void
}

export function Prose({ map, sourcePath, markdown, onOpenTicket, onOpenMap }: ProseProps) {
  const components = useMemo<Components>(
    () => ({
      h1: 'h3',
      h2: 'h4',
      h3: 'h5',
      h4: 'h6',
      h5: 'h6',
      h6: 'h6',
      a: ({ node: _node, href, className, children, ...props }) => {
        const resolved = resolveProseLink(map, sourcePath, href)
        const target: ProseLinkTarget | null =
          resolved === null &&
          map.project.integration === 'local' &&
          href &&
          !/^(?:[a-zA-Z][a-zA-Z\d+.-]*:|\/\/)/.test(href)
            ? {
                kind: 'disabled',
                reason: 'The source path for this local reference is unavailable.',
              }
            : resolved
        if (target?.kind === 'selection') {
          return (
            <SelectionLink
              selection={target.selection}
              className={className}
              onOpenTicket={onOpenTicket}
              onOpenMap={onOpenMap}
            >
              {children}
            </SelectionLink>
          )
        }
        if (target?.kind === 'disabled') {
          return (
            <span
              className={cx('link', 'link-disabled', className)}
              aria-disabled="true"
              title={target.reason}
            >
              {children}
              <span className={cx('link-reason')}> ({target.reason})</span>
            </span>
          )
        }
        return (
          <a
            {...props}
            className={cx('link', className)}
            href={target?.kind === 'href' ? target.href : href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        )
      },
    }),
    [map, sourcePath, onOpenTicket, onOpenMap],
  )

  return (
    <div className={cx('prose')}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

type SelectionLinkProps = Pick<ProseProps, 'onOpenTicket' | 'onOpenMap'> & {
  selection: ResolvedSelection
  className?: string
  children: ReactNode
}

function SelectionLink({
  selection,
  className,
  children,
  onOpenTicket,
  onOpenMap,
}: SelectionLinkProps) {
  if (selection.kind === 'map' || selection.kind === 'ticket') {
    return (
      <button
        type="button"
        className={cx('link', 'link-button', className)}
        onClick={() => {
          if (selection.kind === 'ticket') onOpenTicket(selection.id)
          else onOpenMap()
        }}
      >
        {children}
      </button>
    )
  }
  return (
    <span
      className={cx('link', 'link-disabled', className)}
      aria-disabled="true"
      title="This local reference cannot be opened from Roadmap."
    >
      {children}
      <span className={cx('link-reason')}>
        {' '}
        (This local reference cannot be opened from Roadmap.)
      </span>
    </span>
  )
}
