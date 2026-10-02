import { PageHeader, PageTitle } from '@roadmap/ui/page'
import { Surface } from '@roadmap/ui/surface'
import { TextInput } from '@roadmap/ui/text-input'

export function TextInputPage() {
  return (
    <>
      <PageHeader>
        <PageTitle>Text input</PageTitle>
      </PageHeader>
      <Surface>
        <label htmlFor="text-input-small">Small</label>
        <TextInput id="text-input-small" name="small" size="small" placeholder="Small" />
      </Surface>
      <Surface>
        <label htmlFor="text-input">Medium (default)</label>
        <TextInput id="text-input" name="name" placeholder="Medium" />
      </Surface>
      <Surface>
        <label htmlFor="text-input-large">Large</label>
        <TextInput id="text-input-large" name="large" size="large" placeholder="Large" />
      </Surface>
    </>
  )
}
