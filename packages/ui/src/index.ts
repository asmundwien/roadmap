/**
 * The public surface of the design system: presentational components and the variant vocabulary
 * they share. Consumers import from '@roadmap/ui' and load '@roadmap/ui/tokens.css' once; they
 * never reach into component folders or stylesheets.
 */
export {
  Action,
  ActionGroup,
  type ActionProps,
  type ActionVariant,
} from './components/action/action'
export { Alert, type AlertVariant } from './components/alert/alert'
export { Badge, type BadgeProps } from './components/badge/badge'
export {
  Mark,
  type MarkCornerCount,
  type MarkFill,
  type MarkProps,
  type MarkSize,
  MEDIUM_MARK_EXTENT,
} from './components/mark/mark'
export {
  Page,
  PageDescription,
  type PageDescriptionProps,
  PageEyebrow,
  type PageEyebrowProps,
  PageHeader,
  type PageHeaderProps,
  type PageProps,
  PageTitle,
  type PageTitleProps,
} from './components/page/page'
export { VARIANT_COLORS, type Variant } from './components/variant'
