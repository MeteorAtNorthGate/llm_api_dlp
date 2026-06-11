/** Chat store — conversations, active chat state, and file uploads. */

import { create } from 'zustand';
import { chatApi, filesApi } from '../services/api';

export const useChatStore = create((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  isStreaming: false,
  isUploading: false,
  streamContent: '',
  availableModels: [],
  selectedModel: 'deepseek-v4-flash',

  // Load available models from backend
  loadModels: async () => {
    try {
      const data = await chatApi.listModels();
      const models = data.models || [];
      set({ availableModels: models });
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
      // Map API response to include attachments field
      const messages = (conv.messages || []).map((m) => ({
        ...m,
        attachments: m.attachments || [],
      }));
      set({ messages, activeConversationId: id });
      return conv;
    } catch (err) {
      console.error('Failed to load conversation', err);
      set({ messages: [], activeConversationId: id });
    }
  },

  // Start a new conversation — create a placeholder on the backend
  // so that file uploads work from the very first message.
  newConversation: async () => {
    try {
      const conv = await chatApi.createConversation();
      set({
        activeConversationId: conv.id,
        messages: [],
        streamContent: '',
        isStreaming: false,
        isUploading: false,
      });
      // Refresh sidebar list
      get().loadConversations();
    } catch (err) {
      console.error('Failed to create conversation placeholder', err);
      // Fallback: old behaviour (no convId — first message will create one)
      set({
        activeConversationId: null,
        messages: [],
        streamContent: '',
        isStreaming: false,
        isUploading: false,
      });
    }
  },

  // Send a message with optional file attachments
  sendMessage: async (content, files = []) => {
    const { activeConversationId, messages, selectedModel } = get();
    const model = selectedModel || 'deepseek-chat';

    const convId = activeConversationId;

    // Upload files (if any)
    let contentParts = null;
    let uploadedAttachments = [];

    if (convId && files.length > 0) {
      set({ isUploading: true });
      contentParts = [{ type: 'text', text: content }];

      for (const file of files) {
        try {
          const attachment = await filesApi.upload(file, convId);
          contentParts.push({
            type: 'file',
            file_reference: { attachment_id: attachment.id },
          });
          uploadedAttachments.push(attachment);
        } catch (err) {
          console.error('Failed to upload file', file.name, err);
          contentParts.push({
            type: 'text',
            text: `\n[Failed to upload: ${file.name}]`,
          });
        }
      }
      set({ isUploading: false });
    }

    // Add user message
    const userMsg = {
      role: 'user',
      content,
      content_parts: contentParts,
      attachments: uploadedAttachments,
      id: Date.now().toString(),
    };
    const updatedMessages = [...messages, userMsg];
    set({ messages: updatedMessages, isStreaming: true, streamContent: '' });

    try {
      const payload = {
        model,
        messages: updatedMessages.map((m) => ({
          role: m.role,
          content: m.content || '',
          content_parts: m.content_parts || undefined,
        })),
        conversation_id: convId,
        stream: true,
      };

      const response = await chatApi.completions(payload);

      // Update conversation ID from headers (for new conversations)
      const newConvId = response.headers.get('X-Conversation-Id');
      if (newConvId && !convId) {
        set({ activeConversationId: newConvId });
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

      // For new conversations, reload after a delay so the sidebar picks
      // up the AI-generated title from the background task.
      setTimeout(() => {
        get().loadConversations();
      }, 3000);

    } catch (err) {
      console.error('Failed to send message', err);
      set({ isStreaming: false, streamContent: '' });
      set((state) => ({
        messages: [
          ...state.messages,
          {
            role: 'assistant',
            content: 'Sorry, an error occurred. Please try again.',
            id: Date.now().toString(),
          },
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
