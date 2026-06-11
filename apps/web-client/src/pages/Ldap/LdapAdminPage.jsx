/** LDAP Admin Page — manage Keycloak LDAP User Federation via Keycloak REST API.
 *  Only accessible to users in the 'admins' group. */

import { useCallback, useEffect, useState } from 'react';
import Layout from '../../components/layout/Layout';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import { ldapApi } from '../../services/api';

const VENDORS = [
  { value: 'ad', label: 'Active Directory' },
  { value: 'rhds', label: 'Red Hat Directory Server' },
  { value: 'tivoli', label: 'IBM Tivoli Directory' },
  { value: 'other', label: 'Other (OpenLDAP / Generic)' },
];

const AUTH_TYPES = [
  { value: 'simple', label: 'LDAP (via BindDN)' },
  { value: 'anonymous', label: 'LDAP (Anonymous)' },
];

const SECURITY_PROTOCOLS = [
  { value: 'unencrypted', label: 'Unencrypted' },
  { value: 'ldaps', label: 'LDAPS (SSL/TLS)' },
  { value: 'starttls', label: 'StartTLS' },
];

// Default attribute values per vendor
const VENDOR_DEFAULTS = {
  ad: {
    username_attr: 'sAMAccountName',
    rdn_attr: 'sAMAccountName',
    uuid_attr: 'objectGUID',
  },
  rhds: {
    username_attr: 'uid',
    rdn_attr: 'uid',
    uuid_attr: 'nsuniqueid',
  },
  tivoli: {
    username_attr: 'uid',
    rdn_attr: 'uid',
    uuid_attr: 'ibm-entryuuid',
  },
  other: {
    username_attr: 'uid',
    rdn_attr: 'uid',
    uuid_attr: 'entryUUID',
  },
};

const EMPTY_FORM = {
  name: '',
  vendor: 'ad',
  auth_type: 'simple',
  security_protocol: 'unencrypted',
  host: '',
  port: 389,
  bind_dn: '',
  bind_password: '',
  user_search_base: '',
  user_filter: '',
  username_attr: 'sAMAccountName',
  rdn_attr: 'sAMAccountName',
  uuid_attr: 'objectGUID',
  first_name_attr: '',
  last_name_attr: '',
  email_attr: '',
  enabled: true,
};

// ── Standalone form component (module-level to avoid focus loss) ──────

