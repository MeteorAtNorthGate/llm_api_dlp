/** AdminPage — API key management dashboard. */

import { useCallback, useEffect, useState } from 'react';
import Layout from '../../components/layout/Layout';
import KeyCard from '../../components/admin/KeyCard';
import UsageChart from '../../components/admin/UsageChart';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import { useKeyStore } from '../../store/keyStore';
import { chatApi } from '../../services/api';

export default function AdminPage() {
  const {
    keys,
    isLoading,
    showNewKeyModal,
    newKeyData,
    loadKeys,
    generateKey,
    revokeKey,
    closeNewKeyModal,
  } = useKeyStore();

  const [availableModels, setAvailableModels] = useState([]);
  const [form, setForm] = useState({
    key_alias: '',
    models: [],
    max_budget: 10,
    rpm_limit: 60,
    duration_days: 90,
  });
  const [genError, setGenError] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadAvailableModels = useCallback(async () => {
    try {
      const data = await chatApi.listModels();
      const models = (data.models || []).map((m) => ({
        value: m.name,
        label: m.name,
      }));
      setAvailableModels(models);
    } catch (err) {
      console.error('Failed to load available models', err);
    }
  }, []);

  useEffect(() => {
    loadKeys();
    loadAvailableModels();
  }, [loadKeys, loadAvailableModels]);

  const handleModelToggle = (model) => {
    setForm((prev) => ({
      ...prev,
      models: prev.models.includes(model)
        ? prev.models.filter((m) => m !== model)
        : [...prev.models, model],
    }));
  };

  const handleGenerate = async () => {
    setGenError(null);
    setIsGenerating(true);
    try {
      await generateKey({
        key_alias: form.key_alias || null,
        models: form.models.length > 0 ? form.models : null,
        max_budget: form.max_budget || null,
        rpm_limit: form.rpm_limit || null,
        duration_days: form.duration_days,
      });
    } catch (err) {
      setGenError(err.message || 'Failed to generate key');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <Layout showSidebar={false}>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">API Key Management</h1>
            <p className="text-base-content/60">
              Manage your virtual API keys for programmatic access
            </p>
          </div>
          <label htmlFor="generate-modal" className="btn btn-primary">
            + Generate Key
          </label>
        </div>

        {/* Usage Overview */}
        <div className="card bg-base-100 shadow-sm border border-base-300">
          <div className="card-body p-4">
            <h2 className="card-title text-base">Usage Overview</h2>
            <UsageChart keys={keys} />
          </div>
        </div>

        {/* Key List */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Your Keys ({keys.length})</h2>
          {isLoading && !keys.length ? (
            <Spinner />
          ) : keys.length === 0 ? (
            <div className="text-center py-12 text-base-content/50">
              <p className="text-lg">No API keys yet</p>
              <p className="text-sm mt-1">Generate your first key to get started</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {keys.map((key) => (
                <KeyCard
                  key={key.id}
                  keyData={key}
                  onRevoke={revokeKey}
                />
              ))}
            </div>
          )}
        </div>

        {/* Generate Modal */}
        <Modal title="Generate API Key" open={!showNewKeyModal && false}>
          {/* This is handled by the label trigger below, but Modal can be used programmatically */}
        </Modal>

        {/* Generate Form Modal (triggered by button) */}
        <input type="checkbox" id="generate-modal" className="modal-toggle" />
        <div className="modal">
          <div className="modal-box max-w-lg">
            <h3 className="font-bold text-lg mb-4">Generate New API Key</h3>

            <div className="space-y-4">
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Key Alias (optional)</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered"
                  placeholder="e.g., My Project Key"
                  value={form.key_alias}
                  onChange={(e) => setForm((p) => ({ ...p, key_alias: e.target.value }))}
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text">Models (none = all available)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {availableModels.length === 0 && (
                    <span className="text-sm text-base-content/50">Loading models...</span>
                  )}
                  {availableModels.map((m) => (
                    <label key={m.value} className="label cursor-pointer gap-2">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={form.models.includes(m.value)}
                        onChange={() => handleModelToggle(m.value)}
                      />
                      <span className="label-text text-sm">{m.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Max Budget (USD)</span>
                  </label>
                  <input
                    type="number"
                    className="input input-bordered"
                    value={form.max_budget}
                    onChange={(e) => setForm((p) => ({ ...p, max_budget: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">RPM Limit</span>
                  </label>
                  <input
                    type="number"
                    className="input input-bordered"
                    value={form.rpm_limit}
                    onChange={(e) => setForm((p) => ({ ...p, rpm_limit: parseInt(e.target.value) || 0 }))}
                  />
                </div>
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text">Duration (days)</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="365"
                  value={form.duration_days}
                  className="range"
                  onChange={(e) => setForm((p) => ({ ...p, duration_days: parseInt(e.target.value) }))}
                />
                <div className="text-xs text-base-content/60 text-right">
                  {form.duration_days} days
                </div>
              </div>

              {genError && (
                <div className="alert alert-error text-sm">
                  <span>{genError}</span>
                </div>
              )}

              <div className="modal-action">
                <label htmlFor="generate-modal" className="btn btn-ghost">
                  Cancel
                </label>
                <button
                  className="btn btn-primary"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                >
                  {isGenerating && <span className="loading loading-spinner loading-sm" />}
                  Generate
                </button>
              </div>
            </div>
          </div>
          <label className="modal-backdrop" htmlFor="generate-modal">
            Close
          </label>
        </div>

        {/* Show Key Modal (one-time display) */}
        {showNewKeyModal && newKeyData && (
          <Modal
            open={showNewKeyModal}
            onClose={closeNewKeyModal}
            title="API Key Generated"
            size="lg"
          >
            <div className="space-y-5">
              {/* Warning */}
              <div className="alert alert-warning">
                <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <span>
                  This key will only be shown once. Copy it now and store it securely.
                </span>
              </div>

              {/* API Key */}
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-bold">Your API Key</span>
                </label>
                <div className="join w-full">
                  <input
                    type="text"
                    className="input input-bordered join-item flex-1 font-mono text-sm"
                    value={newKeyData.api_key}
                    readOnly
                  />
                  <button
                    className={`btn join-item ${copied ? 'btn-success' : 'btn-outline'}`}
                    onClick={() => copyToClipboard(newKeyData.api_key)}
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Base URL & Quick Start */}
              {newKeyData.base_url && (
                <div className="space-y-3">
                  <div className="divider text-sm text-base-content/50">Usage Guide</div>

                  {/* Base URL display */}
                  <div className="form-control">
                    <label className="label pb-1">
                      <span className="label-text font-semibold">Base URL</span>
                    </label>
                    <div className="join w-full">
                      <input
                        type="text"
                        className="input input-bordered join-item flex-1 font-mono text-sm"
                        value={newKeyData.base_url}
                        readOnly
                      />
                      <button
                        className="btn btn-outline join-item"
                        onClick={() => copyToClipboard(newKeyData.base_url)}
                      >
                        Copy
                      </button>
                    </div>
                  </div>

                  {/* OpenAI SDK example */}
                  <div className="bg-base-200 rounded-lg p-3 space-y-2">
                    <span className="text-xs font-semibold uppercase text-base-content/50">
                      OpenAI SDK / OpenAI 兼容客户端
                    </span>
                    <pre className="text-xs overflow-x-auto">
                      <code>{`from openai import OpenAI

client = OpenAI(
    base_url="${newKeyData.base_url}/v1",
    api_key="${newKeyData.api_key}",
)
# model 填任意在平台配置的模型名即可
response = client.chat.completions.create(
    model="${newKeyData.models?.[0] || 'deepseek-v4-flash'}",
    messages=[{"role": "user", "content": "Hello"}],
)`}</code>
                    </pre>
                    <div className="text-xs text-base-content/50">
                      或设置环境变量：<br />
                      <code className="bg-base-300 px-1 rounded">export OPENAI_BASE_URL="{newKeyData.base_url}/v1"</code><br />
                      <code className="bg-base-300 px-1 rounded">export OPENAI_API_KEY="{newKeyData.api_key}"</code>
                    </div>
                  </div>

                  {/* Anthropic SDK example */}
                  <div className="bg-base-200 rounded-lg p-3 space-y-2">
                    <span className="text-xs font-semibold uppercase text-base-content/50">
                      Anthropic SDK
                    </span>
                    <pre className="text-xs overflow-x-auto">
                      <code>{`# 环境变量方式
export ANTHROPIC_BASE_URL="${newKeyData.base_url}/anthropic"
export ANTHROPIC_API_KEY="${newKeyData.api_key}"

# 或代码中配置
import anthropic
client = anthropic.Anthropic(
    base_url="${newKeyData.base_url}/anthropic",
    api_key="${newKeyData.api_key}",
)`}</code>
                    </pre>
                  </div>

                  {/* curl example */}
                  <div className="bg-base-200 rounded-lg p-3 space-y-2">
                    <span className="text-xs font-semibold uppercase text-base-content/50">
                      curl 快速测试
                    </span>
                    <pre className="text-xs overflow-x-auto">
                      <code>{`curl -X POST "${newKeyData.base_url}/v1/chat/completions" \\
  -H "Authorization: Bearer ${newKeyData.api_key}" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${newKeyData.models?.[0] || 'deepseek-v4-flash'}", "messages": [{"role": "user", "content": "Hello"}]}'`}</code>
                    </pre>
                  </div>
                </div>
              )}

              {/* Key metadata */}
              <div className="text-sm text-base-content/60 space-y-1">
                <div className="divider text-sm text-base-content/50 mb-1">Key Details</div>
                <p>
                  <strong>Key Suffix:</strong> {newKeyData.key_suffix}
                </p>
                {newKeyData.models.length > 0 && (
                  <p>
                    <strong>Models:</strong> {newKeyData.models.join(', ')}
                  </p>
                )}
                {newKeyData.expires_at && (
                  <p>
                    <strong>Expires:</strong>{' '}
                    {new Date(newKeyData.expires_at).toLocaleDateString()}
                  </p>
                )}
              </div>

              <div className="modal-action">
                <button
                  className="btn btn-primary"
                  onClick={closeNewKeyModal}
                >
                  I've Saved My Key
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </Layout>
  );
}
