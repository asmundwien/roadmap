import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Toggle } from './toggle'

describe('Toggle', () => {
  it('associates visible text with a native switch and submits the on value', () => {
    const markup = renderToStaticMarkup(
      <Toggle state="on" onChange={() => {}} name="notifications" value="yes">
        Notifications
      </Toggle>,
    )

    expect(markup).toMatch(/<label[^>]*>.*<input[^>]*type="checkbox"[^>]*role="switch"/)
    expect(markup).toContain('checked=""')
    expect(markup).toContain('name="notifications"')
    expect(markup).toContain('value="yes"')
    expect(markup).toContain('Notifications</span></label>')
  })

  it('renders off as unchecked and pending in the neutral position with a status', () => {
    const off = renderToStaticMarkup(
      <Toggle state="off" onChange={() => {}} aria-label="Notifications" />,
    )
    const pending = renderToStaticMarkup(
      <Toggle state="pending" onChange={() => {}} aria-label="Notifications" />,
    )

    expect(off).toContain('aria-checked="false"')
    expect(off).not.toContain('checked=""')
    expect(off).not.toContain('aria-busy="true"')
    expect(pending).toContain('aria-checked="false"')
    expect(pending).not.toContain('checked=""')
    expect(pending).toContain('aria-busy="true"')
    expect(pending).toContain('role="status"')
    expect(pending).toContain('Pending')
    expect(pending).toMatch(/<\/label><span[^>]*role="status"/)
    expect(pending).not.toContain('aria-checked="mixed"')
  })

  it.each(['off', 'pending', 'on'] as const)('supports disabled in the %s state', (state) => {
    const markup = renderToStaticMarkup(
      <Toggle state={state} onChange={() => {}} disabled aria-label="Notifications" />,
    )

    expect(markup).toContain('disabled=""')
    expect(markup).toContain('aria-label="Notifications"')
  })
})
