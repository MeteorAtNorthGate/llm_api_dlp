/** ChatPage — main chat interface with message list and input. */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import Layout from '../../components/layout/Layout';
import MessageBubble from '../../components/chat/MessageBubble';
import ChatInput from '../../components/chat/ChatInput';
import { useChatStore } from '../../store/chatStore';
import useT from '../../hooks/useT';

export default function ChatPage() {
  const t = useT();
  const {
    messages,
    isStreaming,
    streamContent,
    streamReasoningContent,
    availableModels,
    selectedModel,
    reasoningEffort,
    activeConversationId,
    sendMessage,
    stopStreaming,
    loadModels,
    setSelectedModel,
    setReasoningEffort,
    newConversation,
    editAndResend,
  } = useChatStore();
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isNearBottomRef = useRef(true);
  const [editingContent, setEditingContent] = useState(null);

  // Index of the last user message (for edit button visibility)
  const lastUserIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return i;
    }
    return -1;
  }, [messages]);

  // Load models on mount
  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // Create a placeholder conversation on mount so file uploads work
  // from the very first message (backend assigns the conversation ID).
  useEffect(() => {
    if (!activeConversationId) {
      newConversation();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track whether the user is near the bottom of the scroll area.
  // When the user scrolls up, we stop auto-following.
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 80; // px from bottom to still consider "pinned"
    isNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  // When streaming starts (user sent a message), reset to pinned and scroll.
  useEffect(() => {
    if (isStreaming) {
      isNearBottomRef.current = true;
    }
  }, [isStreaming]);

  // Smart auto-scroll on content change: only follow if the user hasn't scrolled up.
  // Use 'instant' to avoid smooth-scroll queue build-up during rapid streaming updates.
  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [messages, streamContent]);

  const handleSend = (content, files) => {
    if (editingContent) {
      editAndResend(content, files);
      setEditingContent(null);
    } else {
      sendMessage(content, files);
    }
  };

  const handleEdit = (messageContent) => {
    setEditingContent(messageContent);
  };

  const handleCancelEdit = () => {
    setEditingContent(null);
  };

  return (
    <Layout>
      <div className="flex flex-col h-full">
        {/* Messages area */}
        <div
          className="flex-1 overflow-y-auto px-4 py-6"
          ref={scrollContainerRef}
          onScroll={handleScroll}
        >
          {messages.length === 0 && !isStreaming && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-3 max-w-md">
                <h2 className="text-2xl font-bold">{t('chat.welcome')}</h2>
                <p className="text-base-content/60">
                  {t('chat.welcomeDesc')}
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id || idx}
              message={msg}
              editable={!isStreaming && msg.role === 'user' && idx === lastUserIdx}
              onEdit={() => handleEdit(msg.content)}
            />
          ))}

          {/* Streaming message */}
          {isStreaming && (streamContent || streamReasoningContent) && (
            <MessageBubble
              message={{
                role: 'assistant',
                content: streamContent,
                reasoning_content: streamReasoningContent,
                id: '__stream',
              }}
            />
          )}

          {/* Empty streaming placeholder */}
          {isStreaming && !streamContent && (
            <div className="chat chat-start">
              <div className="chat-bubble chat-bubble-neutral">
                <span className="loading loading-dots loading-md" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <ChatInput
          onSend={handleSend}
          onStop={stopStreaming}
          isStreaming={isStreaming}
          models={availableModels}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={setReasoningEffort}
          hasActiveConversation={!!activeConversationId}
          defaultValue={editingContent || ''}
        />
        {editingContent && (
          <div className="flex items-center justify-center pb-2">
            <span className="text-xs text-warning flex items-center gap-1">
              ✎ {t('chat.editing')}
              <button
                className="btn btn-ghost btn-xs text-base-content/40 hover:text-error ml-1"
                onClick={handleCancelEdit}
              >
                {t('common.cancel')}
              </button>
            </span>
          </div>
        )}
      </div>
    </Layout>
  );
}
