export function IconButton({
  label,
  disabled,
  onClick,
  children,
  className = '',
  title,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
