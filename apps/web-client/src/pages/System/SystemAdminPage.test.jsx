// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { adminApi } = vi.hoisted(() => ({
  adminApi: {
    listModels: vi.fn(),
    addModel: vi.fn(),
    updateModel: vi.fn(),
    deleteModel: vi.fn(),
    getSettings: vi.fn(),
    updateSetting: vi.fn(),
  },
}));

vi.mock('../../services/api', () => ({ adminApi }));

vi.mock('../../hooks/useT', () => ({
  default: () => (key) => key,
}));

vi.mock('../../components/layout/Layout', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

import SystemAdminPage from './SystemAdminPage';

describe('SystemAdminPage — edit model ID', () => {
  beforeEach(() => {
    adminApi.listModels.mockReset().mockResolvedValue({
      models: [{
        id: 'model-config-id',
        model_name: 'GPT-4o',
        provider: 'openai',
        model_id: 'gpt-4o',
        api_base: '',
        rpm: null,
        tpm: null,
        max_input_tokens: null,
      }],
    });
    adminApi.getSettings.mockReset().mockResolvedValue({ settings: {} });
    adminApi.updateModel.mockReset().mockResolvedValue({ status: 'updated' });
  });

  it('submits a changed model ID with the existing provider', async () => {
    render(<SystemAdminPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'providers.edit' }));

    const modelIdInput = screen.getByDisplayValue('gpt-4o');
    fireEvent.change(modelIdInput, { target: { value: 'gpt-4.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'providers.saveChanges' }));

    await waitFor(() => {
      expect(adminApi.updateModel).toHaveBeenCalledWith('model-config-id', {
        model_id: 'gpt-4.1',
        provider: 'openai',
      });
    });
  });

  it('requires a non-empty model ID', async () => {
    render(<SystemAdminPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'providers.edit' }));
    fireEvent.change(screen.getByDisplayValue('gpt-4o'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'providers.saveChanges' }));

    expect(screen.getByText('providers.modelIdRequired')).toBeDefined();
    expect(adminApi.updateModel).not.toHaveBeenCalled();
  });
});
