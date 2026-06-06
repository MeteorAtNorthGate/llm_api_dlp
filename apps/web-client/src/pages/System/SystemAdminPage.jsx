/** SystemAdminPage — manage LLM provider models and API keys.
 *  Only accessible to users in the 'admins' group. */

import { useEffect, useState } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import { adminApi } from '../../services/api';

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI', defaultBase: 'https://api.openai.com/v1' },
  { value: 'azure', label: 'Azure OpenAI', defaultBase: '' },
  { value: 'anthropic', label: 'Anthropic (Claude)', defaultBase: '' },
  { value: 'qwen', label: 'Qwen / Alibaba', defaultBase: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
  { value: 'deepseek', label: 'DeepSeek', defaultBase: 'https://api.deepseek.com/v1' },
  { value: 'google', label: 'Google AI (Gemini)', defaultBase: '' },
  { value: 'vertex_ai', label: 'Google Vertex AI', defaultBase: '' },
  { value: 'mistral', label: 'Mistral AI', defaultBase: 'https://api.mistral.ai/v1' },
  { value: 'groq', label: 'Groq', defaultBase: 'https://api.groq.com/openai/v1' },
  { value: 'cohere', label: 'Cohere', defaultBase: 'https://api.cohere.com/v1' },
  { value: 'bedrock', label: 'AWS Bedrock', defaultBase: '' },
  { value: 'together_ai', label: 'Together AI', defaultBase: 'https://api.together.xyz/v1' },
  { value: 'perplexity', label: 'Perplexity AI', defaultBase: 'https://api.perplexity.ai' },
  { value: 'xai', label: 'xAI (Grok)', defaultBase: 'https://api.x.ai/v1' },
  { value: 'ollama', label: 'Ollama (Local)', defaultBase: 'http://localhost:11434/v1' },
  { value: 'openrouter', label: 'OpenRouter', defaultBase: 'https://openrouter.ai/api/v1' },
  { value: 'huggingface', label: 'HuggingFace', defaultBase: '' },
  { value: 'replicate', label: 'Replicate', defaultBase: '' },
  { value: 'custom', label: 'Custom (full model path)', defaultBase: '' },
];

const EMPTY_FORM = {
  model_name: '',
  provider: 'openai',
  model_id: '',
  api_key: '',
  api_base: '',
  rpm: 500,
  tpm: 100000,
};

