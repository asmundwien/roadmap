import { Button } from '@roadmap/ui/button'
import { Modal } from '@roadmap/ui/modal'
import { PageTitle } from '@roadmap/ui/page'
import { Section, SectionBody, SectionDescription, SectionHeader } from '@roadmap/ui/section'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import { useState } from 'react'

export function ModalCatalogSection() {
  const [open, setOpen] = useState(false)

  return (
    <Section>
      <SectionHeader>
        <PageTitle>Modal</PageTitle>
        <SectionDescription>
          A native dialog keeps focus inside and stops background scrolling while open. Escape, the
          close button, and the backdrop request dismissal.
        </SectionDescription>
      </SectionHeader>
      <SectionBody>
        <Surface>
          <SurfaceTitle>Confirmation</SurfaceTitle>
          <SurfaceDescription>
            Open the dialog to inspect its focus and dismissal behavior.
          </SurfaceDescription>
          <Button onClick={() => setOpen(true)}>Open modal</Button>
        </Surface>
      </SectionBody>
      <Modal open={open} onClose={() => setOpen(false)} title="Confirm action">
        <p>This example leaves application state unchanged.</p>
        <Button variant="primary" onClick={() => setOpen(false)}>
          Continue
        </Button>
      </Modal>
    </Section>
  )
}
