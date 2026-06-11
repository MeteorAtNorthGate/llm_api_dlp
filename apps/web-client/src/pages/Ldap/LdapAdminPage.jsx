/** LDAP Admin Page — manage domain controller authentication sources.
 *  Only accessible to users in the 'admins' group. */

import { useCallback, useEffect, useState } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import { ldapApi } from '../../services/api';

const AUTH_TYPES = [
  { value: 'bind_dn', label: 'LDAP (via BindDN)' },
  { value: 'principal', label: 'LDAP (via Principal)' },
  { value: 'anonymous', label: 'LDAP (Anonymous)' },
];

const SECURITY_PROTOCOLS = [
  { value: 'unencrypted', label: 'Unencrypted' },
  { value: 'ldaps', label: 'LDAPS (SSL/TLS)' },
  { value: 'starttls', label: 'StartTLS' },
];

const EMPTY_FORM = {
  auth_type: 'bind_dn',
  name: '',
  security_protocol: 'unencrypted',
  host: '',
  port: 389,
  bind_dn: '',
  bind_password: '',
  user_search_base: '',
  user_filter: '',
  admin_filter: '',
  username_attr: '',
  first_name_attr: '',
  last_name_attr: '',
  email_attr: '',
  enabled: true,
};

export default function LdapAdminPage() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Add modal
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  // Edit modal
  const [showEdit, setShowEdit] = useState(false);
  const [editSource, setEditSource] = useState(null);
  const [editForm, setEditForm] = useState({ ...EMPTY_FORM });
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState(null);
  const [showEditPassword, setShowEditPassword] = useState(false);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // ── Fetch sources ──────────────────────────────────────

  const fetchSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await ldapApi.listSources();
      setSources(data.sources || []);
    } catch (err) {
      setError(err.message || 'Failed to load LDAP sources');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  // ── Add source ─────────────────────────────────────────

  const handleAdd = async () => {
    setAddError(null);
    if (!addForm.name || !addForm.host) {
      setAddError('Auth name and Host address are required.');
      return;
    }
    setAdding(true);
    try {
      await ldapApi.createSource(addForm);
      setShowAdd(false);
      setAddForm({ ...EMPTY_FORM });
      setShowPassword(false);
      await fetchSources();
    } catch (err) {
      setAddError(err.message || 'Failed to add LDAP source');
    } finally {
      setAdding(false);
    }
  };

  // ── Edit source ────────────────────────────────────────

  const openEdit = (source) => {
    setEditSource(source);
    setEditForm({
      auth_type: source.auth_type,
      name: source.name,
      security_protocol: source.security_protocol,
      host: source.host,
      port: source.port,
      bind_dn: source.bind_dn,
      bind_password: '',
      user_search_base: source.user_search_base,
      user_filter: source.user_filter,
      admin_filter: source.admin_filter,
      username_attr: source.username_attr,
      first_name_attr: source.first_name_attr,
      last_name_attr: source.last_name_attr,
      email_attr: source.email_attr,
      enabled: source.enabled,
    });
    setEditError(null);
    setShowEditPassword(false);
    setShowEdit(true);
  };

  const handleEdit = async () => {
    setEditError(null);
    setEditing(true);
    try {
      const payload = {};
      for (const [key, value] of Object.entries(editForm)) {
        if (key === 'bind_password' && !value) continue; // skip empty password
        if (value !== editSource[key]) {
          payload[key] = value;
        }
      }
      if (Object.keys(payload).length === 0) {
        setShowEdit(false);
        setEditing(false);
        return;
      }
      await ldapApi.updateSource(editSource.id, payload);
      setShowEdit(false);
      setEditSource(null);
      await fetchSources();
    } catch (err) {
      setEditError(err.message || 'Failed to update LDAP source');
    } finally {
      setEditing(false);
    }
  };

  // ── Delete source ──────────────────────────────────────

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await ldapApi.deleteSource(deleteTarget.id);
      setDeleteTarget(null);
      await fetchSources();
    } catch (err) {
      setError(err.message || 'Failed to delete LDAP source');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  // ── Toggle enabled ─────────────────────────────────────

  const toggleEnabled = async (source) => {
    try {
      await ldapApi.updateSource(source.id, { enabled: !source.enabled });
      await fetchSources();
    } catch (err) {
      setError(err.message || 'Failed to toggle source');
    }
  };

  // ── Form fields component ──────────────────────────────

  const FormFields = ({ form, setForm, showPw, setShowPw, isEdit = false }) => (
    <div className="space-y-4">
      {/* Row 1: Auth Type + Auth Name */}
      <div className="grid grid-cols-2 gap-4">
        <div className="form-control">
          <label className="label">
            <span className="label-text font-medium">Auth Type</span>
          </label>
          <select
            className="select select-bordered"
            value={form.auth_type}
            onChange={(e) => setForm((f) => ({ ...f, auth_type: e.target.value }))}
          >
            {AUTH_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="form-control">
          <label className="label">
            <span className="label-text font-medium">Auth Name *</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            placeholder="e.g., 域控登录 (Windows AD)"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <label className="label">
            <span className="label-text-alt text-base-content/50">
              Display name shown on the login page
            </span>
          </label>
        </div>
      </div>

      {/* Row 2: Security Protocol + Host + Port */}
      <div className="grid grid-cols-3 gap-4">
        <div className="form-control">
          <label className="label">
            <span className="label-text font-medium">Security Protocol</span>
          </label>
          <select
            className="select select-bordered"
            value={form.security_protocol}
            onChange={(e) => setForm((f) => ({ ...f, security_protocol: e.target.value }))}
          >
            {SECURITY_PROTOCOLS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="form-control">
          <label className="label">
            <span className="label-text font-medium">Host Address *</span>
          </label>
          <input
            type="text"
            className="input input-bordered font-mono text-sm"
            placeholder="e.g., mydomain.com"
            value={form.host}
            onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
          />
        </div>
        <div className="form-control">
          <label className="label">
            <span className="label-text font-medium">Host Port</span>
          </label>
          <input
            type="number"
            className="input input-bordered"
            placeholder="e.g., 389 or 636"
            value={form.port}
            onChange={(e) => setForm((f) => ({ ...f, port: parseInt(e.target.value) || 389 }))}
          />
        </div>
      </div>

      {/* Row 3: Bind DN */}
      <div className="form-control">
        <label className="label">
          <span className="label-text font-medium">Bind DN</span>
        </label>
        <input
          type="text"
          className="input input-bordered font-mono text-sm"
          placeholder="e.g., cn=Search,dc=mydomain,dc=com"
          value={form.bind_dn}
          onChange={(e) => setForm((f) => ({ ...f, bind_dn: e.target.value }))}
        />
        <label className="label">
          <span className="label-text-alt text-base-content/50">
            You can use '%s' as a placeholder for the username, e.g., DOM\%s
          </span>
        </label>
      </div>

      {/* Row 4: Bind Password */}
      <div className="form-control">
        <label className="label">
          <span className="label-text font-medium">
            Bind Password {isEdit && <span className="text-base-content/50">(leave blank to keep current)</span>}
          </span>
        </label>
        <div className="join">
          <input
            type={showPw ? 'text' : 'password'}
            className="input input-bordered join-item flex-1 font-mono"
            placeholder={isEdit ? 'Leave blank to keep current password' : 'Enter bind password'}
            value={form.bind_password}
            onChange={(e) => setForm((f) => ({ ...f, bind_password: e.target.value }))}
          />
          <button
            type="button"
            className="btn btn-outline join-item"
            onClick={() => setShowPw((v) => !v)}
          >
            {showPw ? 'Hide' : 'Show'}
          </button>
        </div>
        <label className="label">
          <span className="label-text-alt text-warning">
            ⚠ Warning: This password will be stored in plaintext in the database. Do not use a high-privilege account!
          </span>
        </label>
      </div>

      {/* Row 5: User Search Base */}
      <div className="form-control">
        <label className="label">
          <span className="label-text font-medium">User Search Base</span>
        </label>
        <input
          type="text"
          className="input input-bordered font-mono text-sm"
          placeholder="e.g., ou=Users,dc=mydomain,dc=com"
          value={form.user_search_base}
          onChange={(e) => setForm((f) => ({ ...f, user_search_base: e.target.value }))}
        />
      </div>

      {/* Row 6: User Filter + Admin Filter */}
      <div className="grid grid-cols-2 gap-4">
        <div className="form-control">
          <label className="label">
            <span className="label-text font-medium">User Filter Rule</span>
          </label>
          <input
            type="text"
            className="input input-bordered font-mono text-sm"
            placeholder="e.g., (&(objectClass=posixAccount)(uid=%s))"
            value={form.user_filter}
            onChange={(e) => setForm((f) => ({ ...f, user_filter: e.target.value }))}
          />
        </div>
        <div className="form-control">
          <label className="label">
            <span className="label-text font-medium">Admin Filter Rule</span>
          </label>
          <input
            type="text"
            className="input input-bordered font-mono text-sm"
            placeholder="e.g., (memberOf=cn=Admins,dc=mydomain,dc=com)"
            value={form.admin_filter}
            onChange={(e) => setForm((f) => ({ ...f, admin_filter: e.target.value }))}
          />
        </div>
      </div>

      {/* Row 7: Attribute mappings */}
      <div className="bg-base-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold mb-3">Attribute Mapping</h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">Username Attribute</span>
            </label>
            <input
              type="text"
              className="input input-bordered input-sm"
              placeholder="Leave empty to use login username"
              value={form.username_attr}
              onChange={(e) => setForm((f) => ({ ...f, username_attr: e.target.value }))}
            />
            <label className="label">
              <span className="label-text-alt text-base-content/50">
                Leave empty to use the login username as-is
              </span>
            </label>
          </div>
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">Email Attribute</span>
            </label>
            <input
              type="text"
              className="input input-bordered input-sm"
              placeholder="e.g., mail"
              value={form.email_attr}
              onChange={(e) => setForm((f) => ({ ...f, email_attr: e.target.value }))}
            />
          </div>
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">First Name Attribute</span>
            </label>
            <input
              type="text"
              className="input input-bordered input-sm"
              placeholder="e.g., givenName"
              value={form.first_name_attr}
              onChange={(e) => setForm((f) => ({ ...f, first_name_attr: e.target.value }))}
            />
          </div>
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">Last Name Attribute</span>
            </label>
            <input
              type="text"
              className="input input-bordered input-sm"
              placeholder="e.g., sn"
              value={form.last_name_attr}
              onChange={(e) => setForm((f) => ({ ...f, last_name_attr: e.target.value }))}
            />
          </div>
        </div>
      </div>

      {/* Enabled toggle */}
      {isEdit && (
        <div className="form-control">
          <label className="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            <span className="label-text font-medium">Enabled</span>
          </label>
        </div>
      )}
    </div>
  );

  // ── Render ────────────────────────────────────────────

  return (
    <Layout showSidebar={false}>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">LDAP Configuration</h1>
            <p className="text-base-content/60">
              Manage domain controller authentication sources for the login page
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => {
              setAddForm({ ...EMPTY_FORM });
              setAddError(null);
              setShowPassword(false);
              setShowAdd(true);
            }}
          >
            + Add LDAP Source
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="alert alert-error">
            <span>{error}</span>
            <button className="btn btn-ghost btn-xs" onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {/* Source list */}
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : sources.length === 0 ? (
          <div className="text-center py-16 text-base-content/50 border border-dashed border-base-300 rounded-lg">
            <p className="text-lg font-medium">No LDAP sources configured</p>
            <p className="text-sm mt-1">Add your first LDAP authentication source to get started</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {sources.map((s) => (
              <div key={s.id} className={`card bg-base-100 shadow-sm border ${s.enabled ? 'border-base-300' : 'border-base-300 opacity-60'}`}>
                <div className="card-body p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-lg">{s.name || 'Unnamed Source'}</h3>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="badge badge-outline badge-sm">
                          {AUTH_TYPES.find((t) => t.value === s.auth_type)?.label || s.auth_type}
                        </span>
                        <span className="badge badge-outline badge-sm">
                          {SECURITY_PROTOCOLS.find((p) => p.value === s.security_protocol)?.label || s.security_protocol}
                        </span>
                        {s.enabled ? (
                          <span className="badge badge-success badge-sm">Enabled</span>
                        ) : (
                          <span className="badge badge-ghost badge-sm">Disabled</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-base-content/60 mt-3 space-y-1">
                    <div>
                      <span className="font-medium">Host:</span>{' '}
                      <code className="text-xs">{s.host}:{s.port}</code>
                    </div>
                    {s.bind_dn && (
                      <div>
                        <span className="font-medium">Bind DN:</span>{' '}
                        <code className="text-xs">{s.bind_dn}</code>
                      </div>
                    )}
                    {s.user_search_base && (
                      <div>
                        <span className="font-medium">Search Base:</span>{' '}
                        <code className="text-xs">{s.user_search_base}</code>
                      </div>
                    )}
                    {s.user_filter && (
                      <div>
                        <span className="font-medium">User Filter:</span>{' '}
                        <code className="text-xs">{s.user_filter}</code>
                      </div>
                    )}
                    {s.bind_password_set && (
                      <div>
                        <span className="font-medium">Password:</span> ●●●●●●●● (set)
                      </div>
                    )}
                    <div>
                      <span className="font-medium">ID:</span>{' '}
                      <code className="text-xs">{s.id?.slice(0, 12)}...</code>
                    </div>
                  </div>

                  <div className="card-actions justify-end mt-3 gap-2">
                    <button
                      className={`btn btn-xs ${s.enabled ? 'btn-outline btn-warning' : 'btn-outline btn-success'}`}
                      onClick={() => toggleEnabled(s)}
                    >
                      {s.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      className="btn btn-outline btn-xs"
                      onClick={() => openEdit(s)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-error btn-xs btn-outline"
                      onClick={() => setDeleteTarget(s)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Add Modal ──────────────────────────────────── */}
        <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add LDAP Auth Source" size="lg">
          <div className="space-y-4">
            <FormFields form={addForm} setForm={setAddForm} showPw={showPassword} setShowPw={setShowPassword} />

            {addError && <div className="alert alert-error text-sm"><span>{addError}</span></div>}

            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={adding}>
                {adding && <span className="loading loading-spinner loading-sm" />}
                Add Source
              </button>
            </div>
          </div>
        </Modal>

        {/* ── Edit Modal ──────────────────────────────────── */}
        <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`Edit: ${editSource?.name || 'LDAP Source'}`} size="lg">
          {editSource && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-base-200 rounded-lg">
                <span className="badge badge-outline">
                  {AUTH_TYPES.find((t) => t.value === editSource.auth_type)?.label || editSource.auth_type}
                </span>
                <code className="text-sm">{editSource.host}:{editSource.port}</code>
              </div>

              <FormFields form={editForm} setForm={setEditForm} showPw={showEditPassword} setShowPw={setShowEditPassword} isEdit />

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
        <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete LDAP Source">
          {deleteTarget && (
            <div className="space-y-4">
              <div className="alert alert-warning">
                <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <p className="font-bold">Remove "{deleteTarget.name || 'Unnamed Source'}"?</p>
                  <p className="text-sm">
                    Users will no longer be able to authenticate via this LDAP source. This action cannot be undone.
                  </p>
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
