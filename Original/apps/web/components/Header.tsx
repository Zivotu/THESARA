'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth, getDisplayName } from '@/lib/auth';
import Avatar from '@/components/Avatar';
import Logo from '@/components/Logo';
import { triggerConfetti } from '@/components/Confetti';
import { getListingCount } from '@/lib/listings';
import { useI18n } from '@/lib/i18n-provider';
import LocaleSwitcher from '@/components/LocaleSwitcher';

export default function Header() {
  const { messages } = useI18n();
  const tNav = (k: string) => messages[`Nav.${k}`] || k;
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const { user } = useAuth();
  const name = getDisplayName(user);
  const [hasApps, setHasApps] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      let adminClaim = false;
      if (user) {
        try {
          const tok = await auth?.currentUser?.getIdTokenResult();
          adminClaim =
            !!tok?.claims?.admin ||
            tok?.claims?.role === 'admin' ||
            !!tok?.claims?.isAdmin;
        } catch {
          adminClaim = false;
        }
      }
      if (!cancelled) setIsAdmin(adminClaim);
    };
    check();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user?.uid) {
      setHasApps(false);
      return;
    }
    let active = true;
    const refresh = async () => {
      try {
        const count = await getListingCount(user.uid);
        if (active) setHasApps(count > 0);
      } catch (e) {
        console.error('Failed to fetch listing count', e);
      }
    };
    refresh();
    const events = ['app-created', 'app-deleted', 'listing-created', 'listing-deleted'];
    const handler = () => refresh();
    events.forEach((ev) => window.addEventListener(ev, handler));
    return () => {
      active = false;
      events.forEach((ev) => window.removeEventListener(ev, handler));
    };
  }, [user]);

  const handlePublishClick = useCallback(() => {
    triggerConfetti();
    router.push('/create');
  }, [router]);

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-100 shadow-sm">
      <div className="max-w-screen-2xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <Logo />
          <nav className="hidden md:flex items-center gap-3">
            <LocaleSwitcher />
            {pathname === '/create' ? (
              <span className="px-4 py-2 rounded-lg bg-emerald-500 text-white font-medium">{tNav('publishApp')}</span>
            ) : (
              <Link
                href="/create"
                onClick={handlePublishClick}
                className="px-4 py-2 rounded-lg bg-emerald-500 text-white font-medium transition hover:bg-emerald-600"
                title="Publish new app"
              >
                {tNav('publishApp')}
              </Link>
            )}
            {pathname === '/my' ? (
              <span className="px-4 py-2 rounded-lg bg-gray-200 text-gray-900 font-medium">{tNav('myProjects')}</span>
            ) : (
              <Link
                href="/my"
                className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition font-medium"
                title="My projects"
              >
                {tNav('myProjects')}
              </Link>
            )}
            {user &&
              (pathname === '/my-creators' ? (
                <span className="px-4 py-2 rounded-lg bg-gray-200 text-gray-900 font-medium">{tNav('myCreators')}</span>
              ) : (
                <Link
                  href="/my-creators"
                  className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition font-medium"
                  title="My creators"
                >
                  {tNav('myCreators')}
                </Link>
              ))}

            {user &&
              (pathname === '/pro-apps' ? (
                <span className="px-4 py-2 rounded-lg bg-gray-200 text-gray-900 font-medium">{tNav('proApps')}</span>
              ) : (
                <Link
                  href="/pro-apps"
                  className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition font-medium"
                  title="Pro Apps"
                >
                  {tNav('proApps')}
                </Link>
              ))}
            {hasApps &&
              (pathname === '/pro' ? (
                <span className="px-4 py-2 rounded-lg bg-gray-200 text-gray-900 font-medium">{tNav('goPro')}</span>
              ) : (
                <Link
                  href="/pro"
                  className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition font-medium"
                  title="Go Pro"
                >
                  {tNav('goPro')}
                </Link>
              ))}
            {pathname === '/faq' ? (
              <span className="px-4 py-2 rounded-lg bg-gray-200 text-gray-900 font-medium">{tNav('faq')}</span>
            ) : (
              <Link
                href="/faq"
                className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition font-medium"
                title="FAQ"
              >
                {tNav('faq')}
              </Link>
            )}
            {isAdmin &&
              (pathname.startsWith('/admin') ? (
                <span className="px-4 py-2 rounded-lg bg-gray-200 text-gray-900 font-medium">{tNav('admin') || 'Admin'}</span>
              ) : (
                <Link
                  href="/admin"
                  className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition font-medium"
                  title="Admin dashboard"
                >
                  {tNav('admin') || 'Admin'}
                </Link>
              ))}
            {user ? (
              <div className="flex items-center gap-3 ml-2">
                <button
                  onClick={() => auth && signOut(auth)}
                  className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 transition font-medium"
                >
                  {tNav('logout')}
                </button>
                {pathname === '/profile' ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-200">
                    <Avatar
                      uid={user.uid}
                      src={user.photoURL ?? undefined}
                      name={name}
                      size={28}
                      className="ring-1 ring-gray-200"
                    />
                    <span className="hidden lg:block text-sm font-medium text-gray-900">{name}</span>
                  </div>
                ) : (
                  <Link
                    href="/profile"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition"
                    title="My profile"
                  >
                    <Avatar
                      uid={user.uid}
                      src={user.photoURL ?? undefined}
                      name={name}
                      size={28}
                      className="ring-1 ring-gray-200"
                    />
                    <span className="hidden lg:block text-sm font-medium text-gray-900">{name}</span>
                  </Link>
                )}
              </div>
            ) : (
              <Link
                href="/login"
                className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition font-medium"
                title="Sign in"
              >
                {tNav('login')}
              </Link>
            )}
          </nav>
          <button
            className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition"
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            aria-label="Toggle menu"
          >
            <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={showMobileMenu ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
            </svg>
          </button>
        </div>
        {showMobileMenu && (
          <nav className="md:hidden mt-4 pb-3 space-y-2 border-t pt-3">
            {pathname === '/create' ? (
              <span className="block px-4 py-2 rounded-lg bg-emerald-500 text-white font-medium text-center">
                {tNav('publishApp')}
              </span>
            ) : (
              <Link
                href="/create"
                onClick={handlePublishClick}
                className="block px-4 py-2 rounded-lg bg-emerald-500 text-white font-medium text-center"
                title="Publish new app"
              >
                {tNav('publishApp')}
              </Link>
            )}
            {pathname === '/my' ? (
              <span className="block px-4 py-2 rounded-lg text-gray-900 text-center bg-gray-200">
                {tNav('myProjects')}
              </span>
            ) : (
              <Link href="/my" className="block px-4 py-2 rounded-lg text-gray-600 text-center" title="My projects">
                {tNav('myProjects')}
              </Link>
            )}
              {user &&
                (pathname === '/my-creators' ? (
                  <span className="block px-4 py-2 rounded-lg text-gray-900 text-center bg-gray-200">{tNav('myCreators')}</span>
                ) : (
                  <Link
                    href="/my-creators"
                    className="block px-4 py-2 rounded-lg text-gray-600 text-center"
                    title="My creators"
                  >
                    {tNav('myCreators')}
                  </Link>
                ))}

              {user &&
                (pathname === '/pro-apps' ? (
                  <span className="block px-4 py-2 rounded-lg text-gray-900 text-center bg-gray-200">{tNav('proApps')}</span>
                ) : (
                  <Link
                    href="/pro-apps"
                    className="block px-4 py-2 rounded-lg text-gray-600 text-center"
                    title="Pro Apps"
                  >
                    {tNav('proApps')}
                  </Link>
                ))}
            {hasApps &&
              (pathname === '/pro' ? (
                <span className="block px-4 py-2 rounded-lg text-gray-900 text-center bg-gray-200">{tNav('goPro')}</span>
              ) : (
                <Link href="/pro" className="block px-4 py-2 rounded-lg text-gray-600 text-center" title="Go Pro">
                  {tNav('goPro')}
                </Link>
              ))}
            {pathname === '/faq' ? (
              <span className="block px-4 py-2 rounded-lg text-gray-900 text-center bg-gray-200">{tNav('faq')}</span>
            ) : (
              <Link href="/faq" className="block px-4 py-2 rounded-lg text-gray-600 text-center" title="FAQ">
                {tNav('faq')}
              </Link>
            )}
            {user ? (
              <>
                {pathname === '/profile' ? (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-200">
                    <Avatar uid={user.uid} src={user.photoURL ?? undefined} name={name} size={28} />
                    <span className="text-sm text-gray-900">{name}</span>
                  </div>
                ) : (
                  <Link
                    href="/profile"
                    className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-gray-100"
                    onClick={() => setShowMobileMenu(false)}
                    title="My profile"
                  >
                    <Avatar uid={user.uid} src={user.photoURL ?? undefined} name={name} size={28} />
                    <span className="text-sm text-gray-900">{name}</span>
                  </Link>
                )}
                <button
                  onClick={() => auth && signOut(auth)}
                  className="block w-full px-4 py-2 rounded-lg text-gray-600 text-center"
                >
                  {tNav('logout')}
                </button>
              </>
            ) : (
              <Link href="/login" className="block px-4 py-2 rounded-lg bg-gray-900 text-white text-center" title="Sign in">
                {tNav('login')}
              </Link>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}
