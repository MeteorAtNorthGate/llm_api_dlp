/** ChatInput — text input area with file upload and model selector. */

import { useState, useRef, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import useT from '../../hooks/useT';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES = 5;

// Each group becomes a SEPARATE entry in the file-picker's file-type dropdown.
// (Only effective via showOpenFilePicker; the <input> fallback uses a flat list.)
// Image formats intentionally excluded — DLP text inspection cannot scan pixel data.
const FILE_TYPE_GROUPS = [
  {
    description: 'All Supported Files',
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/plain': ['.txt'],
      'text/csv': ['.csv'],
      'text/markdown': ['.md'],
    },
  },
  { description: 'PDF Documents', accept: { 'application/pdf': ['.pdf'] } },
  {
    description: 'Word Documents',
    accept: {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
  },
  {
    description: 'Excel Spreadsheets',
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
  },
  {
    description: 'Text Files',
    accept: { 'text/plain': ['.txt'], 'text/csv': ['.csv'], 'text/markdown': ['.md'] },
  },
];

// Flat extension list for the <input> fallback — stays as one entry but at
// least keeps the filter label short (no multi-hundred-char MIME strings).
const ACCEPT_EXTENSIONS_STR =
  '.pdf,.docx,.xlsx,.xls,.txt,.csv,.md';

// Quick lookup: which extensions are allowed (for client-side validation).
const ALLOWED_EXTS = new Set(
  ACCEPT_EXTENSIONS_STR.split(',').map((s) => s.slice(1))
);

const FILE_TYPE_ICONS = {
  pdf: '📄',
  docx: '📝',
  xlsx: '📊',
  xls: '📊',
  txt: '📃',
  csv: '📃',
  md: '📃',
};

function getFileIcon(file) {
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
  reasoningEffort = '',
  onReasoningEffortChange = () => {},
  hasActiveConversation = false,
}) {
  const t = useT();
  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null); // Fallback <input> when showOpenFilePicker unavailable

  // Auto-resize textarea
  const resizeTextarea = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, []);

  // Shared file-processing logic (used by both dropzone and custom picker).
  const addFiles = useCallback((newFiles) => {
    const stamped = newFiles.map((f) => ({
      file: f,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }));
    setFiles((prev) => {
      const combined = [...prev, ...stamped];
      return combined.slice(0, MAX_FILES);
    });
  }, []);

  const onDrop = useCallback((accepted, _rejected) => {
    addFiles(accepted);
  }, [addFiles]);

  // Custom file picker: uses showOpenFilePicker with MULTIPLE type groups so
  // that Windows' file-type dropdown shows separate entries (e.g. "PDF
  // Documents", "Images"…) instead of one unreadable line.
  const openFilePicker = useCallback(async () => {
    if (isStreaming) return;

    // Path 1 – File System Access API (Chrome / Edge)
    if (typeof window !== 'undefined' && window.showOpenFilePicker) {
      try {
        const handles = await window.showOpenFilePicker({
          multiple: true,
          types: FILE_TYPE_GROUPS,
        });
        const fileObjs = await Promise.all(handles.map((h) => h.getFile()));

        // Client-side validation (matching dropzone behaviour)
        const valid = fileObjs.filter(
          (f) => {
            const ext = f.name?.split('.').pop()?.toLowerCase();
            return ext && ALLOWED_EXTS.has(ext) && f.size <= MAX_FILE_SIZE;
          }
        ).slice(0, MAX_FILES);

        if (valid.length > 0) addFiles(valid);
        return;
      } catch (err) {
        // AbortError = user cancelled → silent
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // SecurityError or anything else → fall back to <input>
        console.warn('showOpenFilePicker failed, falling back to <input>:', err);
      }
    }

    // Path 2 – fallback via hidden <input type="file">
    if (fileInputRef.current) {
      fileInputRef.current.value = null;
      fileInputRef.current.click();
    }
  }, [isStreaming, addFiles]);

  // Handler for the fallback <input>'s onChange event.
  const handleFileInputChange = useCallback((e) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;
    const valid = selected
      .filter((f) => {
        const ext = f.name?.split('.').pop()?.toLowerCase();
        return ext && ALLOWED_EXTS.has(ext) && f.size <= MAX_FILE_SIZE;
      })
      .slice(0, MAX_FILES);
    if (valid.length > 0) addFiles(valid);
    // Reset so the same file can be picked again
    e.target.value = null;
  }, [addFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/plain': ['.txt'],
      'text/csv': ['.csv'],
      'text/markdown': ['.md'],
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
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs text-base-content/50 font-medium whitespace-nowrap">{t('chat.model')}:</label>
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
          <label className="text-xs text-base-content/50 font-medium whitespace-nowrap">{t('chat.thinking')}:</label>
          <select
            className="select select-bordered select-xs max-w-[140px]"
            value={reasoningEffort}
            onChange={(e) => onReasoningEffortChange(e.target.value)}
            disabled={isStreaming}
          >
            <option value="">{t('chat.thinking.auto')}</option>
            <option value="low">{t('chat.thinking.low')}</option>
            <option value="medium">{t('chat.thinking.medium')}</option>
            <option value="high">{t('chat.thinking.high')}</option>
            <option value="max">{t('chat.thinking.max')}</option>
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
        <input {...getInputProps()} accept={ACCEPT_EXTENSIONS_STR} />

        {/* Fallback file input when showOpenFilePicker is unavailable */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_EXTENSIONS_STR}
          onChange={handleFileInputChange}
          multiple
          className="hidden"
          tabIndex={-1}
        />

        {/* Attach file button */}
        <button
          type="button"
          className="btn btn-ghost btn-circle btn-sm flex-shrink-0"
          onClick={openFilePicker}
          disabled={isStreaming}
          title={hasActiveConversation ? t('chat.attachFiles') : t('chat.attachHint')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          className="textarea textarea-bordered flex-1 min-h-[44px] max-h-[200px] resize-none"
          placeholder={isStreaming ? t('chat.waiting') : isDragActive ? t('chat.dropFiles') : t('chat.placeholder')}
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
