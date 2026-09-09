// @vitest-environment jsdom
/**
 * Regression test: the generate-key dialog must offer models that are
 * hidden from the chat picker.  "Hide from chat" only controls the chat
 * model selector — those models are precisely the API-only ones, so they
 * must remain selectable on an API key.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Stable references across renders — a fresh object per call would change
// the component's effect dependencies and re-trigger model loading.
const { generateKey, listModels, store } = vi.hoisted(() => {
  const generateKey = vi.fn();
  const listModels = vi.fn();
  return {
    generateKey,
    listModels,
    store: {
      keys: [],
      isLoading: false,
      showNewKeyModal: false,
      newKeyData: null,
      loadKeys: vi.fn(),
      generateKey,
      revokeKey: vi.fn(),
      deleteKey: vi.fn(),
      closeNewKeyModal: vi.fn(),
    },
  };
});

vi.mock('../../store/keyStore', () => ({
  useKeyStore: () => store,
}));

vi.mock('../../services/api', () => ({
  keysApi: { listModels },
}));

vi.mock('../../hooks/useT', () => ({
  default: () => (key) => key,
}));

vi.mock('../../components/layout/Layout', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

vi.mock('../../components/admin/UsageChart', () => ({
  default: () => null,
}));

import AdminPage from './AdminPage';

describe('AdminPage — generate key model list', () => {
  beforeEach(() => {
    generateKey.mockReset().mockResolvedValue(undefined);
    listModels.mockReset().mockResolvedValue({
      models: [
        { name: 'deepseek-v4-flash' },
        { name: 'deepseek-v4-pro' }, // hidden_from_chat — API only
      ],
    });
  });

  it('lists models hidden from the chat picker and submits them', async () => {
    render(<AdminPage />);

    // Both models are rendered as checkboxes in the generate dialog.
    const hiddenCheckbox = await screen.findByLabelText('deepseek-v4-pro');
    expect(screen.getByLabelText('deepseek-v4-flash')).toBeDefined();

    // The hidden model can be selected and is sent to the key generator.
    fireEvent.click(hiddenCheckbox);
    fireEvent.click(screen.getByRole('button', { name: 'keys.generateBtn' }));

    expect(generateKey).toHaveBeenCalledWith(
      expect.objectContaining({ models: ['deepseek-v4-pro'] })
    );
  });
});
