/** Chat store — conversations and active chat state. */

import { create } from 'zustand';
import { chatApi } from '../services/api';

export const useChatStore = create((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  isStreaming: false,
  streamContent: '',
  availableModels: [],
  selectedModel: 'gpt-4o-mini',

  // Load available models from backend
  loadModels: async () => {
    try {
      const data = await chatApi.listModels();
      const models = data.models || [];
      set({ availableModels: models });
      // Auto-select first model if none selected or current selection not available
      const { selectedModel } = get();
      if (models.length > 0 && !models.find((m) => m.name === selectedModel)) {
        set({ selectedModel: models[0].name });
      }
    } catch (err) {
      console.error('Failed to load models', err);
    }
  },

  setSelectedModel: (model) => set({ selectedModel: model }),

  // Load conversation list
  loadConversations: async () => {
    try {
      const conversations = await chatApi.listConversations();
      set({ conversations });
    } catch (err) {
      console.error('Failed to load conversations', err);
    }
  },

  // Load a specific conversation's messages
  loadConversation: async (id) => {
    try {
      const conv = await chatApi.getConversation(id);
      set({ messages: conv.messages, activeConversationId: id });
      return conv;
    } catch (err) {
      console.error('Failed to load conversation', err);
      set({ messages: [], activeConversationId: id });
    }
  },

  // Start a new conversation
  newConversation: () => {
    set({
      activeConversationId: null,
      messages: [],
      streamContent: '',
      isStreaming: false,
    });
  },

  // Send a message and stream the response
  sendMessage: async (content) => {
    const { activeConversationId, messages, selectedModel } = get();
    const model = selectedModel || 'gpt-4o-mini';

    // Add user message immediately
    const userMsg = { role: 'user', content, id: Date.now().toString() };
    const updatedMessages = [...messages, userMsg];
    set({ messages: updatedMessages, isStreaming: true, streamContent: '' });

    try {
      const payload = {
        model,
        messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
        conversation_id: activeConversationId,
        stream: true,
      };

      const response = await chatApi.completions(payload);

      // Get conversation ID from headers (for new conversations)
      const convId = response.headers.get('X-Conversation-Id');
      if (convId && !activeConversationId) {
        set({ activeConversationId: convId });
      }

      // Stream reader
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                set({ streamContent: fullContent });
              }
            } catch {
              // Skip malformed chunks
            }
          }
        }
      }

      // Add assistant message
      const assistantMsg = {
        role: 'assistant',
        content: fullContent,
        id: (Date.now() + 1).toString(),
      };

      set((state) => ({
        messages: [...state.messages, assistantMsg],
        isStreaming: false,
        streamContent: '',
      }));

      // Reload conversation list to update titles
      get().loadConversations();

    } catch (err) {
      console.error('Failed to send message', err);
      set({ isStreaming: false, streamContent: '' });
      // Add error message
      set((state) => ({
        messages: [
          ...state.messages,
          { role: 'assistant', content: 'Sorry, an error occurred. Please try again.', id: Date.now().toString() },
        ],
      }));
    }
  },

  deleteConversation: async (id) => {
    try {
      await chatApi.deleteConversation(id);
      const { activeConversationId } = get();
      if (activeConversationId === id) {
        get().newConversation();
      }
      get().loadConversations();
    } catch (err) {
      console.error('Failed to delete conversation', err);
    }
  },
}));
