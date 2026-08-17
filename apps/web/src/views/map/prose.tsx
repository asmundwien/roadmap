import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/*
 * The Panel's one markdown renderer — react-markdown + GFM, no rehype plugins. Safe by default:
 * elements out (never dangerouslySetInnerHTML), raw HTML in bodies rendered inert, dangerous URL
 * protocols emptied. Serves both prose shapes the Panel has: whole issue bodies and the raw
 * fragments the server slices out of map bodies.
 */

const components: Components = {
  // Headings downshift so a shouty issue body can't outrank the Panel's own chrome.
  h1: 'h3',
  h2: 'h4',
  h3: 'h5',
  h4: 'h6',
  h5: 'h6',
  h6: 'h6',
  // Every prose link leaves for a new tab, as the Panel's GitHub buttons already do.
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
}

const remarkPlugins = [remarkGfm]

/** A markdown string — a whole issue body or a sliced fragment — as formatted prose. */
export function Prose({ markdown }: { markdown: string }) {
  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
