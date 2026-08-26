import { useMemo } from 'react'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ResolvedSelection } from '../../router.ts'
import type { ProseLinkTarget } from './link-targets.ts'

/*
 * The Panel's one markdown renderer — react-markdown + GFM, no rehype plugins. Safe by default:
 * elements out (never dangerouslySetInnerHTML), raw HTML in bodies rendered inert, dangerous URL
 * protocols emptied. Serves both prose shapes the Panel has: whole issue bodies and the raw
 * fragments the server slices out of map bodies.
 */

const remarkPlugins = [remarkGfm]

function disabledReason(target: ProseLinkTarget | null, canSelect: boolean): string | null {
  if (target?.kind === 'disabled') return target.reason
  if (target?.kind === 'selection' && !canSelect) {
    return 'This local reference cannot be opened from Roadmap.'
  }
  return null
}

/** A markdown string — a whole issue body or a sliced fragment — as formatted prose. */
export function Prose({
  markdown,
  resolveLink,
  onSelect,
}: {
  markdown: string
  resolveLink?: (href: string | undefined) => ProseLinkTarget | null
  onSelect?: (item: ResolvedSelection) => void
}) {
  const components = useMemo<Components>(
    () => ({
      // Headings downshift so a shouty issue body can't outrank the Panel's own chrome.
      h1: 'h3',
      h2: 'h4',
      h3: 'h5',
      h4: 'h6',
      h5: 'h6',
      h6: 'h6',
      a: ({ node: _node, href, className, children, ...props }) => {
        const resolved = resolveLink?.(href) ?? null
        const classes = ['prose-link', className].filter(Boolean).join(' ')

        if (resolved?.kind === 'selection' && onSelect) {
          return (
            <button
              type="button"
              className={`${classes} prose-link-button`}
              onClick={() => onSelect(resolved.selection)}
            >
              {children}
            </button>
          )
        }

        const reason = disabledReason(resolved, Boolean(onSelect))
        if (reason) {
          return (
            <span className={`${classes} prose-link-disabled`} title={reason}>
              {children}
            </span>
          )
        }

        const nextHref = resolved?.kind === 'href' ? resolved.href : href
        return (
          <a {...props} className={classes} href={nextHref} target="_blank" rel="noreferrer">
            {children}
          </a>
        )
      },
    }),
    [onSelect, resolveLink],
  )

  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
