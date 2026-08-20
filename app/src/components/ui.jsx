import React, { useState } from 'react'

export function BigButton({ color = '', sub, children, ...rest }) {
  return (
    <button className={`bigbtn ${color}`} {...rest}>
      {children}
      {sub && <small>{sub}</small>}
    </button>
  )
}

export function Modal({ title, sub, onClose, children }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet-modal" onClick={(e) => e.stopPropagation()}>
        {title && <h3>{title}</h3>}
        {sub && <div className="sub">{sub}</div>}
        {children}
      </div>
    </div>
  )
}

// Big-thumb number pad. Returns a number via onSubmit.
export function NumPad({ title, sub, unit, initial = '', allowDecimal = true, submitLabel = 'Save', onSubmit, onCancel }) {
  const [val, setVal] = useState(String(initial))
  const press = (k) => {
    if (k === '⌫') return setVal((v) => v.slice(0, -1))
    if (k === '.' && (val.includes('.') || !allowDecimal)) return
    if (val.replace('.', '').length >= 6) return
    setVal((v) => v + k)
  }
  const num = parseFloat(val)
  return (
    <Modal title={title} sub={sub} onClose={onCancel}>
      <div className="np-display">
        {val || '0'}
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className="np-grid">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', allowDecimal ? '.' : '', '0', '⌫'].map((k, i) =>
          k === '' ? (
            <span key={i} />
          ) : (
            <button key={i} className={`np-key ${k === '⌫' ? 'fn' : ''}`} onClick={() => press(k)}>
              {k}
            </button>
          )
        )}
      </div>
      <div className="btnrow" style={{ marginTop: 12 }}>
        <BigButton color="ghost" onClick={onCancel}>Cancel</BigButton>
        <BigButton color="gold" disabled={isNaN(num)} onClick={() => onSubmit(num)}>
          {submitLabel}
        </BigButton>
      </div>
    </Modal>
  )
}

export function Chips({ options, value, onChange }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o} className={`chip ${value === o ? 'on' : ''}`} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  )
}

// Floating "+ Note" button with its own modal.
export function NoteFab({ onSave }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  return (
    <>
      <button className="fab-note" onClick={() => setOpen(true)}>+ Note</button>
      {open && (
        <Modal title="Field note" sub="Timestamped and added to the log." onClose={() => setOpen(false)}>
          <textarea className="note" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
          <div className="btnrow" style={{ marginTop: 12 }}>
            <BigButton color="ghost" onClick={() => setOpen(false)}>Cancel</BigButton>
            <BigButton
              color="gold"
              disabled={!text.trim()}
              onClick={async () => {
                await onSave(text.trim())
                setText('')
                setOpen(false)
              }}
            >
              Save note
            </BigButton>
          </div>
        </Modal>
      )}
    </>
  )
}

export function Loading() {
  return <div className="loading">Loading…</div>
}

export function ErrBox({ children }) {
  return <div className="errbox">{children}</div>
}
