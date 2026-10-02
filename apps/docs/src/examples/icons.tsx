import { Icon, icon } from '@roadmap/ui/icon'
import { PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import { ComponentExample, ComponentExamples } from './component-examples'

const ICONS = Object.values(icon)

export function IconsPage() {
  return (
    <>
      <PageHeader>
        <PageTitle>Icons</PageTitle>
        <PageDescription>
          Decorative symbols inherit text color. Pair each icon with a text label.
        </PageDescription>
      </PageHeader>
      <ComponentExamples>
        {ICONS.map((iconName) => (
          <ComponentExample key={iconName}>
            <Icon icon={iconName} />
            <span>{iconName}</span>
          </ComponentExample>
        ))}
      </ComponentExamples>
    </>
  )
}
