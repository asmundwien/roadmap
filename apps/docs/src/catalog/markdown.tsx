import classNames from 'classnames/bind'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './markdown.module.css'

const cx = classNames.bind(styles)
const markdownPlugins = [remarkGfm]

type MarkdownProps = {
  source: string
}

export function Markdown({ source }: MarkdownProps) {
  return (
    <div className={cx('markdown')}>
      <ReactMarkdown remarkPlugins={markdownPlugins}>{source}</ReactMarkdown>
    </div>
  )
}
