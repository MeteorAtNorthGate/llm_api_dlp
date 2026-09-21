// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// Vitest globals are off, so @testing-library's automatic cleanup never
// registers — without this the previous test's DOM leaks into the next one.
afterEach(cleanup);

vi.mock('../../hooks/useT', () => ({
  default: () => (key, vars) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

import MessageBubble from './MessageBubble';

const assistant = (extra) => ({
  role: 'assistant',
  content: '答案正文',
  ...extra,
});

describe('MessageBubble — web-search panel', () => {
  it('renders nothing when the turn did not search', () => {
    render(<MessageBubble message={assistant({})} />);
    expect(screen.queryByText(/chat\.search\./)).toBeNull();
    expect(screen.getByText('答案正文')).toBeDefined();
  });

  it('shows a spinner while searching, before any text arrives', () => {
    render(
      <MessageBubble
        message={assistant({
          content: '',
          search: { queries: [], sources: [], count: 0, in_progress: true },
        })}
      />
    );
    expect(screen.getByText('chat.search.searching')).toBeDefined();
  });

  it('summarises a completed search and reveals queries + sources on expand', () => {
    render(
      <MessageBubble
        message={assistant({
          search: {
            queries: ['AI news today', '人工智能 最新'],
            sources: ['https://example.com/a'],
            count: 2,
            in_progress: false,
          },
        })}
      />
    );

    expect(screen.getByText('chat.search.searched:{"n":2}')).toBeDefined();
    // Collapsed by default.
    expect(screen.queryByText('chat.search.queriesTitle')).toBeNull();

    fireEvent.click(screen.getByText('chat.search.searched:{"n":2}'));

    expect(screen.getByText('chat.search.queriesTitle')).toBeDefined();
    expect(screen.getByText(/AI news today/)).toBeDefined();

    const link = screen.getByRole('link', { name: 'https://example.com/a' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
  });

  it('renders the persisted search_meta after a reload', () => {
    render(
      <MessageBubble
        message={assistant({
          search_meta: {
            queries: ['persisted query'],
            sources: [],
            count: 1,
          },
        })}
      />
    );
    expect(screen.getByText('chat.search.searched:{"n":1}')).toBeDefined();
  });

  it('surfaces a stream error instead of leaving an empty bubble', () => {
    render(
      <MessageBubble
        message={assistant({ content: '', error: 'LiteLLM returned 400' })}
      />
    );
    expect(screen.getByText(/LiteLLM returned 400/)).toBeDefined();
  });

  it('never renders the search panel on user messages', () => {
    render(
      <MessageBubble
        message={{
          role: 'user',
          content: 'hi',
          search_meta: { queries: ['should not show'], sources: [], count: 1 },
        }}
      />
    );
    expect(screen.queryByText(/chat\.search\.searched/)).toBeNull();
  });
});
