import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from '../components/LoginPage';
import { AuthProvider } from '../contexts/AuthContext';

vi.mock('../api/auth.js', () => ({
  login: vi.fn(),
  register: vi.fn(),
  // AuthContext hydrates mustChangePassword from /me on token restore
  fetchMe: vi.fn().mockResolvedValue({ userId: 'id', email: 'user@example.com', mustChangePassword: false }),
}));

vi.mock('../auth/keycloak.js', () => ({
  isKeycloakEnabled: () => false,
  redirectToKeycloak: vi.fn(),
}));

import * as authApi from '../api/auth.js';

function renderLoginPage() {
  return render(
    <AuthProvider>
      <LoginPage />
    </AuthProvider>,
  );
}

function makeToken(email: string) {
  return `h.${btoa(JSON.stringify({ userId: 'id', email, role: 'user' }))}.s`;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('LoginPage', () => {
  it('renders email and password inputs', () => {
    const { container } = renderLoginPage();
    expect(container.querySelector('input[type="email"]')).toBeInTheDocument();
    expect(container.querySelector('input[type="password"]')).toBeInTheDocument();
  });

  it('renders sign in button by default', () => {
    renderLoginPage();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('switches to register mode when Register is clicked', () => {
    renderLoginPage();
    fireEvent.click(screen.getByRole('button', { name: /register/i }));
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('calls login with entered credentials on submit', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      token: makeToken('user@example.com'),
      user: { id: 'uid', email: 'user@example.com', role: 'user' },
    } as never);

    const { container } = renderLoginPage();

    fireEvent.change(container.querySelector('input[type="email"]')!, {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(container.querySelector('input[type="password"]')!, {
      target: { value: 'password123' },
    });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => {
      expect(authApi.login).toHaveBeenCalledWith('user@example.com', 'password123');
    });
  });

  it('displays API error message on failed login', async () => {
    vi.mocked(authApi.login).mockRejectedValue({
      response: { data: { error: 'Invalid email or password' } },
    });

    const { container } = renderLoginPage();

    fireEvent.change(container.querySelector('input[type="email"]')!, {
      target: { value: 'bad@example.com' },
    });
    fireEvent.change(container.querySelector('input[type="password"]')!, {
      target: { value: 'wrongpass' },
    });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => {
      expect(screen.getByText('Invalid email or password')).toBeInTheDocument();
    });
  });

  it('calls register when in register mode', async () => {
    vi.mocked(authApi.register).mockResolvedValue({
      token: makeToken('new@example.com'),
      user: { id: 'uid2', email: 'new@example.com', role: 'admin' },
    } as never);

    const { container } = renderLoginPage();

    // Switch to register mode
    fireEvent.click(screen.getByRole('button', { name: /register/i }));

    fireEvent.change(container.querySelector('input[type="email"]')!, {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(container.querySelector('input[type="password"]')!, {
      target: { value: 'newpassword123' },
    });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => {
      expect(authApi.register).toHaveBeenCalledWith('new@example.com', 'newpassword123');
    });
  });

  it('shows fallback error when API gives no message', async () => {
    vi.mocked(authApi.login).mockRejectedValue(new Error('Network error'));

    const { container } = renderLoginPage();
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
  });
});
