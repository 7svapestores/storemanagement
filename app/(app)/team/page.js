'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { PageHeader, Modal, Field, Button, Loading, Alert, ConfirmModal } from '@/components/UI';
import { logActivity } from '@/lib/activity';

export default function TeamPage() {
  const { supabase, isOwner, profile, user } = useAuth();
  const [users, setUsers] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [addModal, setAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ email: '', password: '', name: '', role: 'employee', store_id: '' });

  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', store_id: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: p }, { data: s }] = await Promise.all([
      supabase.from('profiles').select('*, stores:store_id(name, color)').order('role'),
      supabase.from('stores').select('*').order('created_at'),
    ]);
    setUsers(p || []);
    setStores(s || []);
    if (!addForm.store_id && s?.length) setAddForm(f => ({ ...f, store_id: s[0].id }));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  if (!isOwner) return <div className="text-[var(--text-muted)] text-center py-20">Owner access required</div>;
  if (loading) return <Loading />;

  // ── Add ─────────────────────────────────────────
  const handleAdd = async () => {
    if (!addForm.email.trim() || !addForm.password || !addForm.name.trim()) {
      setMsg('Name, email, and password are required.');
      return;
    }
    if (addForm.password.length < 6) {
      setMsg('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || 'Failed'); return; }
      await logActivity(supabase, profile, {
        action: 'create', entityType: 'user',
        entityId: data.user?.id,
        description: `${profile?.name} created user "${addForm.name}" (${addForm.email}) as ${addForm.role}`,
      });
      setAddModal(false);
      setAddForm({ email: '', password: '', name: '', role: 'employee', store_id: stores[0]?.id || '' });
      setMsg('success');
      setTimeout(() => setMsg(''), 2500);
      load();
    } finally {
      setBusy(false);
    }
  };

  // ── Edit ────────────────────────────────────────
  const openEdit = (u) => {
    setEditUser(u);
    setEditForm({ name: u.name || '', store_id: u.store_id || '', password: '' });
    setShowPassword(false);
  };

  const handleEdit = async () => {
    if (!editUser) return;
    if (!editForm.name.trim()) { setMsg('Name required'); return; }
    if (editForm.password && editForm.password.length < 6) {
      setMsg('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      const body = {
        userId: editUser.id,
        name: editForm.name,
        store_id: editUser.role === 'owner' ? null : editForm.store_id || null,
      };
      if (editForm.password) body.password = editForm.password;
      const res = await fetch('/api/auth/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || 'Update failed'); return; }
      await logActivity(supabase, profile, {
        action: 'update', entityType: 'user',
        entityId: editUser.id,
        description: `${profile?.name} updated user "${editUser.name}"${editForm.password ? ' (password reset)' : ''}`,
      });
      setEditUser(null);
      setMsg('success');
      setTimeout(() => setMsg(''), 2500);
      load();
    } finally {
      setBusy(false);
    }
  };

  // ── Deactivate / reactivate ─────────────────────
  const toggleActive = async (u, nextActive) => {
    setBusy(true);
    try {
      const res = await fetch('/api/auth/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, is_active: nextActive }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || 'Failed'); return; }
      await logActivity(supabase, profile, {
        action: 'update', entityType: 'user',
        entityId: u.id,
        description: `${profile?.name} ${nextActive ? 'reactivated' : 'deactivated'} user "${u.name}"`,
      });
      setConfirmDeactivate(null);
      setMsg('success');
      setTimeout(() => setMsg(''), 2500);
      load();
    } finally {
      setBusy(false);
    }
  };

  // ── Delete ──────────────────────────────────────
  const handleDelete = async () => {
    const u = confirmDelete;
    if (!u) return;
    setBusy(true);
    try {
      const res = await fetch('/api/auth/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg(data.error || 'Delete failed'); setConfirmDelete(null); return; }
      await logActivity(supabase, profile, {
        action: 'delete', entityType: 'user',
        entityId: u.id,
        description: `${profile?.name} deleted user "${u.name}" (${u.role})`,
        metadata: { deleted: u },
      });
      setConfirmDelete(null);
      setMsg('success');
      setTimeout(() => setMsg(''), 2500);
      load();
    } finally {
      setBusy(false);
    }
  };

  const isSelf = (u) => u.id === user?.id;

  return (
    <div>
      <PageHeader title="👤 Admin" subtitle={`${users.length} users`}>
        <Button onClick={() => setAddModal(true)}>+ Add User</Button>
      </PageHeader>

      {msg === 'success' && <Alert type="success">Saved!</Alert>}
      {msg && msg !== 'success' && <Alert type="error">{msg}</Alert>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {users.map(u => {
          const active = u.is_active !== false;
          const storeColor = u.stores?.color;
          const storeName = u.stores?.name;
          return (
            <div key={u.id} className="bg-[var(--bg-elevated)] rounded-xl p-4 border border-[var(--border-subtle)]">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-[14px] font-bold
                  ${u.role === 'owner' ? 'bg-sw-blue text-black' : active ? 'bg-sw-blueD text-[var(--color-info)]' : 'bg-[var(--bg-card)] text-[var(--text-muted)]'}`}>
                  {u.name?.[0] || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[var(--text-primary)] text-[14px] font-bold truncate">{u.name}</div>
                  <div className="text-[var(--text-muted)] text-[10px] capitalize">{u.role}</div>
                </div>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase flex-shrink-0
                  ${active ? 'bg-sw-greenD text-[var(--color-success)]' : 'bg-sw-redD text-[var(--color-danger)]'}`}>
                  {active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="text-[11px] text-[var(--text-secondary)] mb-1 flex items-center gap-1.5">
                {storeColor && <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: storeColor }} />}
                <span className="truncate">{storeName || (u.role === 'owner' ? 'All stores' : '—')}</span>
              </div>
              <div className="text-[10px] text-[var(--text-muted)] mb-3 font-mono truncate">{u.username}</div>

              {/* Actions — hide on the current user and on owner rows */}
              {!isSelf(u) && (
                <div className="flex gap-1.5 flex-wrap">
                  <button
                    onClick={() => openEdit(u)}
                    className="flex-1 min-h-[34px] text-[11px] font-semibold rounded-md bg-sw-blueD text-[var(--color-info)] border border-sw-blue/30 px-2"
                  >
                    Edit
                  </button>
                  {active ? (
                    <button
                      onClick={() => setConfirmDeactivate(u)}
                      className="flex-1 min-h-[34px] text-[11px] font-semibold rounded-md bg-sw-amberD text-[var(--color-warning)] border border-sw-amber/30 px-2"
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      onClick={() => toggleActive(u, true)}
                      className="flex-1 min-h-[34px] text-[11px] font-semibold rounded-md bg-sw-greenD text-[var(--color-success)] border border-sw-green/30 px-2"
                    >
                      Reactivate
                    </button>
                  )}
                  <button
                    onClick={() => setConfirmDelete(u)}
                    className="flex-1 min-h-[34px] text-[11px] font-semibold rounded-md bg-sw-redD text-[var(--color-danger)] border border-sw-red/30 px-2"
                  >
                    Delete
                  </button>
                </div>
              )}
              {isSelf(u) && (
                <div className="text-[10px] text-[var(--text-muted)] italic">This is you — can't modify your own account here.</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add user modal */}
      {addModal && (
        <Modal title="Add User" onClose={() => setAddModal(false)}>
          <Field label="Name"><input value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })} /></Field>
          <Field label="Email"><input type="email" value={addForm.email} onChange={e => setAddForm({ ...addForm, email: e.target.value })} placeholder="user@7sstores.com" /></Field>
          <Field label="Password"><input type="password" value={addForm.password} onChange={e => setAddForm({ ...addForm, password: e.target.value })} /></Field>
          <Field label="Role">
            <select value={addForm.role} onChange={e => setAddForm({ ...addForm, role: e.target.value })}>
              <option value="employee">Employee (sales + inventory)</option>
              <option value="owner">Owner (full access)</option>
            </select>
          </Field>
          {addForm.role === 'employee' && (
            <Field label="Store">
              <select value={addForm.store_id} onChange={e => setAddForm({ ...addForm, store_id: e.target.value })}>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setAddModal(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={busy}>{busy ? 'Saving…' : 'Add'}</Button>
          </div>
        </Modal>
      )}

      {/* Edit user modal */}
      {editUser && (
        <Modal title={`Edit ${editUser.name}`} onClose={() => setEditUser(null)}>
          <Field label="Name"><input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} /></Field>
          <Field label="Email (read-only)"><input value={editUser.username || ''} readOnly disabled /></Field>
          {editUser.role === 'employee' && (
            <Field label="Assigned Store">
              <select value={editForm.store_id} onChange={e => setEditForm({ ...editForm, store_id: e.target.value })}>
                <option value="">None</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <div className="mb-3">
            {!showPassword ? (
              <button
                type="button"
                onClick={() => setShowPassword(true)}
                className="text-[var(--color-info)] text-[11px] font-semibold underline"
              >
                Reset password…
              </button>
            ) : (
              <Field label="New Password (min 6 chars)">
                <input
                  type="password"
                  value={editForm.password}
                  onChange={e => setEditForm({ ...editForm, password: e.target.value })}
                  autoFocus
                />
              </Field>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </Modal>
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${confirmDelete.name}?`}
          message={
            <>
              <div className="mb-1"><span className="text-[var(--text-secondary)]">Email: </span><span className="text-[var(--text-primary)] font-semibold">{confirmDelete.username}</span></div>
              {confirmDelete.stores?.name && <div className="mb-1"><span className="text-[var(--text-secondary)]">Store: </span><span className="text-[var(--text-primary)] font-semibold">{confirmDelete.stores.name}</span></div>}
              <div className="mb-3"><span className="text-[var(--text-secondary)]">Role: </span><span className="text-[var(--text-primary)] font-semibold capitalize">{confirmDelete.role}</span></div>
              <div className="text-[var(--color-danger)] text-[12px]">This will permanently remove the user from the database and cannot be undone.</div>
            </>
          }
          confirmLabel="Yes, Delete"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={handleDelete}
        />
      )}

      {/* Confirm deactivate */}
      {confirmDeactivate && (
        <ConfirmModal
          title={`Deactivate ${confirmDeactivate.name}?`}
          message={`They will be signed out immediately and blocked from logging in. You can reactivate them later.`}
          confirmLabel="Yes, Deactivate"
          confirmVariant="danger"
          onCancel={() => setConfirmDeactivate(null)}
          onConfirm={() => toggleActive(confirmDeactivate, false)}
        />
      )}
    </div>
  );
}
