/**
 * PROTOTYPE — throwaway. The contract every variant fills: a project screen and a front-page
 * card, so the "is the card a miniature of the screen" question is judged per variant.
 */

import type { ComponentType } from 'react'
import type { StrideProject } from './fixture.ts'

export interface ScreenProps {
  project: StrideProject
  /** Number of the map whose stride is open; null = fully collapsed (the resting default). */
  openMap: number | null
  /** Toggle a stride: opening one closes the rest — the single-open accordion. */
  onToggle: (mapNumber: number) => void
}

export interface CardProps {
  project: StrideProject
  onOpen: () => void
}

export interface Variant {
  name: string
  Screen: ComponentType<ScreenProps>
  Card: ComponentType<CardProps>
}
