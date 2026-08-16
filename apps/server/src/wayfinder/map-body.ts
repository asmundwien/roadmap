import type { Decision, MapBody, MapSection } from '@roadmap/contracts'

/**
 * Template headings, keyed by their normalised form. The extra keys are drift tolerance: a map
 * whose author wrote "Decisions" or "Fog of war" still parses into the right slot.
 */
const HEADING_ALIASES: Record<string, TemplateSection> = {
  destination: 'destination',
  notes: 'notes',
  'decisions so far': 'decisions',
  decisions: 'decisions',
  'not yet specified': 'notYetSpecified',
  'fog of war': 'notYetSpecified',
  fog: 'notYetSpecified',
  'out of scope': 'outOfScope',
}

type TemplateSection = 'destination' | 'notes' | 'decisions' | 'notYetSpecified' | 'outOfScope'

const TEMPLATE_HEADINGS: Record<TemplateSection, string> = {
  destination: 'Destination',
  notes: 'Notes',
  decisions: 'Decisions so far',
  notYetSpecified: 'Not yet specified',
  outOfScope: 'Out of scope',
}

/** Splits a map body into its `##` sections and reads the template out of them. */
export function parseMapBody(raw: string): MapBody {
  const sections = splitSections(raw ?? '')
  const found = new Map<TemplateSection, MapSection>()

  for (const section of sections) {
    const key = HEADING_ALIASES[normaliseHeading(section.heading)]
    // First occurrence wins: a duplicated heading is drift, not a reason to lose the original.
    if (key && !found.has(key)) found.set(key, section)
  }

  const missingSections = (Object.keys(TEMPLATE_HEADINGS) as TemplateSection[])
    .filter((key) => !found.has(key))
    .map((key) => TEMPLATE_HEADINGS[key])

  // Fog is stricter than the other list sections: a patch is a bullet, and prose is commentary
  // about the fog ("no known fog remains"), which must never render as a patch.
  const fog = found.get('notYetSpecified')
  const fogPatches = fog ? bulletItems(fog.text) : []

  return {
    raw,
    destination: found.get('destination')?.text ?? '',
    notes: found.get('notes')?.items ?? [],
    decisions: (found.get('decisions')?.items ?? []).map(parseDecision),
    notYetSpecified: fogPatches,
    notYetSpecifiedNote: fog && fogPatches.length === 0 ? fog.text : '',
    outOfScope: found.get('outOfScope')?.items ?? [],
    sections,
    missingSections,
  }
}

/**
 * Reads one Decisions-so-far bullet: `[Title](url) — gist`. The dash may be an em dash, en dash,
 * or hyphen, and a bullet that matches nothing at all still survives as its own title.
 */
export function parseDecision(item: string): Decision {
  const linked = /^\[(.+?)\]\((\S+?)\)\s*(?:[—–-]\s*(.*))?$/s.exec(item)
  if (linked) {
    return {
      title: (linked[1] ?? '').trim(),
      url: linked[2] ?? null,
      gist: (linked[3] ?? '').trim(),
      raw: item,
    }
  }

  const dashed = /^(.+?)\s+[—–]\s+(.*)$/s.exec(item)
  if (dashed) {
    return { title: (dashed[1] ?? '').trim(), url: null, gist: (dashed[2] ?? '').trim(), raw: item }
  }

  return { title: item.trim(), url: null, gist: '', raw: item }
}

/**
 * Every `##`-level block, in order. Deeper headings stay inside their section rather than starting
 * a new one, and content above the first heading is dropped — the template has none.
 */
function splitSections(raw: string): MapSection[] {
  const sections: MapSection[] = []
  let heading: string | null = null
  let buffer: string[] = []

  const flush = () => {
    if (heading !== null) sections.push(toSection(heading, buffer.join('\n')))
    buffer = []
  }

  for (const line of stripComments(raw).split('\n')) {
    const match = /^##\s+(.*?)\s*#*\s*$/.exec(line)
    if (match) {
      flush()
      heading = match[1] ?? ''
    } else if (heading !== null) {
      buffer.push(line)
    }
  }
  flush()

  return sections
}

function toSection(heading: string, body: string): MapSection {
  const text = body.trim()
  return { heading, text, items: toItems(text) }
}

/**
 * A section's content as a list. Bullets become items; prose falls back to one item per paragraph,
 * so a section that drifted away from a list still reads as something rather than nothing.
 */
function toItems(text: string): string[] {
  const bullets = bulletItems(text)
  if (bullets.length > 0) return bullets

  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
}

/** The section's bullets alone, wrapped continuation lines joined — no prose fallback. */
function bulletItems(text: string): string[] {
  if (text === '') return []

  const items: string[] = []
  let current: string | null = null

  for (const line of text.split('\n')) {
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      if (current !== null) items.push(current)
      current = bullet[1] ?? ''
    } else if (current !== null && line.trim() !== '') {
      // An indented continuation line belongs to the bullet above it.
      current += ` ${line.trim()}`
    } else if (current !== null) {
      items.push(current)
      current = null
    }
  }
  if (current !== null) items.push(current)

  return items.map((item) => item.trim()).filter((item) => item !== '')
}

/** Drops the template's `<!-- ... -->` guidance so it never reads as content. */
function stripComments(raw: string): string {
  return raw.replace(/<!--[\s\S]*?-->/g, '')
}

function normaliseHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
