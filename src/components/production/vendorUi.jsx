/**
 * Small parts shared by the Vendors tab and its price books: labels, errors, the drop zone and the window shown over a list.
 */
import { useEffect, useRef, useState } from 'react';
import { FixedOverlay } from '../FixedOverlay.jsx';
import { fmtSize } from './vendorLib.js';

export function Labeled({ label, children, wide }) {
  return (
    <label style={{ display: 'grid', gap: '4px', fontSize: '12px', color: '#6b7280', gridColumn: wide ? '1 / -1' : undefined }}>
      {label}
      {children}
    </label>
  );
}

export function Err({ text }) {
  return text ? <p role="alert" style={{ color: '#b91c1c', fontSize: '13px', margin: '6px 0' }}>{text}</p> : null;
}

// With onFiles, every file dropped or chosen is passed on (in order); with onFile, only the first.
export function DropZone({ title, hint, accept, onFile, onFiles, disabled, file }) {
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const take = (list) => {
    const fs = Array.from(list ?? []).filter(Boolean);
    if (!fs.length || disabled) return;
    if (onFiles) onFiles(fs); else onFile(fs[0]);
  };
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); input.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) { e.dataTransfer.dropEffect = 'copy'; setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
      style={{
        border: `2px dashed ${over ? '#78350f' : '#d1d5db'}`, borderRadius: '8px', padding: '16px', textAlign: 'center',
        background: over ? '#fef3c7' : '#f9fafb', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
      }}
    >
      <div style={{ fontSize: '14px', fontWeight: 600, color: '#374151' }}>{file ? file.name : title}</div>
      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>{file ? `${fmtSize(file.size)} · drop another file or click to change` : hint}</div>
      <input ref={input} type="file" accept={accept} multiple={!!onFiles} style={{ display: 'none' }} disabled={disabled}
        onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

export function PartWindow({ children, onClose, wide = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <FixedOverlay>
      <div
        role="dialog" aria-modal="true"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto' }}
      >
        <div style={{ width: '100%', maxWidth: wide ? '1040px' : '720px', background: '#fff', borderRadius: '10px', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}>
          {children}
        </div>
      </div>
    </FixedOverlay>
  );
}
