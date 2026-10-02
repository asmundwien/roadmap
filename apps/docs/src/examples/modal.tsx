import { Button } from '@roadmap/ui/button'
import { Modal } from '@roadmap/ui/modal'
import { PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import { useState } from 'react'

export function ModalPage() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <PageHeader>
        <PageTitle>Modal</PageTitle>
        <PageDescription>
          A native dialog keeps focus inside and stops background scrolling while open. Escape, the
          close button, and the backdrop request dismissal.
        </PageDescription>
      </PageHeader>
      <Surface>
        <SurfaceTitle>Confirmation</SurfaceTitle>
        <SurfaceDescription>
          Open the dialog to inspect its focus and dismissal behavior.
        </SurfaceDescription>
        <Button onClick={() => setOpen(true)}>Open modal</Button>
      </Surface>
      <Modal open={open} onClose={() => setOpen(false)} title="Confirm action">
        <p>This example leaves application state unchanged.</p>
        <Button variant="primary" onClick={() => setOpen(false)}>
          Continue
        </Button>
      </Modal>
    </>
  )
}
