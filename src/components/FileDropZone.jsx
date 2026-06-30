import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';

export function FileDropZone({ accept, multiple, hint, selectedFiles, onChange, error }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleDragEnter(e) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragOver(e) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragging(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onChange(files);
  }

  function handleInputChange(e) {
    onChange(Array.from(e.target.files || []));
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      inputRef.current?.click();
    }
  }

  return (
    <div className="file-drop-wrap">
      <div
        className={`file-drop-zone${isDragging ? ' file-drop-zone--active' : ''}`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={handleKeyDown}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        aria-label="File upload drop zone — click or drag files here"
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          style={{ display: 'none' }}
          onChange={handleInputChange}
        />
        <Upload
          className="file-drop-icon"
          size={28}
          aria-hidden="true"
        />
        <p className="file-drop-label">
          {isDragging ? 'Drop to upload' : 'Drop files here or click to browse'}
        </p>
        {hint && <p className="file-drop-hint">{hint}</p>}
      </div>

      {selectedFiles.length > 0 && (
        <ul className="lead-file-list">
          {selectedFiles.map((f) => (
            <li key={f.name}>
              {f.name}{' '}
              <span className="lead-file-size">({(f.size / 1024).toFixed(0)} KB)</span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="lead-error">{error}</p>}
    </div>
  );
}
