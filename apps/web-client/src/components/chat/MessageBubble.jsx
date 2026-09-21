/** MessageBubble — renders a single chat message with markdown and file attachments. */

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import useT from '../../hooks/useT';
import { normalizeLatexDelimiters } from '../../utils/latex';

const FILE_TYPE_ICONS = {
  pdf: '📄',
  docx: '📝',
  doc: '📝',
  xlsx: '📊',
  xls: '📊',
  txt: '📃',
  csv: '📃',
  md: '📃',
};

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function MessageBubble({ message, editable = false, onEditResend }) {
  const t = useT();
  const isUser = message.role === 'user';

  const content = useMemo(() => {
    if (typeof message.content !== 'string') return '';
    return normalizeLatexDelimiters(message.content);
  }, [message.content]);

  const attachments = message.attachments || [];
  const contentParts = message.content_parts;

  // Extract file references from content_parts (for locally-attached files before server round-trip)
  const fileRefsFromParts = useMemo(() => {
    if (!contentParts) return [];
    return contentParts
      .filter((p) => p.type === 'file')
      .map((p) => p.file_reference?.attachment_id)
      .filter(Boolean);
  }, [contentParts]);

  const hasAttachments = isUser && (attachments.length > 0 || fileRefsFromParts.length > 0);

  const [showThinking, setShowThinking] = useState(false);
  const hasReasoning = !isUser && !!message.reasoning_content;

  // Web-search trace. A live streamed turn carries it on `search` (with an
  // `in_progress` flag); a replayed one carries the persisted `search_meta`.
  const [showSearch, setShowSearch] = useState(false);
  const search = isUser ? null : (message.search ?? message.search_meta);
  const searchInProgress = !!search?.in_progress;
  const searchQueries = search?.queries || [];
  const searchSources = search?.sources || [];
  const searchCount = search?.count || 0;
  const hasSearch =
    !!search &&
    (searchInProgress ||
      searchQueries.length > 0 ||
      searchSources.length > 0 ||
      searchCount > 0);

  const streamError = isUser ? null : message.error;

  // ── In-place editing state ──
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [editWidth, setEditWidth] = useState(null);
  const editTextareaRef = useRef(null);
  const bubbleRef = useRef(null);

  const handleStartEdit = useCallback(() => {
    setEditText(message.content || '');
    // Lock bubble width so edit mode doesn't jump
    if (bubbleRef.current) {
      setEditWidth(bubbleRef.current.offsetWidth);
    }
    setIsEditing(true);
  }, [message.content]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditText('');
    setEditWidth(null);
  }, []);

  const handleSubmitEdit = useCallback(() => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    setIsEditing(false);
    setEditText('');
    setEditWidth(null);
    onEditResend?.(trimmed);
  }, [editText, onEditResend]);

  // Auto-resize and focus the edit textarea
  useEffect(() => {
    if (isEditing && editTextareaRef.current) {
      const ta = editTextareaRef.current;
      ta.focus();
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 300)}px`;
    }
  }, [isEditing]);

  const handleEditKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitEdit();
    }
  }, [handleSubmitEdit]);

  const handleEditInput = useCallback((e) => {
    setEditText(e.target.value);
    const ta = editTextareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 300)}px`;
    }
  }, []);

  return (
    <div className={`chat ${isUser ? 'chat-end' : 'chat-start'} mb-4`}>
      <div className="chat-header mb-1 opacity-60 text-xs">
        {isUser ? t('chat.you') : t('chat.assistant')}
      </div>
      <div
        ref={bubbleRef}
        className={`chat-bubble max-w-[85%] ${
          isUser
            ? 'chat-bubble-user'
            : 'chat-bubble-neutral text-neutral-content'
        }`}
      >
        {/* File attachments (user messages) */}
        {hasAttachments && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-1 file-badge rounded-full pl-2 pr-2 py-0.5 text-xs"
                title={`${att.file_name} (${formatSize(att.file_size)})${att.storage_status === 'failed' ? ' — Parse failed' : ''}`}
              >
                <span>{FILE_TYPE_ICONS[att.file_type] || '📎'}</span>
                <span className="max-w-[120px] truncate">{att.file_name}</span>
                <span className="opacity-50">{formatSize(att.file_size)}</span>
                {att.storage_status === 'failed' && (
                  <span className="text-error ml-0.5" title={att.parse_error}>⚠️</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Stream failure — the backend's error frames used to be dropped on
            the floor, leaving an empty bubble with no explanation. */}
        {streamError && (
          <div className="mb-3 px-3 py-2 text-xs rounded-lg border border-error/40 bg-error/10 text-error break-all">
            {t('chat.search.error')}: {streamError}
          </div>
        )}

        {/* Web-search trace (assistant messages on the Responses transport).
            Streamed turns carry it on `search`; replayed ones on `search_meta`. */}
        {hasSearch && (
          <div className="mb-3 border border-base-content/20 rounded-lg overflow-hidden">
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs font-medium bg-base-content/10 hover:bg-base-content/15 transition-colors"
              onClick={() => setShowSearch(!showSearch)}
            >
              <span className={`text-[10px] transition-transform ${showSearch ? 'rotate-90' : ''}`}>
                ▶
              </span>
              {searchInProgress ? (
                <>
                  <span className="loading loading-spinner loading-xs" />
                  <span>{t('chat.search.searching')}</span>
                </>
              ) : (
                <>
                  <span>🔍</span>
                  <span>{t('chat.search.searched', { n: searchCount })}</span>
                  {searchCount > 0 && (
                    <span className="opacity-50">
                      · {t('chat.search.queries', { n: searchQueries.length })}
                    </span>
                  )}
                  {searchSources.length > 0 && (
                    <span className="opacity-50">
                      · {t('chat.search.pages', { n: searchSources.length })}
                    </span>
                  )}
                </>
              )}
              <span className="opacity-50 ml-auto">
                {showSearch ? t('chat.search.hide') : t('chat.search.show')}
              </span>
            </button>
            {showSearch && (
              <div className="px-3 py-2 text-xs border-t border-base-content/20 max-h-[300px] overflow-y-auto space-y-2">
                {searchQueries.length > 0 && (
                  <div>
                    <div className="font-medium opacity-60 mb-1">
                      {t('chat.search.queriesTitle')}
                    </div>
                    <ul className="space-y-0.5">
                      {searchQueries.map((q) => (
                        <li key={q} className="opacity-70 break-all">· {q}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {searchSources.length > 0 && (
                  <div>
                    <div className="font-medium opacity-60 mb-1">
                      {t('chat.search.sourcesTitle')}
                    </div>
                    <ul className="space-y-0.5">
                      {searchSources.map((url) => (
                        <li key={url}>
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="link link-primary opacity-80 break-all"
                          >
                            {url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Reasoning / Thinking section (assistant messages) */}
        {hasReasoning && (
          <div className="mb-3 border border-base-content/20 rounded-lg overflow-hidden">
            <button
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs font-medium bg-base-content/10 hover:bg-base-content/15 transition-colors"
              onClick={() => setShowThinking(!showThinking)}
            >
              <span className={`text-[10px] transition-transform ${showThinking ? 'rotate-90' : ''}`}>
                ▶
              </span>
              <span>{t('chat.thinking.title')}</span>
              <span className="opacity-50 ml-auto">
                {showThinking ? t('chat.thinking.hideReasoning') : t('chat.thinking.showReasoning')}
              </span>
            </button>
            {showThinking && (
              <div className="px-3 py-2 text-xs opacity-70 whitespace-pre-wrap border-t border-base-content/20 max-h-[300px] overflow-y-auto">
                {message.reasoning_content}
              </div>
            )}
          </div>
        )}

        {/* Message content */}
        {isUser && isEditing ? (
          <div className="flex flex-col gap-2" style={editWidth ? { width: Math.max(editWidth, 260) } : undefined}>
            <textarea
              ref={editTextareaRef}
              className="textarea edit-textarea w-full min-h-[44px] max-h-[300px] resize-none"
              value={editText}
              onChange={handleEditInput}
              onKeyDown={handleEditKeyDown}
              rows={1}
              disabled={!editable}
            />
            <div className="flex items-center justify-end gap-1">
              <span className="text-xs edit-hint mr-auto">
                Shift+Enter {t('chat.editNewline')}
              </span>
              <button
                className="btn btn-xs btn-edit-cancel"
                onClick={handleCancelEdit}
              >
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-xs btn-edit-send font-medium"
                onClick={handleSubmitEdit}
                disabled={!editText.trim()}
              >
                {t('chat.editSend')}
              </button>
            </div>
          </div>
        ) : isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="prose max-w-none text-neutral-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex, rehypeHighlight]}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {/* Edit button — below the bubble for editable user messages */}
      {editable && !isEditing && (
        <div className="chat-footer mt-1 opacity-0 hover:opacity-100 transition-opacity">
          <button
            className="btn btn-ghost btn-xs"
            onClick={handleStartEdit}
            title={t('chat.editMessage')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