export default function SystemAdminPage() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Add modal
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);

  // Edit modal
  const [showEdit, setShowEdit] = useState(false);
  const [editModel, setEditModel] = useState(null);
  const [editForm, setEditForm] = useState({ api_key: '', api_base: '', rpm: null, tpm: null });
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState(null);
  const [showKey, setShowKey] = useState(false);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Platform settings
  const [platformSettings, setPlatformSettings] = useState({});
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState(null);
  const [settingsSuccess, setSettingsSuccess] = useState(null);

  // ── Fetch models ──────────────────────────────────────

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi.listModels();
      setModels(data.models || []);
    } catch (err) {
      setError(err.message || 'Failed to load models');
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async () => {
    setSettingsLoading(true);
    try {
      const data = await adminApi.getSettings();
      setPlatformSettings(data.settings || {});
    } catch (err) {
      console.error('Failed to load platform settings', err);
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleSaveSetting = async (key, value) => {
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsSuccess(null);
    try {
      await adminApi.updateSetting(key, value);
      setPlatformSettings((prev) => ({ ...prev, [key]: value }));
      setSettingsSuccess(`Saved: ${key}`);
      setTimeout(() => setSettingsSuccess(null), 3000);
    } catch (err) {
      setSettingsError(err.message || 'Failed to save setting');
    } finally {
      setSettingsSaving(false);
    }
  };

  useEffect(() => {
    fetchModels();
    fetchSettings();
  }, []);

  // ── Add model ─────────────────────────────────────────

  const handleProviderChange = (provider) => {
    const prov = PROVIDERS.find((p) => p.value === provider);
    setAddForm((f) => ({
      ...f,
      provider,
      api_base: prov?.defaultBase || '',
    }));
  };

  const handleAdd = async () => {
    setAddError(null);
    if (!addForm.model_name || !addForm.model_id || !addForm.api_key) {
      setAddError('Model name, Model ID, and API Key are required.');
      return;
    }
    setAdding(true);
    try {
      await adminApi.addModel({
        model_name: addForm.model_name,
        provider: addForm.provider,
        model_id: addForm.model_id,
        api_key: addForm.api_key,
        api_base: addForm.api_base || null,
        rpm: addForm.rpm || null,
        tpm: addForm.tpm || null,
      });
      setShowAdd(false);
      setAddForm({ ...EMPTY_FORM });
      await fetchModels();
    } catch (err) {
      setAddError(err.message || 'Failed to add model');
    } finally {
      setAdding(false);
    }
  };

  // ── Edit model ────────────────────────────────────────

  const openEdit = (model) => {
    setEditModel(model);
    setEditForm({
      model_name: model.model_name,
      api_key: '',
      api_base: model.api_base || '',
      rpm: model.rpm,
      tpm: model.tpm,
    });
    setEditError(null);
    setShowKey(false);
    setShowEdit(true);
  };

  const handleEdit = async () => {
    setEditError(null);
    setEditing(true);
    try {
      const payload = {};
      if (editForm.model_name && editForm.model_name !== editModel.model_name) {
        payload.model_name = editForm.model_name;
      }
      if (editForm.api_key) {
        payload.api_key = editForm.api_key;
      }
      if (editForm.api_base !== editModel.api_base) {
        payload.api_base = editForm.api_base || null;
      }
      if (editForm.rpm !== editModel.rpm) {
        payload.rpm = editForm.rpm;
      }
      if (editForm.tpm !== editModel.tpm) {
        payload.tpm = editForm.tpm;
      }

      await adminApi.updateModel(editModel.id, payload);
      setShowEdit(false);
      setEditModel(null);
      await fetchModels();
    } catch (err) {
      setEditError(err.message || 'Failed to update model');
    } finally {
      setEditing(false);
    }
  };

  // ── Delete model ──────────────────────────────────────

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await adminApi.deleteModel(deleteTarget.id);
      setDeleteTarget(null);
      await fetchModels();
    } catch (err) {
      setError(err.message || 'Failed to delete model');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  // ── Render ────────────────────────────────────────────

  return (
    <Layout showSidebar={false}>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">System Administration</h1>
            <p className="text-base-content/60">
              Manage LLM provider models and API keys
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => { setAddForm({ ...EMPTY_FORM }); setAddError(null); setShowAdd(true); }}>
            + Add Model
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="alert alert-error">
            <span>{error}</span>
            <button className="btn btn-ghost btn-xs" onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {/* Platform Settings */}
        <div className="card bg-base-100 shadow-sm border border-base-300">
          <div className="card-body p-5">
            <h2 className="card-title text-base">Platform Settings</h2>
            <p className="text-sm text-base-content/60">
              Configure platform-wide settings. Changes take effect immediately — no restart required.
            </p>

            {settingsLoading ? (
              <div className="flex justify-center py-4"><Spinner size="sm" /></div>
            ) : (
              <div className="space-y-4 mt-2">
                {/* LiteLLM Public URL */}
                <div className="form-control">
                  <label className="label pb-1">
                    <span className="label-text font-medium">LiteLLM Public URL</span>
                    <span className="label-text-alt text-base-content/50">
                      Shown to users after they generate an API key
                    </span>
                  </label>
                  <div className="join">
                    <input
                      type="text"
                      className="input input-bordered join-item flex-1 font-mono text-sm"
                      placeholder="http://llmplatform.oaseas.int"
                      value={platformSettings.litellm_public_url || ''}
                      onChange={(e) =>
                        setPlatformSettings((prev) => ({
                          ...prev,
                          litellm_public_url: e.target.value,
                        }))
                      }
                    />
                    <button
                      className="btn btn-primary join-item"
                      disabled={settingsSaving}
                      onClick={() =>
                        handleSaveSetting('litellm_public_url', platformSettings.litellm_public_url)
                      }
                    >
                      {settingsSaving && <span className="loading loading-spinner loading-xs" />}
                      Save
                    </button>
                  </div>
                  <label className="label">
                    <span className="label-text-alt text-base-content/50">
                      This is the base URL users configure in their SDKs (e.g., OpenAI base_url,
                      Anthropic base_url). LiteLLM proxy runs on port 4000 — use DNS/nginx to map
                      this domain to the LiteLLM container.
                    </span>
                  </label>
                </div>

                {settingsError && (
                  <div className="alert alert-error text-sm">
                    <span>{settingsError}</span>
                  </div>
                )}
                {settingsSuccess && (
                  <div className="alert alert-success text-sm">
                    <span>{settingsSuccess}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Model list */}
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : models.length === 0 ? (
          <div className="text-center py-16 text-base-content/50 border border-dashed border-base-300 rounded-lg">
            <p className="text-lg font-medium">No models configured</p>
            <p className="text-sm mt-1">Add your first LLM provider model to get started</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {models.map((m) => (
              <div key={m.id} className="card bg-base-100 shadow-sm border border-base-300">
                <div className="card-body p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-lg">{m.model_name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="badge badge-outline badge-sm">{m.provider}</span>
                        <code className="text-xs text-base-content/50">{m.model_id}</code>
                      </div>
                    </div>
                    <div className="badge badge-success badge-sm">Active</div>
                  </div>

                  <div className="text-xs text-base-content/60 mt-3 space-y-1">
                    {m.api_base && (
                      <div><span className="font-medium">Base URL:</span> {m.api_base}</div>
                    )}
                    {m.rpm && <div><span className="font-medium">RPM:</span> {m.rpm}</div>}
                    {m.tpm && <div><span className="font-medium">TPM:</span> {m.tpm.toLocaleString()}</div>}
                    <div><span className="font-medium">ID:</span> <code className="text-xs">{m.id?.slice(0, 12)}...</code></div>
                  </div>

                  <div className="card-actions justify-end mt-3 gap-2">
                    <button
                      className="btn btn-outline btn-xs"
                      onClick={() => openEdit(m)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-error btn-xs btn-outline"
                      onClick={() => setDeleteTarget(m)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Add Model Modal ──────────────────────────── */}
        <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add LLM Provider Model" size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="form-control">
                <label className="label"><span className="label-text font-medium">Model Name *</span></label>
                <input
                  type="text" className="input input-bordered"
                  placeholder="e.g., gpt-4o"
                  value={addForm.model_name}
                  onChange={(e) => setAddForm((f) => ({ ...f, model_name: e.target.value }))}
                />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text font-medium">Provider *</span></label>
                <select
                  className="select select-bordered"
                  value={addForm.provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-control">
              <label className="label"><span className="label-text font-medium">Model ID *</span></label>
              {addForm.provider === 'custom' ? (
                <>
                  <input
                    type="text" className="input input-bordered font-mono text-sm"
                    placeholder="e.g., openai/gpt-4o, anthropic/claude-sonnet-4-6"
                    value={addForm.model_id}
                    onChange={(e) => setAddForm((f) => ({ ...f, model_id: e.target.value }))}
                  />
                  <label className="label"><span className="label-text-alt text-base-content/50">
                    Enter the full LiteLLM model path (provider/model-name). See <a href="https://docs.litellm.ai/docs/providers" target="_blank" className="link">LiteLLM docs</a> for all supported providers.
                  </span></label>
                </>
              ) : (
                <>
                  <input
                    type="text" className="input input-bordered"
                    placeholder="e.g., gpt-4o, qwen-max, claude-sonnet-4-6"
                    value={addForm.model_id}
                    onChange={(e) => setAddForm((f) => ({ ...f, model_id: e.target.value }))}
                  />
                  <label className="label"><span className="label-text-alt text-base-content/50">
                    Provider model name. LiteLLM will call this as <code className="font-bold">{addForm.provider}/{addForm.model_id || 'model-id'}</code>
                  </span></label>
                </>
              )}
            </div>

            <div className="form-control">
              <label className="label"><span className="label-text font-medium">API Key *</span></label>
              <input
                type="password" className="input input-bordered font-mono"
                placeholder="sk-..."
                value={addForm.api_key}
                onChange={(e) => setAddForm((f) => ({ ...f, api_key: e.target.value }))}
              />
              <label className="label"><span className="label-text-alt text-base-content/50">
                The API key from the LLM provider. Stored securely and never shown again.
              </span></label>
            </div>

            <div className="form-control">
              <label className="label"><span className="label-text font-medium">API Base URL</span></label>
              <input
                type="text" className="input input-bordered font-mono text-sm"
                placeholder="Auto-detected from provider"
                value={addForm.api_base}
                onChange={(e) => setAddForm((f) => ({ ...f, api_base: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="form-control">
                <label className="label"><span className="label-text font-medium">RPM Limit</span></label>
                <input
                  type="number" className="input input-bordered"
                  value={addForm.rpm}
                  onChange={(e) => setAddForm((f) => ({ ...f, rpm: parseInt(e.target.value) || 0 }))}
                />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text font-medium">TPM Limit</span></label>
                <input
                  type="number" className="input input-bordered"
                  value={addForm.tpm}
                  onChange={(e) => setAddForm((f) => ({ ...f, tpm: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </div>

            {addError && <div className="alert alert-error text-sm"><span>{addError}</span></div>}

            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={adding}>
                {adding && <span className="loading loading-spinner loading-sm" />}
                Add Model
              </button>
            </div>
          </div>
        </Modal>

        {/* ── Edit Model Modal ──────────────────────────── */}
        <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`Edit: ${editModel?.model_name || ''}`} size="lg">
          {editModel && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-base-200 rounded-lg">
                <span className="badge badge-outline">{editModel.provider}</span>
                <code className="text-sm">{editModel.model_id}</code>
              </div>

              <div className="form-control">
                <label className="label"><span className="label-text font-medium">Model Name</span></label>
                <input
                  type="text" className="input input-bordered"
                  value={editForm.model_name}
                  onChange={(e) => setEditForm((f) => ({ ...f, model_name: e.target.value }))}
                />
              </div>

              <div className="form-control">
                <label className="label"><span className="label-text font-medium">New API Key</span></label>
                <div className="join">
                  <input
                    type={showKey ? 'text' : 'password'}
                    className="input input-bordered join-item flex-1 font-mono"
                    placeholder="Leave blank to keep current key"
                    value={editForm.api_key}
                    onChange={(e) => setEditForm((f) => ({ ...f, api_key: e.target.value }))}
                  />
                  <button
                    className="btn btn-outline join-item"
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <label className="label"><span className="label-text-alt text-base-content/50">
                  Current key is hidden for security. Enter a new key to replace it.
                </span></label>
              </div>

              <div className="form-control">
                <label className="label"><span className="label-text font-medium">API Base URL</span></label>
                <input
                  type="text" className="input input-bordered font-mono text-sm"
                  value={editForm.api_base}
                  onChange={(e) => setEditForm((f) => ({ ...f, api_base: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="form-control">
                  <label className="label"><span className="label-text font-medium">RPM Limit</span></label>
                  <input
                    type="number" className="input input-bordered"
                    value={editForm.rpm ?? ''}
                    onChange={(e) => setEditForm((f) => ({ ...f, rpm: e.target.value ? parseInt(e.target.value) : null }))}
                  />
                </div>
                <div className="form-control">
                  <label className="label"><span className="label-text font-medium">TPM Limit</span></label>
                  <input
                    type="number" className="input input-bordered"
                    value={editForm.tpm ?? ''}
                    onChange={(e) => setEditForm((f) => ({ ...f, tpm: e.target.value ? parseInt(e.target.value) : null }))}
                  />
                </div>
              </div>

              {editError && <div className="alert alert-error text-sm"><span>{editError}</span></div>}

              <div className="modal-action">
                <button className="btn btn-ghost" onClick={() => setShowEdit(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleEdit} disabled={editing}>
                  {editing && <span className="loading loading-spinner loading-sm" />}
                  Save Changes
                </button>
              </div>
            </div>
          )}
        </Modal>

        {/* ── Delete Confirmation Modal ─────────────────── */}
        <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Model">
          {deleteTarget && (
            <div className="space-y-4">
              <div className="alert alert-warning">
                <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <p className="font-bold">Remove "{deleteTarget.model_name}"?</p>
                  <p className="text-sm">This model will no longer be available for chat or API use. This action cannot be undone.</p>
                </div>
              </div>

              <div className="modal-action">
                <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button className="btn btn-error" onClick={confirmDelete} disabled={deleting}>
                  {deleting && <span className="loading loading-spinner loading-sm" />}
                  Delete
                </button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </Layout>
  );
}
