/**
 * MAS-736/MAS-741: AdminMenu header dropdown.
 *
 * The critical contract is the role gate: the trigger must be entirely absent
 * from the DOM for non-admins (not just visually hidden), and for admins the
 * dropdown must expose Settings, Users, and the build version label.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminMenu } from '../components/AdminMenu';

const mockUseAuth = vi.fn();

vi.mock('../contexts/AuthContext.js', () => ({
  useAuth: () => mockUseAuth(),
}));

function renderMenu(role: string | undefined) {
  mockUseAuth.mockReturnValue({ user: role ? { email: 'x@y.z', role } : null });
  return render(
    <MemoryRouter>
      <AdminMenu />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseAuth.mockReset();
});

describe('AdminMenu', () => {
  it('renders nothing at all for non-admin users', () => {
    const { container } = renderMenu('user');
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when logged out', () => {
    const { container } = renderMenu(undefined);
    expect(container.innerHTML).toBe('');
  });

  it('shows the trigger for admins, closed by default', () => {
    renderMenu('admin');
    const trigger = screen.getByRole('button', { name: 'Administration menu' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('opens with Administration header, version label, Settings and Users', () => {
    renderMenu('admin');
    fireEvent.click(screen.getByRole('button', { name: 'Administration menu' }));

    expect(screen.getByText('Administration')).toBeInTheDocument();
    expect(screen.getByText(`v${__APP_VERSION__}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Users' })).toBeInTheDocument();
  });
});