function LdapFormFields({ form, setForm, showPw, setShowPw, isEdit = false }) {
  const handleVendorChange = (vendor) => {
    const defaults = VENDOR_DEFAULTS[vendor] || VENDOR_DEFAULTS.other;
    setForm((f) => ({
      ...f,
      vendor,
      username_attr: defaults.username_attr,
      rdn_attr: defaults.rdn_attr,
      uuid_attr: defaults.uuid_attr,
    }));
  };

  // Auto-set port when security protocol changes
  const handleProtocolChange = (protocol) => {
    const defaultPorts = { unencrypted: 389, ldaps: 636, starttls: 389 };
    setForm((f) => ({
      ...f,
      security_protocol: protocol,
      port: defaultPorts[protocol] || 389,
    }));
  };

  return (
    <div className="space-y-4">
      {/* Row 1: Name + Vendor */}
      <div className="grid grid-cols-2 gap-4">
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
        <div className="form-control">
          <label className="label">
            <span className="label-text font-medium">Vendor</span>
          </label>
          <select
            className="select select-bordered"
            value={form.vendor}
            onChange={(e) => handleVendorChange(e.target.value)}
          >
            {VENDORS.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
          <label className="label">
            <span className="label-text-alt text-base-content/50">
              Determines default attribute mappings
            </span>
          </label>
        </div>
      </div>

      {/* Row 2: Auth Type + Security Protocol */}
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
            <span className="label-text font-medium">Security Protocol</span>
          </label>
          <select
            className="select select-bordered"
            value={form.security_protocol}
            onChange={(e) => handleProtocolChange(e.target.value)}
          >
            {SECURITY_PROTOCOLS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 3: Host + Port */}
      <div className="grid grid-cols-3 gap-4">
        <div className="form-control col-span-2">
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
            <span className="label-text font-medium">Port</span>
          </label>
          <input
            type="number"
            className="input input-bordered"
            placeholder="389 or 636"
            value={form.port}
            onChange={(e) => setForm((f) => ({ ...f, port: parseInt(e.target.value) || 389 }))}
          />
        </div>
      </div>

      {/* Row 4: Bind DN */}
      <div className="form-control">
        <label className="label">
          <span className="label-text font-medium">Bind DN</span>
        </label>
        <input
          type="text"
          className="input input-bordered font-mono text-sm"
          placeholder="e.g., CN=svc_keycloak,OU=ServiceAccounts,DC=mydomain,DC=com"
          value={form.bind_dn}
          onChange={(e) => setForm((f) => ({ ...f, bind_dn: e.target.value }))}
        />
        <label className="label">
          <span className="label-text-alt text-base-content/50">
            Use '%s' as username placeholder, e.g., DOM\%s or uid=%s,ou=Users,dc=mydomain,dc=com
          </span>
        </label>
      </div>

      {/* Row 5: Bind Password */}
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
            placeholder={isEdit ? 'Leave blank to keep current' : 'Enter bind password'}
            value={form.bind_password}
            onChange={(e) => setForm((f) => ({ ...f, bind_password: e.target.value }))}
          />
          <button type="button" className="btn btn-outline join-item" onClick={() => setShowPw((v) => !v)}>
            {showPw ? 'Hide' : 'Show'}
          </button>
        </div>
        <label className="label">
          <span className="label-text-alt text-warning">
            ⚠ Warning: This password is stored in Keycloak's database in reversible form. Do not use a high-privilege account!
          </span>
        </label>
      </div>

      {/* Row 6: User Search Base + User Filter */}
      <div className="grid grid-cols-2 gap-4">
        <div className="form-control">
          <label className="label">
            <span className="label-text font-medium">User Search Base</span>
          </label>
          <input
            type="text"
            className="input input-bordered font-mono text-sm"
            placeholder="e.g., OU=Users,DC=mydomain,DC=com"
            value={form.user_search_base}
            onChange={(e) => setForm((f) => ({ ...f, user_search_base: e.target.value }))}
          />
        </div>
        <div className="form-control">
          <label className="label">
            <span className="label-text font-medium">Custom User Filter</span>
          </label>
          <input
            type="text"
            className="input input-bordered font-mono text-sm"
            placeholder="e.g., (&amp;(objectClass=person)(uid=%s))"
            value={form.user_filter}
            onChange={(e) => setForm((f) => ({ ...f, user_filter: e.target.value }))}
          />
          <label className="label">
            <span className="label-text-alt text-base-content/50">
              Additional LDAP filter appended to the base search
            </span>
          </label>
        </div>
      </div>

      {/* Row 7: LDAP Attribute Mapping (core) */}
      <div className="bg-base-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold mb-3">Core LDAP Attributes</h4>
        <div className="grid grid-cols-3 gap-4">
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">Username Attribute</span>
            </label>
            <input
              type="text"
              className="input input-bordered input-sm font-mono"
              value={form.username_attr}
              onChange={(e) => setForm((f) => ({ ...f, username_attr: e.target.value }))}
            />
            <label className="label">
              <span className="label-text-alt text-base-content/50">
                Defaults set by vendor
              </span>
            </label>
          </div>
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">RDN Attribute</span>
            </label>
            <input
              type="text"
              className="input input-bordered input-sm font-mono"
              value={form.rdn_attr}
              onChange={(e) => setForm((f) => ({ ...f, rdn_attr: e.target.value }))}
            />
          </div>
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">UUID Attribute</span>
            </label>
            <input
              type="text"
              className="input input-bordered input-sm font-mono"
              value={form.uuid_attr}
              onChange={(e) => setForm((f) => ({ ...f, uuid_attr: e.target.value }))}
            />
          </div>
        </div>
      </div>

      {/* Row 8: User Attribute Mappers (optional) */}
      <div className="bg-base-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold mb-3">
          User Attribute Mapping{' '}
          <span className="text-base-content/50 font-normal">(creates Keycloak mappers)</span>
        </h4>
        <div className="grid grid-cols-3 gap-4">
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">First Name Attribute</span>
            </label>
            <input
              type="text"
              className="input input-bordered input-sm font-mono"
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
              className="input input-bordered input-sm font-mono"
              placeholder="e.g., sn"
              value={form.last_name_attr}
              onChange={(e) => setForm((f) => ({ ...f, last_name_attr: e.target.value }))}
            />
          </div>
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">Email Attribute</span>
            </label>
            <input
              type="text"
              className="input input-bordered input-sm font-mono"
              placeholder="e.g., mail"
              value={form.email_attr}
              onChange={(e) => setForm((f) => ({ ...f, email_attr: e.target.value }))}
            />
          </div>
        </div>
        <label className="label">
          <span className="label-text-alt text-base-content/50">
            Leave empty to skip mapper creation. Keycloak auto-maps common attributes based on vendor.
          </span>
        </label>
      </div>

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
      name: source.name || '',
      vendor: source.vendor || 'ad',
      auth_type: source.auth_type || 'simple',
      security_protocol: source.security_protocol || 'unencrypted',
      host: source.host || '',
      port: source.port || 389,
      bind_dn: source.bind_dn || '',
      bind_password: '',
      user_search_base: source.user_search_base || '',
      user_filter: source.user_filter || '',
      username_attr: source.username_attr || '',
      rdn_attr: source.rdn_attr || '',
      uuid_attr: source.uuid_attr || '',
      first_name_attr: source.first_name_attr || '',
      last_name_attr: source.last_name_attr || '',
      email_attr: source.email_attr || '',
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
        if (editSource[key] !== value) {
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

  // ── Trigger sync ───────────────────────────────────────

  const triggerSync = async (source) => {
    try {
      await ldapApi.syncSource(source.id);
      setError(`Sync triggered for "${source.name || source.id}". Check Keycloak for progress.`);
      setTimeout(() => setError(null), 5000);
    } catch (err) {
      setError(err.message || 'Failed to trigger sync');
    }
  };

  // ── Render ────────────────────────────────────────────

  return (
    <Layout showSidebar={false}>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">LDAP Configuration</h1>
            <p className="text-base-content/60">
              Manage Keycloak LDAP User Federation sources — changes take effect on next login
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

        {/* Banner — can be error or info */}
        {error && (
          <div className={`alert ${error.startsWith('Sync triggered') ? 'alert-info' : 'alert-error'}`}>
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
            <p className="text-sm mt-1">Add an LDAP authentication source to enable domain login</p>
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
                          {VENDORS.find((v) => v.value === s.vendor)?.label || s.vendor}
                        </span>
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
                        <span className="font-medium">Filter:</span>{' '}
                        <code className="text-xs">{s.user_filter}</code>
                      </div>
                    )}
                    <div>
                      <span className="font-medium">Username attr:</span>{' '}
                      <code className="text-xs">{s.username_attr || '(login username)'}</code>
                    </div>
                    {s.bind_password_set && (
                      <div>
                        <span className="font-medium">Password:</span> ●●●●●●●● (set)
                      </div>
                    )}
                  </div>

                  <div className="card-actions justify-end mt-3 gap-2">
                    <button
                      className="btn btn-outline btn-xs"
                      onClick={() => triggerSync(s)}
                    >
                      Sync
                    </button>
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

        {/* ── Edit Modal ──────────────────────────────────── */}
        <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`Edit: ${editSource?.name || 'LDAP Source'}`} size="lg">
          {editSource && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-base-200 rounded-lg">
                <span className="badge badge-outline">
                  {VENDORS.find((v) => v.value === editSource.vendor)?.label || editSource.vendor}
                </span>
                <code className="text-sm">{editSource.host}:{editSource.port}</code>
              </div>

              <LdapFormFields
                form={editForm}
                setForm={setEditForm}
                showPw={showEditPassword}
                setShowPw={setShowEditPassword}
                isEdit
              />

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
                    This deletes the Keycloak LDAP User Storage Provider and all its mappers.
                    Users will no longer be able to authenticate via this LDAP source.
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
