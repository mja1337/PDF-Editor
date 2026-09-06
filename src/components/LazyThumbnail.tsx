import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PageRef, WatermarkConfig } from '../domain/document'
import { PdfCanvas } from './PdfCanvas'

interface LazyThumbnailProps {
  document: PDFDocumentProxy
  page: PageRef
  position: number
  selected: boolean
  dragged: boolean
  onSelect: (event: React.MouseEvent<HTMLButtonElement>) => void
  onContextMenu?: (event: React.MouseEvent<HTMLLIElement>) => void
  onMove: (targetIndex: number) => void
  onDragStart: () => void
  onDragEnd: () => void
  watermark?: WatermarkConfig | null
}

export function LazyThumbnail({
  document,
  page,
  position,
  selected,
  dragged,
  onSelect,
  onContextMenu,
  onMove,
  onDragStart,
  onDragEnd,
  watermark,
}: LazyThumbnailProps) {
  const itemRef = useRef<HTMLLIElement>(null)
  const [visible, setVisible] = useState(position < 4)

  useEffect(() => {
    const item = itemRef.current
    if (!item || !('IntersectionObserver' in window)) {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '320px 0px' },
    )
    observer.observe(item)
    return () => observer.disconnect()
  }, [])

  return (
    <li
      ref={itemRef}
      id={`thumbnail-${page.id}`}
      className={`thumbnail-item ${selected ? 'is-selected' : ''} ${dragged ? 'is-dragged' : ''}`}
      draggable
      onContextMenu={onContextMenu}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-pdf-page', page.id)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(event) => {
        event.preventDefault()
        onMove(position)
      }}
    >
      <button
        type="button"
        className="thumbnail-button"
        aria-pressed={selected}
        aria-label={`Select page ${position + 1}`}
        onClick={onSelect}
      >
        <span className="thumbnail-preview">
          {visible ? (
            <PdfCanvas
              document={document}
              pageIndex={page.sourcePageIndex}
              rotationDelta={page.rotationDelta}
              targetWidth={164}
              label={`Preview of page ${position + 1}`}
              watermark={watermark}
          overlays={page.overlays.filter(
            (overlay) => !overlay.extracted || overlay.edited,
          )}
            />
          ) : (
            <span className="thumbnail-placeholder" aria-hidden="true" />
          )}
        </span>
        <span className="thumbnail-meta">
          <span>Page {position + 1}</span>
          {page.rotationDelta !== 0 && <span>{page.rotationDelta}°</span>}
        </span>
      </button>
    </li>
  )
}
