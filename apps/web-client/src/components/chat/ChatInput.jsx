/** ChatInput — text input area with model selector and send button. */

import { useState, useRef, useEffect } from 'react';

export default function ChatInput({
  onSend,
  isStreaming = false,
  models = [],
  selectedModel = '',
  onModelChange = () => {},
}) {
  const [input, setInput] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSubmit = (e) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

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
          {models.length === 0 && (
            <span className="text-xs text-warning">No models available</span>
          )}
        </div>
      )}

      {/* Text input row */}
      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          className="textarea textarea-bordered flex-1 min-h-[44px] max-h-[200px] resize-none"
          placeholder={isStreaming ? 'Waiting for response...' : 'Type a message... (Enter to send, Shift+Enter for new line)'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          rows={1}
        />
        <button
          className="btn btn-primary btn-square"
          type="submit"
          disabled={!input.trim() || isStreaming}
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
