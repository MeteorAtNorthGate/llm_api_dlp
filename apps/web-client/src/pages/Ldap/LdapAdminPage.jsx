/** LDAP Admin Page — manage Keycloak LDAP User Federation.
 *  Only accessible to users in the 'admins' group.
 *
 *  The form is intentionally minimal: only the fields IT actually needs
 *  to fill in. Everything else (vendor, authType, editMode, etc.) is
 *  hardcoded to sensible defaults by the backend. */

import { useCallback, useEffect, useState } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import { ldapApi } from '../../services/api';

const EMPTY_FORM = {
  name: '',
  host: '',
  port: 389,
  bind_dn: '',
  bind_password: '',
  users_dn: '',
  username_attr: 'sAMAccountName',
  rdn_attr: 'sAMAccountName',
  uuid_attr: 'objectGUID',
  enabled: true,
};

// ── Standalone form component (module-level to avoid focus loss) ──────

function LdapFormFields({ form, setForm, showPw, setShowPw, isEdit = false }) {
  return (
    <div className="space-y-5">
      {/* ── Connection ── */}
      <fieldset className="border border-base-300 rounded-lg p-4">
        <legend className="text-sm font-semibold px-2">Connection</legend>

        <div className="form-control mb-3">
          <label className="label pb-1">
            <span className="label-text font-medium">Auth Name *</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            placeholder="e.g., 公司内部AD域"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <label className="label">
            <span className="label-text-alt text-base-content/50">
              Display name shown on the login page
            </span>
          </label>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="form-control col-span-2">
            <label className="label pb-1">
              <span className="label-text font-medium">Host Address *</span>
            </label>
            <input
              type="text"
              className="input input-bordered font-mono text-sm"
              placeholder="e.g., 10.0.0.5 or mydomain.com"
              value={form.host}
              onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
            />
          </div>
          <div className="form-control">
            <label className="label pb-1">
              <span className="label-text font-medium">Port</span>
            </label>
            <select
              className="select select-bordered"
              value={form.port}
              onChange={(e) => setForm((f) => ({ ...f, port: parseInt(e.target.value) }))}
            >
              <option value={389}>389 (LDAP)</option>
              <option value={636}>636 (LDAPS)</option>
            </select>
          </div>
        </div>
      </fieldset>

      {/* ── Authentication ── */}
      <fieldset className="border border-base-300 rounded-lg p-4">
        <legend className="text-sm font-semibold px-2">Authentication</legend>

        <div className="form-control mb-3">
          <label className="label pb-1">
            <span className="label-text font-medium">Bind DN *</span>
          </label>
          <input
            type="text"
            className="input input-bordered font-mono text-sm"
            placeholder="e.g., CN=kc-ad-reader,CN=Users,DC=acken,DC=int"
            value={form.bind_dn}
            onChange={(e) => setForm((f) => ({ ...f, bind_dn: e.target.value }))}
          />
          <label className="label">
            <span className="label-text-alt text-base-content/50">
              A read-only service account DN. Do NOT use a domain admin account.
            </span>
          </label>
        </div>

        <div className="form-control">
          <label className="label pb-1">
            <span className="label-text font-medium">
              Bind Password * {isEdit && <span className="text-base-content/50 font-normal">(leave blank to keep current)</span>}
            </span>
          </label>
          <div className="join">
            <input
              type={showPw ? 'text' : 'password'}
              className="input input-bordered join-item flex-1 font-mono"
              placeholder={isEdit ? 'Leave blank to keep current' : 'Enter password'}
              value={form.bind_password}
              onChange={(e) => setForm((f) => ({ ...f, bind_password: e.target.value }))}
            />
            <button type="button" className="btn btn-outline join-item" onClick={() => setShowPw((v) => !v)}>
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
          <label className="label">
            <span className="label-text-alt text-warning">
              ⚠ Password is stored in Keycloak's database in reversible form. Use a low-privilege read-only account.
            </span>
          </label>
        </div>
      </fieldset>

      {/* ── User Search ── */}
      <fieldset className="border border-base-300 rounded-lg p-4">
        <legend className="text-sm font-semibold px-2">User Search</legend>

        <div className="form-control mb-3">
          <label className="label pb-1">
            <span className="label-text font-medium">Users DN *</span>
          </label>
          <input
            type="text"
            className="input input-bordered font-mono text-sm"
            placeholder="e.g., DC=acken,DC=int"
            value={form.users_dn}
            onChange={(e) => setForm((f) => ({ ...f, users_dn: e.target.value }))}
          />
          <label className="label">
            <span className="label-text-alt text-base-content/50">
              The base DN where Keycloak searches for user accounts. Use the root (<code>DC=...</code>) for
              the widest coverage, or narrow to a specific OU.
            </span>
          </label>
        </div>

        <details className="cursor-pointer">
          <summary className="text-sm font-medium text-base-content/70 py-1">
            Advanced: LDAP Attribute Names
          </summary>
          <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-base-300">
            <div className="form-control">
              <label className="label pb-1">
                <span className="label-text text-xs font-medium">Username Attribute</span>
              </label>
              <input
                type="text"
                className="input input-bordered input-sm font-mono"
                value={form.username_attr}
                onChange={(e) => setForm((f) => ({ ...f, username_attr: e.target.value }))}
              />
            </div>
            <div className="form-control">
              <label className="label pb-1">
                <span className="label-text text-xs font-medium">RDN Attribute</span>
              </label>
              <input
                type="text"
                className="input input-bordered input-sm font-mono"
                value={form.rdn_attr}
                onChange={(e) => setForm((f) => ({ ...f, rdn_attr: e.target.value }))}
              />
            </div>
            <div className="form-control">
              <label className="label pb-1">
                <span className="label-text text-xs font-medium">UUID Attribute</span>
              </label>
              <input
                type="text"
                className="input input-bordered input-sm font-mono"
                value={form.uuid_attr}
                onChange={(e) => setForm((f) => ({ ...f, uuid_attr: e.target.value }))}
              />
            </div>
          </div>
          <p className="text-xs text-base-content/50 mt-2">
            These are pre-filled with Windows AD defaults (sAMAccountName / objectGUID).
            Only change if your directory uses different attribute names.
          </p>
        </details>
      </fieldset>

      {/* Enabled toggle (edit mode) */}
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
}

// ── Main page component ──────────────────────────────────────────────

export default function LdapAdminPage() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const [showEdit, setShowEdit] = useState(false);
  const [editSource, setEditSource] = useState(null);
  const [editForm, setEditForm] = useState({ ...EMPTY_FORM });
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState(null);
  const [showEditPassword, setShowEditPassword] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  useEffect(() => { fetchSources(); }, [fetchSources]);

  const handleAdd = async () => {
    setAddError(null);
    if (!addForm.name || !addForm.host || !addForm.bind_dn || !addForm.bind_password || !addForm.users_dn) {
      setAddError('All fields except the advanced attribute names are required.');
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

  const openEdit = (source) => {
    setEditSource(source);
    setEditForm({
      name: source.name || '',
      host: source.host || '',
      port: source.port || 389,
      bind_dn: source.bind_dn || '',
      bind_password: '',
      users_dn: source.users_dn || '',
      username_attr: source.username_attr || 'sAMAccountName',
      rdn_attr: source.rdn_attr || 'sAMAccountName',
      uuid_attr: source.uuid_attr || 'objectGUID',
      enabled: source.enabled !== false,
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
        if (key === 'bind_password' && !value) continue;
        if (editSource[key] !== value) payload[key] = value;
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

  const toggleEnabled = async (source) => {
    try {
      await ldapApi.updateSource(source.id, { enabled: !source.enabled });
      await fetchSources();
    } catch (err) {
      setError(err.message || 'Failed to toggle source');
    }
  };

  const triggerSync = async (source) => {
    try {
      await ldapApi.syncSource(source.id);
      setError(null);
      // Show success via a brief info
      const msg = `Sync triggered for "${source.name}". Check Keycloak admin for progress.`;
      setError(msg);
      setTimeout(() => setError(null), 5000);
    } catch (err) {
      setError(err.message || 'Failed to trigger sync');
    }
  };

  return (
    <Layout showSidebar={false}>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">LDAP Configuration</h1>
            <p className="text-base-content/60">
              Manage Windows AD / LDAP authentication sources
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

        {error && (
          <div className={`alert ${error.startsWith('Sync triggered') ? 'alert-info' : 'alert-error'}`}>
            <span>{error}</span>
            <button className="btn btn-ghost btn-xs" onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : sources.length === 0 ? (
          <div className="text-center py-16 text-base-content/50 border border-dashed border-base-300 rounded-lg">
            <p className="text-lg font-medium">No LDAP sources configured</p>
            <p className="text-sm mt-1">Add an AD / LDAP source to enable domain authentication</p>
          </div>
        ) : (
          <div className="space-y-4">
            {sources.map((s) => (
              <div key={s.id} className={`card bg-base-100 shadow-sm border ${s.enabled ? 'border-base-300' : 'border-base-300 opacity-60'}`}>
                <div className="card-body p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="font-bold text-lg">{s.name || 'Unnamed'}</h3>
                        {s.enabled ? (
                          <span className="badge badge-success badge-sm">Active</span>
                        ) : (
                          <span className="badge badge-ghost badge-sm">Disabled</span>
                        )}
                      </div>
                      <div className="text-sm text-base-content/60 mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
                        <div><span className="font-medium">Host:</span> <code className="text-xs">{s.host}:{s.port}</code></div>
                        <div><span className="font-medium">Search Base:</span> <code className="text-xs">{s.users_dn || '—'}</code></div>
                        <div><span className="font-medium">Bind DN:</span> <code className="text-xs truncate block max-w-[280px]">{s.bind_dn || '—'}</code></div>
                        <div>
                          <span className="font-medium">Attributes:</span>{' '}
                          <code className="text-xs">{s.username_attr}</code>
                          {s.bind_password_set && <span className="ml-2 text-xs">🔒 password set</span>}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="card-actions justify-end mt-3 gap-2">
                    <button className="btn btn-outline btn-xs" onClick={() => triggerSync(s)}>Sync Now</button>
                    <button
                      className={`btn btn-xs ${s.enabled ? 'btn-outline btn-warning' : 'btn-outline btn-success'}`}
                      onClick={() => toggleEnabled(s)}
                    >
                      {s.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button className="btn btn-outline btn-xs" onClick={() => openEdit(s)}>Edit</button>
                    <button className="btn btn-error btn-xs btn-outline" onClick={() => setDeleteTarget(s)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Add Modal ── */}
        <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add LDAP Auth Source" size="lg">
          <div className="space-y-4">
            <LdapFormFields form={addForm} setForm={setAddForm} showPw={showPassword} setShowPw={setShowPassword} />
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

        {/* ── Edit Modal ── */}
        <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`Edit: ${editSource?.name || 'LDAP Source'}`} size="lg">
          {editSource && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-base-200 rounded-lg text-sm">
                <code>{editSource.host}:{editSource.port}</code>
                <span className="text-base-content/50">→</span>
                <code>{editSource.users_dn}</code>
              </div>
              <LdapFormFields form={editForm} setForm={setEditForm} showPw={showEditPassword} setShowPw={setShowEditPassword} isEdit />
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

        {/* ── Delete Modal ── */}
        <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete LDAP Source">
          {deleteTarget && (
            <div className="space-y-4">
              <div className="alert alert-warning">
                <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <p className="font-bold">Remove "{deleteTarget.name || 'Unnamed'}"?</p>
                  <p className="text-sm">This deletes the LDAP provider from Keycloak. Domain users will no longer be able to log in via this source.</p>
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
