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
  streamReasoningContent: '',
  abortController: null,  // AbortController for cancelling in-flight stream
  availableModels: [],
  selectedModel: 'deepseek-v4-flash',
  reasoningEffort: '',  // '' = auto, 'low' | 'medium' | 'high' | 'max'

  // Load available models from backend.
  // Models with hidden_from_chat=true are already filtered server-side
  // by the chat API endpoint.
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
  setReasoningEffort: (level) => set({ reasoningEffort: level }),

  // Cancel the in-flight streaming request and save partial content.
  stopStreaming: () => {
    const { abortController, streamContent, streamReasoningContent } = get();
    if (abortController) {
      abortController.abort();
    }
    // Save whatever content has been streamed so far as an assistant message.
    if (streamContent || streamReasoningContent) {
      const assistantMsg = {
        role: 'assistant',
        content: streamContent,
        reasoning_content: streamReasoningContent || undefined,
        id: Date.now().toString(),
      };
      set((state) => ({
        messages: [...state.messages, assistantMsg],
        isStreaming: false,
        streamContent: '',
        streamReasoningContent: '',
        abortController: null,
        isUploading: false,
      }));
    } else {
      set({
        isStreaming: false,
        streamContent: '',
        streamReasoningContent: '',
        abortController: null,
        isUploading: false,
      });
    }
  },

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
      // Map API response to include attachments and reasoning_content fields
      const messages = (conv.messages || []).map((m) => ({
        ...m,
        reasoning_content: m.reasoning_content || '',
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
    // Cancel any in-flight stream before resetting.
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
    }
    try {
      const conv = await chatApi.createConversation();
      set({
        activeConversationId: conv.id,
        messages: [],
        streamContent: '',
        streamReasoningContent: '',
        isStreaming: false,
        isUploading: false,
        abortController: null,
        reasoningEffort: '',
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
        streamReasoningContent: '',
        isStreaming: false,
        isUploading: false,
        abortController: null,
        reasoningEffort: '',
      });
    }
  },

  // Send a message with optional file attachments
  sendMessage: async (content, files = []) => {
    const { activeConversationId, messages, selectedModel, reasoningEffort } = get();
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
    const controller = new AbortController();
    set({ messages: updatedMessages, isStreaming: true, streamContent: '', streamReasoningContent: '', abortController: controller });

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
      if (reasoningEffort) {
        payload.reasoning_effort = reasoningEffort;
      }

      const response = await chatApi.completions(payload, controller.signal);

      // Update conversation ID from headers (for new conversations)
      const newConvId = response.headers.get('X-Conversation-Id');
      if (newConvId && !convId) {
        set({ activeConversationId: newConvId });
      }

      // Stream reader
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let fullReasoning = '';
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
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.content) {
                fullContent += delta.content;
              }
              if (delta?.reasoning_content) {
                fullReasoning += delta.reasoning_content;
              }
              set({
                streamContent: fullContent,
                streamReasoningContent: fullReasoning,
              });
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
        reasoning_content: fullReasoning || undefined,
        id: (Date.now() + 1).toString(),
      };

      set((state) => ({
        messages: [...state.messages, assistantMsg],
        isStreaming: false,
        streamContent: '',
        streamReasoningContent: '',
        abortController: null,
      }));

      // Reload conversation list to update titles
      get().loadConversations();

      // For new conversations, reload after a delay so the sidebar picks
      // up the AI-generated title from the background task.
      setTimeout(() => {
        get().loadConversations();
      }, 3000);

    } catch (err) {
      // Silently ignore AbortError — stopStreaming already handled it.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Failed to send message', err);
      set({ isStreaming: false, streamContent: '', streamReasoningContent: '', abortController: null });
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

  // Edit the last user message: prune the last turn from the DB,
  // truncate client-side messages, then resend with the edited content.
  editAndResend: async (editedContent, files = []) => {
    const { messages, activeConversationId } = get();
    if (!activeConversationId) return;

    // Find the last user message index
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) return;

    // Prune the last turn on the backend first
    try {
      await chatApi.pruneLastTurn(activeConversationId);
    } catch (err) {
      console.error('Failed to prune last turn', err);
      // Continue anyway — the send will still work client-side
    }

    // Truncate client-side messages to before the last user message
    const truncatedMessages = messages.slice(0, lastUserIdx);
    set({ messages: truncatedMessages });

    // Send with the edited content
    await get().sendMessage(editedContent, files);
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
