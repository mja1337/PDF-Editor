import {
  ArrowUpRight,
  Circle,
  Diamond,
  Eraser,
  EyeOff,
  Highlighter,
  MousePointer2,
  Pencil,
  PenLine,
  Slash,
  Square,
  Strikethrough,
  Type,
  Underline,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AnnotationTool } from '../components/AnnotationLayer'

export const ANNOTATE_PALETTE: Array<
  | { id: AnnotationTool; label: string; icon: LucideIcon }
  | { id: 'signature'; label: string; icon: LucideIcon }
> = [
  { id: 'select', label: 'Select', icon: MousePointer2 },
  { id: 'ink', label: 'Draw', icon: Pencil },
  { id: 'eraser', label: 'Erase', icon: Eraser },
  { id: 'signature', label: 'Signature', icon: PenLine },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'highlight', label: 'Highlight', icon: Highlighter },
  { id: 'underline', label: 'Underline', icon: Underline },
  { id: 'strikeout', label: 'Strike', icon: Strikethrough },
  { id: 'rectangle', label: 'Box', icon: Square },
  { id: 'ellipse', label: 'Ellipse', icon: Circle },
  { id: 'line', label: 'Line', icon: Slash },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  { id: 'diamond', label: 'Diamond', icon: Diamond },
  { id: 'redaction', label: 'Redact', icon: EyeOff },
]

export const ANNOTATE_COLOURS = [
  '#111111',
  '#ffffff',
  '#e05252',
  '#f4d35e',
  '#f97316',
  '#22c55e',
  '#147d72',
  '#3b82f6',
  '#a855f7',
]

export const STROKE_WEIGHTS = [1, 2, 4, 8] as const

export function annotationUsesColour(tool: AnnotationTool) {
  return (
    tool === 'ink' ||
    tool === 'highlight' ||
    tool === 'underline' ||
    tool === 'strikeout' ||
    tool === 'rectangle' ||
    tool === 'ellipse' ||
    tool === 'line' ||
    tool === 'arrow' ||
    tool === 'diamond'
  )
}

export function annotationUsesWeight(tool: AnnotationTool) {
  return (
    tool === 'ink' ||
    tool === 'underline' ||
    tool === 'strikeout' ||
    tool === 'rectangle' ||
    tool === 'ellipse' ||
    tool === 'line' ||
    tool === 'arrow' ||
    tool === 'diamond'
  )
}

export function annotationUsesFill(tool: AnnotationTool) {
  return tool === 'rectangle' || tool === 'ellipse' || tool === 'diamond'
}

export function annotationHint(tool: AnnotationTool, hasExtracted: boolean) {
  if (tool === 'select') return 'Drag a mark to move it. Handles resize. Click empty space to clear the selection.'
  if (tool === 'ink') return 'Draw freely like a pen. Click a stroke to move it. Escape returns to Select.'
  if (tool === 'eraser') return 'Drag over strokes, shapes, or notes. Escape returns to Select.'
  if (tool === 'highlight' || tool === 'underline' || tool === 'strikeout') {
    return hasExtracted
      ? 'Click a mark to move it, or an analysed line to mark. Drag empty space to draw. Escape returns to Select.'
      : 'Drag empty space to size a mark. Click an existing mark to move it.'
  }
  if (tool === 'text') return 'Click or drag empty space to place text, then type. Click a mark to move it.'
  if (tool === 'line' || tool === 'arrow') {
    return 'Drag empty space from A to B. Click a mark to move it. Shift snaps 45°. Escape returns to Select.'
  }
  if (tool === 'rectangle' || tool === 'ellipse' || tool === 'diamond') {
    return 'Drag empty space to size. Click a mark to move it. Shift constrains. Escape returns to Select.'
  }
  if (tool === 'redaction') {
    return 'Drag over text or areas to mark for removal. Export uses secure redaction when marks are present.'
  }
  return 'Click the page to place the annotation.'
}
