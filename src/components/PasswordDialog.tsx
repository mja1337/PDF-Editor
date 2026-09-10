import { useEffect, useRef, useState } from 'react'

export function PasswordDialog({
  fileName,
  incorrect,
  onSubmit,
  onCancel,
}: {
  fileName: string
  incorrect: boolean
  onSubmit: (password: string) => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    dialogRef.current?.showModal()
    inputRef.current?.focus()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog password-dialog"
      aria-labelledby="password-title"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <h2 id="password-title">Enter PDF password</h2>
      <p>
        <strong>{fileName}</strong> is password-protected. Enter the password to open it in this
        browser.
      </p>
      <p className="password-hint">
        Your password stays in memory for this session only. It is not saved to device storage.
      </p>
      <label>
        Password
        <input
          ref={inputRef}
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && password.trim()) onSubmit(password)
          }}
        />
      </label>
      <label className="password-show">
        <input
          type="checkbox"
          checked={showPassword}
          onChange={(event) => setShowPassword(event.target.checked)}
        />
        Show password
      </label>
      {incorrect && (
        <p role="alert" className="password-error">
          That password did not work. Try again.
        </p>
      )}
      <div className="signature-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" disabled={!password.trim()} onClick={() => onSubmit(password)}>
          Open PDF
        </button>
      </div>
    </dialog>
  )
}
