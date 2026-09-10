import { splitExcerptHighlight } from '../pdf/navigation'

export function SearchExcerpt({ excerpt, query }: { excerpt: string; query: string }) {
  const parts = splitExcerptHighlight(excerpt, query)
  if (!parts.match) return <span>{excerpt}</span>
  return (
    <span>
      {parts.before}
      <mark>{parts.match}</mark>
      {parts.after}
    </span>
  )
}
