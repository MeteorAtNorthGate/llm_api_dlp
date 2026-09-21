// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { chatApi } = vi.hoisted(() => ({
  chatApi: {
    completions: vi.fn(),
    listModels: vi.fn(),
    listConversations: vi.fn(),
    getConversation: vi.fn(),
    createConversation: vi.fn(),
  },
}));

vi.mock('../services/api', () => ({ chatApi, filesApi: {} }));

import { useChatStore } from './chatStore';

/** A minimal stand-in for the fetch Response the store reads the SSE from. */
function sseResponse(frames) {
  const body =
    frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(body);
  let sent = false;
  return {
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: bytes };
        },
      }),
    },
  };
}

const textFrame = (t) => ({ choices: [{ delta: { content: t } }] });
const reasoningFrame = (t) => ({ choices: [{ delta: { reasoning_content: t } }] });
const searchFrame = (o) => ({ search: o });

const lastAssistant = () => {
  const { messages } = useChatStore.getState();
  return messages.filter((m) => m.role === 'assistant').pop();
};

describe('chatStore — Responses API frames', () => {
  beforeEach(() => {
    chatApi.completions.mockReset();
    chatApi.listConversations.mockReset().mockResolvedValue([]);
    useChatStore.setState({
      messages: [],
      activeConversationId: 'conv-1',
      selectedModel: 'ds-search',
      reasoningEffort: '',
      isStreaming: false,
      streamContent: '',
      streamReasoningContent: '',
      streamSearch: null,
      streamError: null,
    });
  });

  it('persists the search trace onto the assistant message', async () => {
    chatApi.completions.mockResolvedValue(
      sseResponse([
        searchFrame({ queries: [], sources: [], count: 0, in_progress: true }),
        reasoningFrame('thinking…'),
        searchFrame({
          queries: ['AI news today'],
          sources: ['https://example.com/a'],
          count: 1,
          in_progress: false,
        }),
        textFrame('答案'),
      ])
    );

    await useChatStore.getState().sendMessage('今天有什么AI新闻');

    const msg = lastAssistant();
    expect(msg.content).toBe('答案');
    expect(msg.search_meta).toEqual({
      queries: ['AI news today'],
      sources: ['https://example.com/a'],
      count: 1,
    });
    // Live stream state must be cleared once the turn is folded into `messages`.
    expect(useChatStore.getState().streamSearch).toBeNull();
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it('leaves search_meta undefined for a plain turn', async () => {
    chatApi.completions.mockResolvedValue(
      sseResponse([reasoningFrame('hmm'), textFrame('你好')])
    );

    await useChatStore.getState().sendMessage('说一句你好');

    expect(lastAssistant().content).toBe('你好');
    expect(lastAssistant().search_meta).toBeUndefined();
  });

  it('surfaces backend error frames instead of silently dropping them', async () => {
    chatApi.completions.mockResolvedValue(
      sseResponse([{ error: 'LiteLLM returned 400: bad tool' }])
    );

    await useChatStore.getState().sendMessage('今天有什么AI新闻');

    // The error must survive the end-of-turn reset, otherwise the banner
    // flashes during the turn and disappears when it finishes.
    expect(lastAssistant().error).toBe('LiteLLM returned 400: bad tool');
    expect(useChatStore.getState().streamError).toBeNull();
  });

  it('does not treat a search-only frame as message content', async () => {
    chatApi.completions.mockResolvedValue(
      sseResponse([
        searchFrame({ queries: ['q'], sources: [], count: 1, in_progress: false }),
      ])
    );

    await useChatStore.getState().sendMessage('hi');

    expect(lastAssistant().content).toBe('');
    expect(lastAssistant().search_meta).toEqual({
      queries: ['q'],
      sources: [],
      count: 1,
    });
  });
});
