// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AnnotationLayer } from '../src/components/AnnotationLayer'
import { RedactionLayer } from '../src/components/RedactionLayer'
import type { PageOverlay } from '../src/domain/document'

const PAGE_WIDTH = 800
const PAGE_HEIGHT = 600

// The accent teal that leaked into redact mode as "green highlight overlays".
const CHROME_SELECTORS = [
  '.annotation-selection-frame',
  '.annotation-selection-edge',
  '.annotation-hover-edge',
  '.annotation-resize-handle',
  '.annotation-vertex-handle',
  '.annotation-extracted',
  '.is-selected',
  '.is-hovered',
]

function overlay(partial: Partial<PageOverlay> & Pick<PageOverlay, 'id' | 'type'>): PageOverlay {
  return {
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.05,
    color: '#147d72',
    opacity: 1,
    strokeWidth: 1,
    ...partial,
  } as PageOverlay
}

beforeAll(() => {
  // jsdom implements neither PointerEvent nor pointer capture.
  if (!('PointerEvent' in window)) {
    class TestPointerEvent extends MouseEvent {
      pointerId: number
      isPrimary: boolean
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        this.pointerId = init.pointerId ?? 1
        this.isPrimary = init.isPrimary ?? true
      }
    }
    Object.defineProperty(window, 'PointerEvent', { value: TestPointerEvent, writable: true })
  }
  // Layout is zero-sized in jsdom, so the layer needs a real box to map pointers into.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: PAGE_WIDTH,
    bottom: PAGE_HEIGHT,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(cleanup)

function renderLayer(overlays: PageOverlay[] = []) {
  const onCreate = vi.fn()
  const view = render(
    <RedactionLayer
      width={PAGE_WIDTH}
      height={PAGE_HEIGHT}
      overlays={overlays}
      onCreate={onCreate}
    />,
  )
  const layer = view.container.querySelector('.redaction-layer')
  if (!layer) throw new Error('redaction layer did not render')
  return { ...view, layer, onCreate }
}

function pointer(clientX: number, clientY: number) {
  return { clientX, clientY, button: 0, isPrimary: true, pointerId: 1 }
}

describe('RedactionLayer', () => {
  it('creates one black, zero-stroke mark from a drag', () => {
    const { layer, onCreate } = renderLayer()

    fireEvent.pointerDown(layer, pointer(100, 100))
    fireEvent.pointerMove(layer, pointer(300, 200))
    fireEvent.pointerUp(layer, pointer(300, 200))

    expect(onCreate).toHaveBeenCalledTimes(1)
    const created = onCreate.mock.calls[0]![0] as PageOverlay
    expect(created.type).toBe('redaction')
    expect(created.color).toBe('#000000')
    // The layer asks for strokeWidth 0; normalizeOverlay clamps it to 0.5. That is
    // inert here because export draws redactions as a solid filled rect (export.ts:378).
    expect(created.strokeWidth).toBe(0.5)
    expect(created.x).toBeCloseTo(100 / PAGE_WIDTH, 3)
    expect(created.y).toBeCloseTo(100 / PAGE_HEIGHT, 3)
    expect(created.width).toBeCloseTo(200 / PAGE_WIDTH, 3)
    expect(created.height).toBeCloseTo(100 / PAGE_HEIGHT, 3)
  })

  it('shows only a black draft box while dragging, never annotation chrome', () => {
    const { container, layer } = renderLayer([
      overlay({ id: 'analysed', type: 'text', extracted: true }),
      overlay({ id: 'highlight', type: 'highlight' }),
    ])

    fireEvent.pointerDown(layer, pointer(100, 100))
    fireEvent.pointerMove(layer, pointer(300, 200))

    const drafts = container.querySelectorAll('.annotation.is-draft')
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.className).toContain('annotation-redaction')
    expect(container.querySelectorAll('.annotation')).toHaveLength(1)
    for (const selector of CHROME_SELECTORS) {
      expect(container.querySelectorAll(selector)).toHaveLength(0)
    }
  })

  it('renders existing redaction marks and hides every other overlay', () => {
    const { container } = renderLayer([
      overlay({ id: 'analysed', type: 'text', extracted: true }),
      overlay({ id: 'mark', type: 'redaction', color: '#000000', strokeWidth: 0 }),
      overlay({ id: 'ellipse', type: 'ellipse' }),
    ])

    expect(container.querySelectorAll('.annotation')).toHaveLength(1)
    expect(container.querySelectorAll('.annotation-redaction')).toHaveLength(1)
    expect(container.querySelector('.annotation-redaction-fill')).not.toBeNull()
    for (const selector of CHROME_SELECTORS) {
      expect(container.querySelectorAll(selector)).toHaveLength(0)
    }
  })

  it('places a default mark when the pointer barely moves', () => {
    const { layer, onCreate } = renderLayer()

    fireEvent.pointerDown(layer, pointer(100, 100))
    fireEvent.pointerMove(layer, pointer(102, 101))
    fireEvent.pointerUp(layer, pointer(102, 101))

    expect(onCreate).toHaveBeenCalledTimes(1)
    const created = onCreate.mock.calls[0]![0] as PageOverlay
    expect(created.type).toBe('redaction')
    expect(created.width).toBeGreaterThan(0)
    expect(created.height).toBeGreaterThan(0)
  })

  it('discards the draft when the pointer is cancelled', () => {
    const { container, layer, onCreate } = renderLayer()

    fireEvent.pointerDown(layer, pointer(100, 100))
    fireEvent.pointerMove(layer, pointer(300, 200))
    expect(container.querySelectorAll('.annotation.is-draft')).toHaveLength(1)

    fireEvent.pointerCancel(layer, pointer(300, 200))
    expect(onCreate).not.toHaveBeenCalled()
    expect(container.querySelectorAll('.annotation.is-draft')).toHaveLength(0)
  })
})

describe('AnnotationLayer redact mode', () => {
  // Redaction lives in RedactionLayer only. If AnnotationLayer starts handling the
  // tool again, both layers draw marks and the accent chrome leaks back in.
  it('ignores the redaction tool instead of drawing marks itself', () => {
    const onCreate = vi.fn()
    const { container } = render(
      <AnnotationLayer
        width={PAGE_WIDTH}
        height={PAGE_HEIGHT}
        renderScale={1}
        overlays={[overlay({ id: 'analysed', type: 'text', extracted: true })]}
        interactive
        tool="redaction"
        onCreate={onCreate}
      />,
    )
    const layer = container.querySelector('.annotation-layer')
    if (!layer) throw new Error('annotation layer did not render')

    fireEvent.pointerDown(layer, pointer(100, 100))
    fireEvent.pointerMove(layer, pointer(300, 200))
    fireEvent.pointerUp(layer, pointer(300, 200))

    expect(onCreate).not.toHaveBeenCalled()
    expect(container.querySelectorAll('.annotation-redaction')).toHaveLength(0)
    expect(container.querySelectorAll('.annotation.is-draft')).toHaveLength(0)
  })
})
