/**
 * MAS-778: header right-controls contract —
 *  - the slot between NotificationBell and ProfileDropdown holds the theme
 *    toggle (real ThemeProvider: verifies the data-theme flip end to end),
 *    replacing the old CollectionsButton
 *  - the profile dropdown is trimmed to My Profile + Logout (theme toggle
 *    moved out to the header)
 *
 * Auth/Category/Upload contexts and NotificationBell are mocked; ThemeProvider
 * is the real one so toggling exercises localStorage + <html data-theme>.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { ThemeProvider } from '../contexts/ThemeContext';

vi.mock('../contexts/AuthContext.js', () => ({
  useAuth: () => ({ user: { email: 'u@v.w', role: 'user' }, logout: vi.fn() }),
}));

vi.mock('../contexts/CategoryContext.js', () => ({
  useCategoryContext: () => ({
    categories: [],
    selectedCategoryId: null,
    selectedSubcategoryId: null,
    searchQuery: '',
    setSelectedCategoryId: vi.fn(),
    setSelectedSubcategoryId: vi.fn(),
    setSearchQuery: vi.fn(),
  }),
}));

vi.mock('../contexts/UploadContext.js', () => ({
  useUpload: () => ({ openWizard: vi.fn(), uploading: false, progress: 0 }),
}));

vi.mock('../components/NotificationBell.js', () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ThemeProvider>
        <Layout>content</Layout>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('Layout header theme toggle (MAS-778)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders the theme toggle in the header and no Collections icon', () => {
    renderLayout();
    // Default theme is dark → offers switching to light
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collections' })).not.toBeInTheDocument();
  });

  it('clicking the toggle flips the theme and the accessible label', () => {
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('vaultworks_theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });

  it('trims the profile dropdown to My Profile + Logout with no theme item', () => {
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: 'Profile menu' }));

    expect(screen.getByText('My Profile')).toBeInTheDocument();
    expect(screen.getByText('Logout')).toBeInTheDocument();
    expect(screen.queryByText(/light mode|dark mode/i)).not.toBeInTheDocument();
  });
});
