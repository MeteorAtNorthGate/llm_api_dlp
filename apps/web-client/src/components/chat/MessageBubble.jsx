/** MessageBubble — renders a single chat message with markdown and file attachments. */

import { useMemo, useState } from 'react';
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

export default function MessageBubble({ message }) {
  const t = useT();
  const isUser = message.role === 'user';
  const isStreaming = message.id?.startsWith('__stream');

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

  return (
    <div className={`chat ${isUser ? 'chat-end' : 'chat-start'} mb-4`}>
      <div className="chat-header mb-1 opacity-60 text-xs">
        {isUser ? t('chat.you') : t('chat.assistant')}
      </div>
      <div
        className={`chat-bubble max-w-[85%] ${
          isUser
            ? 'chat-bubble-primary'
            : 'chat-bubble-neutral text-neutral-content'
        } ${isStreaming ? 'animate-pulse' : ''}`}
      >
        {/* File attachments (user messages) */}
        {hasAttachments && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-1 bg-base-100/20 rounded-full pl-2 pr-2 py-0.5 text-xs"
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
        {isUser ? (
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
    </div>
  );
}
