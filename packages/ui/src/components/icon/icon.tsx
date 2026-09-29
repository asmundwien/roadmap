import styles from './icon.module.css'
import arrowLeft from './icons/arrow-left.svg'
import chevronDown from './icons/chevron-down.svg'
import chevronUp from './icons/chevron-up.svg'
import chevronsRight from './icons/chevrons-right.svg'
import close from './icons/close.svg'
import codeBranch from './icons/code-branch.svg'
import externalLink from './icons/external-link.svg'
import folderOpen from './icons/folder-open.svg'
import github from './icons/github.svg'
import internalLink from './icons/internal-link.svg'
import plus from './icons/plus.svg'
import terminal from './icons/terminal.svg'
import trash from './icons/trash.svg'
import vscode from './icons/vscode.svg'

/** Available symbols and brands for `Icon`. Third-party SVG licenses are beside their assets. */
export const icon = {
  arrowLeft: 'arrow-left',
  chevronDown: 'chevron-down',
  chevronUp: 'chevron-up',
  chevronsRight: 'chevrons-right',
  close: 'close',
  codeBranch: 'code-branch',
  externalLink: 'external-link',
  folderOpen: 'folder-open',
  github: 'github',
  internalLink: 'internal-link',
  plus: 'plus',
  terminal: 'terminal',
  trash: 'trash',
  vscode: 'vscode',
} as const

const sources = {
  [icon.arrowLeft]: arrowLeft,
  [icon.chevronDown]: chevronDown,
  [icon.chevronUp]: chevronUp,
  [icon.chevronsRight]: chevronsRight,
  [icon.close]: close,
  [icon.codeBranch]: codeBranch,
  [icon.externalLink]: externalLink,
  [icon.folderOpen]: folderOpen,
  [icon.github]: github,
  [icon.internalLink]: internalLink,
  [icon.plus]: plus,
  [icon.terminal]: terminal,
  [icon.trash]: trash,
  [icon.vscode]: vscode,
} satisfies Record<(typeof icon)[keyof typeof icon], string>

export type IconProps = { icon: (typeof icon)[keyof typeof icon] }

/**
 * Renders a decorative icon in the surrounding text color. The icon is hidden
 * from assistive technology, so pair it with a visible text label.
 *
 * @example
 * ```tsx
 * import { Icon, icon } from '@roadmap/ui/icon'
 *
 * <button type="button"><Icon icon={icon.plus} /> Add</button>
 * ```
 */
export function Icon({ icon: iconName }: IconProps) {
  return (
    <span
      className={styles.icon}
      style={{ maskImage: `url("${sources[iconName]}")` }}
      aria-hidden="true"
    />
  )
}
