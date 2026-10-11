import { useId, useRef, useState, type FormEvent } from 'react'
import { isAddress } from '../lib/metrics'

interface Props {
  busy: boolean
  onSubmit: (address: string) => void
  onCancel: () => void
}

export function AddressForm({ busy, onSubmit, onCancel }: Props) {
  const id = useId()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (!isAddress(v)) {
      setError('Enter a 42-character address that starts with 0x, for example 0xd8dA…6045.')
      inputRef.current?.focus()
      return
    }
    setError(null)
    onSubmit(v)
  }

  return (
    <form className="lookup" onSubmit={submit} noValidate>
      <label className="lookup-label" htmlFor={`${id}-address`}>
        Wallet address
      </label>
      <div className="lookup-row">
        <input
          ref={inputRef}
          id={`${id}-address`}
          className="lookup-input num"
          name="wallet-address"
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
        />
        {busy ? (
          // Distinct keys so React mounts a fresh node for each button. With a shared node the
          // click handler flipped it to type="submit" before the browser's activation step ran,
          // which submitted the form and restarted the read. preventDefault guards the same path.
          <button
            key="stop"
            type="button"
            className="button button-secondary"
            onClick={(e) => {
              e.preventDefault()
              onCancel()
            }}
          >
            Stop reading
          </button>
        ) : (
          <button key="read" type="submit" className="button button-primary">
            Read history
          </button>
        )}
      </div>
      {error ? (
        <p className="lookup-error" id={`${id}-error`}>
          {error}
        </p>
      ) : (
        <p className="lookup-hint" id={`${id}-hint`}>
          Any Ethereum-style address. No wallet connection and nothing is signed.
        </p>
      )}
    </form>
  )
}
