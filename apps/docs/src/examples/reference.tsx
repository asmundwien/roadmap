import referenceSource from '../../../../packages/ui/src/styles/references/README.md?raw'
import { Markdown } from './markdown'

export function ReferenceTokensPage() {
  return <Markdown source={referenceSource} />
}
