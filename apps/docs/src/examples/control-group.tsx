import { Button } from '@roadmap/ui/button'
import { ControlGroup } from '@roadmap/ui/control-group'
import { PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import { TextInput } from '@roadmap/ui/text-input'

export function ControlGroupPage() {
  return (
    <>
      <PageHeader>
        <PageTitle>Control group</PageTitle>
        <PageDescription>
          Group buttons or combine a text input with a button. The group size applies to every
          control, overriding child sizes.
        </PageDescription>
      </PageHeader>
      <Surface>
        <SurfaceTitle>Related actions</SurfaceTitle>
        <SurfaceDescription>Adjacent buttons share a border.</SurfaceDescription>
        <ControlGroup>
          <Button type="button">Cancel</Button>
          <Button variant="primary" type="button">
            Apply
          </Button>
        </ControlGroup>
      </Surface>
      <Surface>
        <SurfaceTitle>Input and save button</SurfaceTitle>
        <SurfaceDescription>
          The large group gives the input and save button the same height.
        </SurfaceDescription>
        <label htmlFor="control-name">Name</label>
        <ControlGroup size="large">
          <TextInput id="control-name" name="name" placeholder="Name" />
          <Button variant="primary" type="button">
            Save
          </Button>
        </ControlGroup>
      </Surface>
    </>
  )
}
