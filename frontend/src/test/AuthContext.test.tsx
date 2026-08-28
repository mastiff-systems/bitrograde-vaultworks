import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { PASSWORD_CHANGE_REQUIRED_EVENT } from '../api/passwordGate';

vi.mock('../api/auth.js', () => ({
  fetchMe: vi.fn(),
}));

import { fetchMe } from '../api/auth.js';
const mockFetchMe = vi.mocked(fetchMe);

function makeToken(email: string, role = 'user') {
  const payload = btoa(JSON.stringify({ userId: 'test-id', email, role }));
  return `header.${payload}.sig`;
}

function TestConsumer() {
  const { token, user, mustChangePassword, setAuth, clearMustChangePassword, logout } = useAuth();
  return (
    <div>
      <span data-testid="token">{token ?? 'no-token'}</span>
      <span data-testid="email">{user?.email ?? 'no-user'}</span>
      <span data-testid="role">{user?.role ?? 'no-role'}</span>
      <span data-testid="must-change">{String(mustChangePassword)}</span>
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
      <button
        onClick={() =>
          setAuth(
            makeToken('locked@example.com'),
            { userId: 'test-id', email: 'locked@example.com', role: 'user' },
            true,
          )
        }
      >
        login-locked
      </button>
      <button onClick={clearMustChangePassword}>clear-must-change</button>
      <button onClick={logout}>logout</button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchMe.mockResolvedValue({ userId: 'test-id', email: 'test@example.com', mustChangePassword: false });
});

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

describe('AuthContext mustChangePassword (MAS-626)', () => {
  it('defaults to false', () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    expect(screen.getByTestId('must-change').textContent).toBe('false');
  });

  it('setAuth carries the flag from the login response', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await act(async () => {
      screen.getByText('login-locked').click();
    });

    expect(screen.getByTestId('must-change').textContent).toBe('true');
  });

  it('clearMustChangePassword resets the flag after a successful password change', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await act(async () => {
      screen.getByText('login-locked').click();
    });
    await act(async () => {
      screen.getByText('clear-must-change').click();
    });

    expect(screen.getByTestId('must-change').textContent).toBe('false');
  });

  it('hydrates the flag from /api/auth/me on token restore (JWT does not carry it)', async () => {
    mockFetchMe.mockResolvedValue({ userId: 'test-id', email: 'stored@example.com', mustChangePassword: true });
    localStorage.setItem('vaultworks_token', makeToken('stored@example.com'));

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await act(async () => {});

    expect(mockFetchMe).toHaveBeenCalled();
    expect(screen.getByTestId('must-change').textContent).toBe('true');
  });

  it('flips the flag when an API interceptor reports a Password-change-required 403', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await act(async () => {
      screen.getByText('login').click();
    });
    expect(screen.getByTestId('must-change').textContent).toBe('false');

    await act(async () => {
      window.dispatchEvent(new Event(PASSWORD_CHANGE_REQUIRED_EVENT));
    });

    expect(screen.getByTestId('must-change').textContent).toBe('true');
  });

  it('logout resets the flag', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await act(async () => {
      screen.getByText('login-locked').click();
    });
    await act(async () => {
      screen.getByText('logout').click();
    });

    expect(screen.getByTestId('must-change').textContent).toBe('false');
  });
});
