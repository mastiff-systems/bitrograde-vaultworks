import { useEffect, useState } from 'react';
import { fetchUsers, updateUserRole } from '../../api/admin.js';
import type { AdminUser } from '../../api/admin.js';
import { useAuth } from '../../contexts/AuthContext.js';

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function AdminUsers() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers().then(setUsers).catch(() => setError('Failed to load users.')).finally(() => setLoading(false));
  }, []);

  const handleRoleToggle = async (u: AdminUser) => {
    const newRole = u.role === 'admin' ? 'user' : 'admin';
    setUpdatingId(u.id);
    try {
      const updated = await updateUserRole(u.id, newRole);
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Failed to update role.');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="flex-1 p-8">
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">{users.length} registered account{users.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-6 h-6 border-2 border-surface-4 border-t-accent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Joined</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-semibold text-accent-light">
                          {u.email[0].toUpperCase()}
                        </span>
                      </div>
                      <span className="text-content-primary font-medium">
                        {u.email}
                        {u.id === currentUser?.userId && (
                          <span className="ml-2 text-[10px] text-content-muted">(you)</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${u.role === 'admin' ? 'bg-accent/15 text-accent-light' : 'bg-surface-4 text-content-secondary'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td>{formatDate(u.created_at)}</td>
                  <td>
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleRoleToggle(u)}
                        disabled={updatingId === u.id || u.id === currentUser?.userId}
                        className="btn-secondary btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {updatingId === u.id ? (
                          <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                        ) : u.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
