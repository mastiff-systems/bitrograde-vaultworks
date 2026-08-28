import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';

function makeToken(email: string, role = 'user') {
  const payload = btoa(JSON.stringify({ userId: 'test-id', email, role }));
  return `header.${payload}.sig`;
}

function TestConsumer() {
  const { token, user, setAuth, logout } = useAuth();
  return (
    <div>
      <span data-testid="token">{token ?? 'no-token'}</span>
      <span data-testid="email">{user?.email ?? 'no-user'}</span>
      <span data-testid="role">{user?.role ?? 'no-role'}</span>
      <button
        onClick={() =>
          setAuth(makeToken('test@example.com'), {
            userId: 'test-id',
            email: 'test@example.com',
            role: 'user',
          })
        }
      >
        login
      </button>
      <button onClick={logout}>logout</button>
    </div>
  );
}

afterEach(() => {
  localStorage.clear();
});

describe('AuthContext', () => {
  it('starts with no token when localStorage is empty', () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    expect(screen.getByTestId('token').textContent).toBe('no-token');
    expect(screen.getByTestId('email').textContent).toBe('no-user');
  });

  it('setAuth persists token to localStorage', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await act(async () => {
      screen.getByText('login').click();
    });

    expect(localStorage.getItem('vaultworks_token')).toBeTruthy();
    expect(screen.getByTestId('email').textContent).toBe('test@example.com');
  });

  it('restores user state from stored token on mount', async () => {
    const token = makeToken('stored@example.com', 'admin');
    localStorage.setItem('vaultworks_token', token);

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    // Wait for the useEffect to parse the token
    await act(async () => {});

    expect(screen.getByTestId('email').textContent).toBe('stored@example.com');
    expect(screen.getByTestId('role').textContent).toBe('admin');
  });

  it('logout clears token and user', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await act(async () => {
      screen.getByText('login').click();
    });

    await act(async () => {
      screen.getByText('logout').click();
    });

    expect(screen.getByTestId('token').textContent).toBe('no-token');
    expect(screen.getByTestId('email').textContent).toBe('no-user');
    expect(localStorage.getItem('vaultworks_token')).toBeNull();
  });

  it('parses user from stored token on the very first render (MAS-615)', () => {
    // AdminRoute checks user.role synchronously; if the token is only parsed
    // in an effect, the first render sees user=null and redirects to /.
    localStorage.setItem('vaultworks_token', makeToken('admin@example.com', 'admin'));

    const rolesSeen: Array<string | undefined> = [];
    function Recorder() {
      const { user } = useAuth();
      rolesSeen.push(user?.role);
      return null;
    }

    render(
      <AuthProvider>
        <Recorder />
      </AuthProvider>,
    );

    expect(rolesSeen[0]).toBe('admin');
  });

  it('clears invalid token on mount', async () => {
    localStorage.setItem('vaultworks_token', 'not.valid.token.at.all');

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await act(async () => {});

    expect(screen.getByTestId('token').textContent).toBe('no-token');
    expect(localStorage.getItem('vaultworks_token')).toBeNull();
  });
});
