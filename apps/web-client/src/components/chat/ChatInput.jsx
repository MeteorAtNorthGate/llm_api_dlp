/** ChatInput — text input area with file upload and model selector. */

import { useState, useRef, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES = 5;

const FILE_TYPE_ICONS = {
  pdf: '📄',
  docx: '📝',
  doc: '📝',
  xlsx: '📊',
  xls: '📊',
  txt: '📃',
  csv: '📃',
  md: '📃',
  image: '🖼️',
};

function getFileIcon(file) {
  if (file.type?.startsWith('image/')) return FILE_TYPE_ICONS.image;
  const ext = file.name?.split('.').pop()?.toLowerCase();
  return FILE_TYPE_ICONS[ext] || '📎';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function ChatInput({
  onSend,
  isStreaming = false,
  models = [],
  selectedModel = '',
  onModelChange = () => {},
  hasActiveConversation = false,
}) {
  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]);
  const textareaRef = useRef(null);

  // Auto-resize textarea
  const resizeTextarea = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, []);

  const onDrop = useCallback((accepted, rejected) => {
    const newFiles = accepted.map((f) => ({
      file: f,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }));
    setFiles((prev) => {
      const combined = [...prev, ...newFiles];
      return combined.slice(0, MAX_FILES);
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/plain': ['.txt'],
      'text/csv': ['.csv'],
      'text/markdown': ['.md'],
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'],
    },
    maxSize: MAX_FILE_SIZE,
    maxFiles: MAX_FILES,
    disabled: isStreaming,
    noClick: true,     // We use our own button to trigger
    noKeyboard: true,
  });

  const removeFile = (id) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if ((!trimmed && files.length === 0) || isStreaming) return;

    onSend(trimmed, files.map((f) => f.file));
    setInput('');
    setFiles([]);
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    // Defer resize to next frame for accurate scrollHeight
    requestAnimationFrame(resizeTextarea);
  };

  const canSend = (input.trim() || files.length > 0) && !isStreaming;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 p-4 bg-base-100 border-t border-base-300">
      {/* Model selector row */}
      {models.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-base-content/50 font-medium whitespace-nowrap">Model:</label>
          <select
            className="select select-bordered select-xs max-w-[200px]"
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={isStreaming}
          >
            {models.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* File chips — shown when files are attached */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-1.5 bg-base-200 rounded-full pl-3 pr-1 py-1 text-sm"
            >
              <span className="text-base">{getFileIcon(f.file)}</span>
              <span className="max-w-[150px] truncate">{f.file.name}</span>
              <span className="text-base-content/40 text-xs">{formatSize(f.file.size)}</span>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-circle text-base-content/40 hover:text-error"
                onClick={() => removeFile(f.id)}
                disabled={isStreaming}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Drop zone + text input row */}
      <div
        {...getRootProps()}
        className={`flex gap-2 items-end rounded-lg border-2 border-dashed p-2 transition-colors ${
          isDragActive
            ? 'border-primary bg-primary/5'
            : 'border-transparent hover:border-base-300'
        }`}
      >
        <input {...getInputProps()} />

        {/* Attach file button */}
        <button
          type="button"
          className="btn btn-ghost btn-circle btn-sm flex-shrink-0"
          onClick={open}
          disabled={isStreaming}
          title={hasActiveConversation ? 'Attach files' : 'Send a message first to start a conversation'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          className="textarea textarea-bordered flex-1 min-h-[44px] max-h-[200px] resize-none"
          placeholder={isStreaming ? 'Waiting for response...' : isDragActive ? 'Drop files here...' : 'Type a message... (Enter to send, Shift+Enter for new line)'}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          rows={1}
        />

        <button
          className="btn btn-primary btn-square btn-sm flex-shrink-0"
          type="submit"
          disabled={!canSend}
        >
          {isStreaming ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
    </form>
  );
}
