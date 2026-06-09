/** MessageBubble — renders a single chat message with markdown support. */

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  const isStreaming = message.id?.startsWith('__stream');

  const content = useMemo(() => {
    if (typeof message.content !== 'string') return '';
    return message.content;
  }, [message.content]);

  return (
    <div className={`chat ${isUser ? 'chat-end' : 'chat-start'} mb-4`}>
      <div className="chat-header mb-1 opacity-60 text-xs">
        {isUser ? 'You' : 'Assistant'}
      </div>
      <div
        className={`chat-bubble max-w-[85%] ${
          isUser
            ? 'chat-bubble-primary'
            : 'chat-bubble-neutral text-neutral-content'
        } ${isStreaming ? 'animate-pulse' : ''}`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="prose prose-sm max-w-none text-neutral-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
