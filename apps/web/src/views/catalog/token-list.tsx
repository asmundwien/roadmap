import './token-list.css'

export type ComponentTokenListProps = { tokens: readonly string[] }

export function ComponentTokenList({ tokens }: ComponentTokenListProps) {
  return (
    <div className="catalog-token-list">
      {tokens.map((token) => (
        <code key={token}>{token}</code>
      ))}
    </div>
  )
}
