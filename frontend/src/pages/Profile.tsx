import { useAuth } from '../contexts/AuthContext.js';

export function ProfilePage() {
  const { user } = useAuth();

  return (
    <div className="flex-1 p-8">
      <div className="page-header">
        <div>
          <h1 className="page-title">Profile</h1>
          <p className="page-subtitle">Your account settings</p>
        </div>
      </div>

      <div className="max-w-xl">
        <div className="card p-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-full bg-accent/20 flex items-center justify-center">
              <span className="text-2xl font-bold text-accent-light">
                {user?.email?.[0]?.toUpperCase()}
              </span>
            </div>
            <div>
              <p className="font-semibold text-content-primary">{user?.email}</p>
              <span className="inline-block mt-1 px-2 py-0.5 text-xs rounded-full bg-surface-3 text-content-secondary capitalize">
                {user?.role}
              </span>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={user?.email ?? ''}
                readOnly
                aria-readonly="true"
              />
              <p className="text-xs text-content-muted mt-1">Email address cannot be changed here.</p>
            </div>

            <div>
              <label className="label">Role</label>
              <input
                type="text"
                className="input capitalize"
                value={user?.role ?? ''}
                readOnly
                aria-readonly="true"
              />
              <p className="text-xs text-content-muted mt-1">Roles are managed by an administrator.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
