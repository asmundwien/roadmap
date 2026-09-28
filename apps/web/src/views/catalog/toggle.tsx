import {
  Section,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionTitle,
} from '@roadmap/ui/section'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import { Toggle, type ToggleProps } from '@roadmap/ui/toggle'
import { useState } from 'react'

type ToggleCatalogExampleProps = {
  initialState: ToggleProps['state']
  label: string
  disabled?: boolean
}

function ToggleCatalogExample({ initialState, label, disabled }: ToggleCatalogExampleProps) {
  const [state, setState] = useState(initialState)

  return (
    <Toggle
      state={state}
      disabled={disabled}
      onChange={(event) => setState(event.currentTarget.checked ? 'on' : 'off')}
    >
      {label}
    </Toggle>
  )
}

export function ToggleCatalogSection() {
  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Toggle</SectionTitle>
        <SectionDescription>
          Set a controlled state to off, on, or pending. Pending places the thumb in the middle and
          announces that the action is busy; it does not claim a confirmed on value. Disable any
          state when changes must wait for a request.
        </SectionDescription>
      </SectionHeader>
      <SectionBody>
        <Surface>
          <SurfaceTitle>Interactive states</SurfaceTitle>
          <SurfaceDescription>
            From top to bottom: off, pending, on. These examples update their state when clicked.
          </SurfaceDescription>
          <ToggleCatalogExample initialState="off" label="Notifications" />
          <ToggleCatalogExample initialState="pending" label="Automatic updates" />
          <ToggleCatalogExample initialState="on" label="Compact layout" />
        </Surface>
        <Surface>
          <SurfaceTitle>Disabled states</SurfaceTitle>
          <SurfaceDescription>Off, pending, and on each prevent interaction.</SurfaceDescription>
          <ToggleCatalogExample initialState="off" label="Notifications" disabled />
          <ToggleCatalogExample initialState="pending" label="Automatic updates" disabled />
          <ToggleCatalogExample initialState="on" label="Compact layout" disabled />
        </Surface>
      </SectionBody>
    </Section>
  )
}
