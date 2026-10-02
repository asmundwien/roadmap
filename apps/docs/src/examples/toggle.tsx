import { PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import { Toggle, type ToggleProps } from '@roadmap/ui/toggle'
import { useState } from 'react'

type ToggleExampleProps = {
  initialState: ToggleProps['state']
  label: string
  disabled?: boolean
}

function ToggleExample({ initialState, label, disabled }: ToggleExampleProps) {
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

export function TogglePage() {
  return (
    <>
      <PageHeader>
        <PageTitle>Toggle</PageTitle>
        <PageDescription>
          Set a controlled state to off, on, or pending. Pending places the thumb in the middle and
          announces that the action is busy; it does not claim a confirmed on value. Disable any
          state when changes must wait for a request.
        </PageDescription>
      </PageHeader>
      <Surface>
        <SurfaceTitle>Interactive states</SurfaceTitle>
        <SurfaceDescription>
          From top to bottom: off, pending, on. These examples update their state when clicked.
        </SurfaceDescription>
        <ToggleExample initialState="off" label="Notifications" />
        <ToggleExample initialState="pending" label="Automatic updates" />
        <ToggleExample initialState="on" label="Compact layout" />
      </Surface>
      <Surface>
        <SurfaceTitle>Disabled states</SurfaceTitle>
        <SurfaceDescription>Off, pending, and on each prevent interaction.</SurfaceDescription>
        <ToggleExample initialState="off" label="Notifications" disabled />
        <ToggleExample initialState="pending" label="Automatic updates" disabled />
        <ToggleExample initialState="on" label="Compact layout" disabled />
      </Surface>
    </>
  )
}
