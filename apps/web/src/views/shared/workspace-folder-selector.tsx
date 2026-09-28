import type { Query, QueryResult } from '@roadmap/contracts'
import { Button } from '@roadmap/ui/button'
import { useState } from 'react'

type WorkspaceFolderSelectorProps = {
  label: string
  description: string
  path: string
  error?: string
  disabled: boolean
  query: (request: Query) => Promise<QueryResult>
  onChange: (path: string) => void
}

export function WorkspaceFolderSelector({
  label,
  description,
  path,
  error,
  disabled,
  query,
  onChange,
}: WorkspaceFolderSelectorProps) {
  const [choosing, setChoosing] = useState(false)
  const [selectionError, setSelectionError] = useState<string | null>(null)

  const choose = async () => {
    setChoosing(true)
    setSelectionError(null)
    try {
      const result = await query({ type: 'select-workspace' })
      if (!result.ok) setSelectionError(result.error.message)
      else if (result.type !== 'workspace-selection')
        setSelectionError('The server returned an unexpected folder selection result.')
      else if (result.path) onChange(result.path)
    } catch {
      setSelectionError('The server did not return a folder selection.')
    } finally {
      setChoosing(false)
    }
  }

  return (
    <fieldset className="settings-folder-field">
      <legend>{label}</legend>
      <small>{description}</small>
      <div className="settings-folder-control">
        <Button
          size="medium"
          type="button"
          disabled={disabled || choosing}
          onClick={() => void choose()}
        >
          {choosing ? 'Choosing…' : path ? 'Choose another folder' : 'Choose folder'}
        </Button>
        <output className={path ? '' : 'is-empty'} aria-live="polite">
          {path || 'No folder selected'}
        </output>
      </div>
      {(selectionError ?? error) && (
        <span className="settings-field-error">{selectionError ?? error}</span>
      )}
    </fieldset>
  )
}
