/** ChatPage — main chat interface with message list and input. */

import { useEffect, useRef } from 'react';
import Layout from '../../components/layout/Layout';
import MessageBubble from '../../components/chat/MessageBubble';
import ChatInput from '../../components/chat/ChatInput';
import { useChatStore } from '../../store/chatStore';

export default function ChatPage() {
  const {
    messages,
    isStreaming,
    streamContent,
    availableModels,
    selectedModel,
    activeConversationId,
    sendMessage,
    loadModels,
    setSelectedModel,
  } = useChatStore();
  const messagesEndRef = useRef(null);

  // Load models on mount
  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent]);

  const handleSend = (content, files) => {
    sendMessage(content, files);
  };

  return (
    <Layout>
      <div className="flex flex-col h-full">
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          {messages.length === 0 && !isStreaming && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-3 max-w-md">
                <h2 className="text-2xl font-bold">LLM Platform</h2>
                <p className="text-base-content/60">
                  Start a conversation. Your messages are processed through
                  enterprise DLP to protect sensitive data.
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <MessageBubble key={msg.id || idx} message={msg} />
          ))}

          {/* Streaming message */}
          {isStreaming && streamContent && (
            <MessageBubble
              message={{
                role: 'assistant',
                content: streamContent,
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
          isStreaming={isStreaming}
          models={availableModels}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          hasActiveConversation={!!activeConversationId}
        />
      </div>
    </Layout>
  );
}
