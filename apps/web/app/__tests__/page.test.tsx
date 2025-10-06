import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import MarketplacePage from '../page';

vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
vi.mock('next/image', () => ({ default: (props: any) => <img {...props} /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/Avatar', () => ({ default: () => <div /> }));
vi.mock('@/components/Logo', () => ({ default: () => <div /> }));
vi.mock('@/components/Confetti', () => ({ triggerConfetti: () => {} }));
vi.mock('@/lib/config', () => ({ API_URL: '', SITE_NAME: '' }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: null }),
  getDisplayName: () => '',
}));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));

it('shows error details when API returns error', async () => {
  (global as any).fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 500,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  });
  render(<MarketplacePage />);
  expect(await screen.findByText('HTTP 500')).toBeInTheDocument();
});
