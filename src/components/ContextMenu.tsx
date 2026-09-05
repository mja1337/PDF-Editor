import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: React.ReactNode
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  onSelect: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  label: string
  items: ContextMenuItem[]
  onClose: () => void
}

const VIEWPORT_MARGIN = 8

export function ContextMenu({ x, y, label, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const bounds = menu.getBoundingClientRect()
    setPosition({
      x: Math.max(
        VIEWPORT_MARGIN,
        Math.min(x, window.innerWidth - bounds.width - VIEWPORT_MARGIN),
      ),
      y: Math.max(
        VIEWPORT_MARGIN,
        Math.min(y, window.innerHeight - bounds.height - VIEWPORT_MARGIN),
      ),
    })
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [items, x, y])

  useEffect(() => {
    const closeForOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const close = () => onClose()
    window.addEventListener('pointerdown', closeForOutsidePointer, true)
    window.addEventListener('resize', close)
    window.addEventListener('wheel', close, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', closeForOutsidePointer, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('wheel', close, true)
      window.removeEventListener('blur', close)
    }
  }, [onClose])

  const moveFocus = (direction: 1 | -1 | 'first' | 'last') => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    )
    if (buttons.length === 0) return
    if (direction === 'first') {
      buttons[0].focus()
      return
    }
    if (direction === 'last') {
      buttons.at(-1)?.focus()
      return
    }
    const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = (Math.max(activeIndex, 0) + direction + buttons.length) % buttons.length
    buttons[nextIndex].focus()
  }

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={label}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          moveFocus(1)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          moveFocus(-1)
        } else if (event.key === 'Home') {
          event.preventDefault()
          moveFocus('first')
        } else if (event.key === 'End') {
          event.preventDefault()
          moveFocus('last')
        }
      }}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={item.separatorBefore ? 'context-menu-group' : undefined}
        >
          <button
            type="button"
            role="menuitem"
            className={item.danger ? 'is-danger' : undefined}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            <span className="context-menu-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span>{item.label}</span>
          </button>
        </div>
      ))}
    </div>
  )
}
