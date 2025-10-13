'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

import { API_URL } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { getCreatorHandle } from '@/lib/creators';
import { getPlayUrl } from '@/lib/play';
import { auth } from '@/lib/firebase';
import { resolvePreviewUrl } from '@/lib/preview';
import Avatar from '@/components/Avatar';
import { useI18n } from '@/lib/i18n-provider';
import { useRelativeTime } from '@/hooks/useRelativeTime';

// Types
export type Listing = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  tags?: string[];
  visibility: 'public' | 'unlisted';
  playUrl: string;
  createdAt: number;
  author?: { uid?: string; name?: string; photo?: string; handle?: string };
  likesCount?: number;
  playsCount?: number;
  previewUrl?: string;
  likedByMe?: boolean;
  price?: number;
  // Optional UI flag to indicate current user is subscribed to this app
  isSubscribed?: boolean;
};

// Helpers
function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function timeSince(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(mo / 12);
  return `${y}y ago`;
}

// Component
export interface AppCardProps {
  item: Listing;
  viewMode: 'grid' | 'list';
  toggleLike?: (slug: string) => void;
  busy?: Record<string, boolean>;
  onDetails?: (item: Listing) => void;
  priority?: boolean;
}

const AppCard = React.memo(
  ({
    item,
    viewMode,
    toggleLike,
    busy = {},
    onDetails,
    priority = false,
  }: AppCardProps) => {
    const router = useRouter();
    const { user } = useAuth();
    const { locale } = useI18n();
    const subscribedLabel = locale === 'hr' ? 'Pretplaćeno' : 'Subscribed';

    const imgSrc = resolvePreviewUrl(item.previewUrl);
    const hasPreview = Boolean(imgSrc);
    const newBadge = Date.now() - item.createdAt < 1000 * 60 * 60 * 24 * 7;
    const likedCount = item.likesCount || 0;
    const isHot = likedCount > 100;
    const imgProps = priority ? { priority: true, loading: 'eager' as const } : {};

    const goToDetails = () => router.push(`/app?slug=${encodeURIComponent(item.slug)}`);
    const onKey = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') goToDetails();
    };

    const handlePlayClick = async (e: React.MouseEvent) => {
      e.stopPropagation();
      const activeUser = user ?? auth?.currentUser ?? null;
      const isOwner = !!activeUser?.uid && !!item.author?.uid && activeUser.uid === item.author.uid;

      const openInNewTab = (url: string) => {
        if (typeof window !== 'undefined') {
          window.open(url, '_blank', 'noopener,noreferrer');
        } else {
          router.push(url);
        }
      };

      if (typeof item.price === 'number' && item.price > 0 && !isOwner) {
        openInNewTab(`/paywall?slug=${encodeURIComponent(item.slug)}`);
        return;
      }

      const dest = await getPlayUrl(item.id);

      if (!activeUser?.uid) {
        openInNewTab(`/login?next=${encodeURIComponent(dest)}`);
      } else {
        openInNewTab(dest);
      }
    };

    const activeUid = user?.uid || auth?.currentUser?.uid || null;
    const isCreator = !!activeUid && !!item.author?.uid && activeUid === item.author.uid;
    const relativeCreated = useRelativeTime(item.createdAt, timeSince);

    const handleDetailsClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isCreator || !onDetails) {
        goToDetails();
      } else {
        onDetails(item);
      }
    };

    const AuthorLink = () => {
      const [handle, setHandle] = useState<string | undefined>(item.author?.handle);

      useEffect(() => {
        if (item.author?.handle) {
          setHandle(item.author.handle);
          return;
        }
        let cancelled = false;
        if (item.author?.uid) {
          getCreatorHandle(item.author.uid).then((h) => {
            if (!cancelled && h) setHandle(h);
          });
        }
        return () => {
          cancelled = true;
        };
      }, [item.author?.handle, item.author?.uid]);

      const href = handle ? `/u/${handle}` : undefined;
      const Inner = (
        <>
          {item.author?.photo && (
            <Avatar
              uid={item.author.uid}
              src={item.author.photo}
              name={item.author.name}
              size={viewMode === 'list' ? 20 : 28}
              className={viewMode === 'grid' ? 'ring-1 ring-gray-200' : ''}
            />
          )}
          {handle ? `@${handle}` : item.author?.name ?? 'Anonymous'}
        </>
      );
      if (!href) {
        return (
          <span
            className="flex items-center gap-1 text-sm text-gray-500"
            title={item.author?.name ? `Author: ${item.author.name}` : 'Author'}
          >
            {Inner}
          </span>
        );
      }
      return (
        <Link
          href={href}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 text-sm text-gray-500 hover:underline"
          title={item.author?.name ? `Author: ${item.author.name}` : 'Author profile'}
        >
          {Inner}
        </Link>
      );
    };

    if (viewMode === 'list') {
      return (
        <article
          role="link"
          tabIndex={0}
          onClick={goToDetails}
          onKeyDown={onKey}
          className="group bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-all duration-300 cursor-pointer flex items-center gap-4 p-4"
          aria-label={`Open details for ${item.title}`}
        >
          <div className="relative flex-shrink-0 w-32 h-32 rounded-xl overflow-hidden">
            {hasPreview ? (
              <Image
                src={imgSrc}
                alt={item.title}
                fill
                style={{ color: 'transparent' }}
                className="object-cover transition-transform duration-300 group-hover:scale-105"
                {...imgProps}
              />
            ) : (
              <div className="w-full h-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs font-medium">
                Bez grafike
              </div>
            )}
            {newBadge && (
              <span className="absolute top-2 left-2 rounded-full bg-emerald-500 text-white text-xs font-medium px-2 py-0.5">NEW</span>
            )}
            {isHot && (
              <span className="absolute top-2 right-2 rounded-full bg-orange-500 text-white text-xs font-medium px-2 py-0.5">HOT</span>
            )}
          </div>
          <div className="flex-1 flex flex-col justify-between">
            <div>
              <AuthorLink />
              <h2 className="mt-1 text-xl font-semibold text-gray-900 group-hover:text-emerald-600 transition">{item.title}
                {item.isSubscribed && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">Subscribed</span>
                )}
              </h2>
              {item.description && (
                <p className="mt-1 text-sm text-gray-500 line-clamp-3 break-words">{item.description}</p>
              )}
            </div>
            <div className="mt-3 sm:hidden flex items-center gap-2">
              <button
                onClick={handlePlayClick}
                className="flex-1 px-3 py-2 rounded-md bg-emerald-600 text-white font-medium text-center hover:bg-emerald-700"
              >
                Play
              </button>
              <button
                onClick={handleDetailsClick}
                className="flex-1 px-3 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Details
              </button>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
              <span>{relativeCreated || ''}</span>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {item.playsCount ?? 0}
                </span>
                <div className="hidden sm:flex items-center gap-2">
                  <button
                    onClick={handlePlayClick}
                    className="px-3 py-1.5 rounded-md bg-emerald-600 text-white font-medium hover:bg-emerald-700"
                  >
                    Play
                  </button>
                  <button
                    onClick={handleDetailsClick}
                    className="px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Details
                  </button>
                </div>
                <button
                  id={`like-${item.slug}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLike?.(item.slug);
                  }}
                  className={cn(
                    'flex items-center gap-1 text-sm',
                    item.likedByMe ? 'text-red-500' : 'text-gray-400',
                    (busy[item.slug] || !toggleLike) && 'opacity-50 cursor-not-allowed'
                  )}
                  disabled={busy[item.slug] || !toggleLike}
                  aria-label={item.likedByMe ? 'Unlike' : 'Like'}
                >
                  <svg className="w-4 h-4" fill={item.likedByMe ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                  {likedCount}
                </button>
              </div>
            </div>
            {!!item.tags?.length && (
              <div className="mt-2 flex flex-wrap gap-1">
                {item.tags.slice(0, 3).map((t) => (
                  <span key={t} className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">#{t}</span>
                ))}
                {item.tags.length > 3 && <span className="text-xs text-gray-400">+{item.tags.length - 3}</span>}
              </div>
            )}
          </div>
        </article>
      );
    }

    return (
      <article
        role="link"
        tabIndex={0}
        onClick={goToDetails}
        onKeyDown={onKey}
        className={cn(
          'group bg-white rounded-2xl overflow-hidden flex flex-col transition-all duration-300 hover:shadow-md cursor-pointer animate-fadeIn',
          item.isSubscribed ? 'border border-emerald-300 ring-1 ring-emerald-200' : 'border border-gray-200'
        )}
        aria-label={`Open details for ${item.title}`}
      >
        <div className="relative aspect-video">
          {hasPreview ? (
            <Image
              src={imgSrc}
              alt={item.title}
              fill
              style={{ color: 'transparent' }}
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              {...imgProps}
            />
          ) : (
            <div className="w-full h-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs font-medium">
              Bez grafike
            </div>
          )}
          {/* Price/Free badge */}
          <div className="absolute top-2 left-2">
            <span className="rounded-full bg-gray-900/90 text-white text-xs font-semibold px-2 py-0.5 shadow">
              {typeof item.price === 'number' && item.price > 0
                ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.price) + '/mo'
                : 'FREE'}
            </span>
          </div>
          <div className="absolute top-2 right-2 flex gap-1">
            {newBadge && (
              <span className="rounded-full bg-emerald-500 text-white text-xs font-medium px-2 py-0.5">NEW</span>
            )}
            {isHot && (
              <span className="rounded-full bg-orange-500 text-white text-xs font-medium px-2 py-0.5">HOT</span>
            )}
          </div>
          {item.isSubscribed && (
            <div className="absolute bottom-2 left-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/95 text-white text-xs font-semibold px-2 py-0.5 shadow">
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 0 1 0 1.414l-7.5 7.5a1 1 0 0 1-1.414 0l-3-3a1 1 0 1 1 1.414-1.414L8.5 12.086l6.793-6.793a1 1 0 0 1 1.414 0Z" clipRule="evenodd" /></svg>
                {subscribedLabel}
              </span>
            </div>
          )}
        </div>
        <div className="p-4 flex flex-col flex-1">
          <AuthorLink />
          <h2 className="mt-1 text-xl font-semibold text-gray-900 group-hover:text-emerald-600 transition line-clamp-1">{item.title}
            {item.isSubscribed && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">{subscribedLabel}</span>
            )}
          </h2>
          {item.description && (
            <p className="mt-1 text-sm text-gray-500 line-clamp-3 break-words">{item.description}</p>
          )}
          {!!item.tags?.length && (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.tags.slice(0, 4).map((t) => (
                <span key={t} className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">#{t}</span>
              ))}
              {item.tags.length > 4 && <span className="text-xs text-gray-400">+{item.tags.length - 4}</span>}
            </div>
          )}
          <div className="mt-auto pt-4 flex items-center justify-between text-sm text-gray-500">
            <span>{relativeCreated || ''}</span>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {item.playsCount ?? 0}
              </span>
              <div className="hidden sm:flex items-center gap-2">
                <button
                  onClick={handlePlayClick}
                  className="px-3 py-1.5 rounded-md bg-emerald-600 text-white font-medium hover:bg-emerald-700"
                >
                  Play
                </button>
                <button
                  onClick={handleDetailsClick}
                  className="px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Details
                </button>
              </div>
              <button
                id={`like-${item.slug}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLike?.(item.slug);
                }}
                className={cn(
                  'flex items-center gap-1 text-sm',
                  item.likedByMe ? 'text-red-500' : 'text-gray-400',
                  (busy[item.slug] || !toggleLike) && 'opacity-50 cursor-not-allowed'
                )}
                disabled={busy[item.slug] || !toggleLike}
                aria-label={item.likedByMe ? 'Unlike' : 'Like'}
              >
                <svg className="w-4 h-4" fill={item.likedByMe ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                {likedCount}
              </button>
            </div>
          </div>
          <div className="mt-3 sm:hidden flex items-center gap-2">
            <button
              onClick={handlePlayClick}
              className="flex-1 px-3 py-2 rounded-md bg-emerald-600 text-white font-medium text-center hover:bg-emerald-700"
            >
              Play
            </button>
            <button
              onClick={handleDetailsClick}
              className="flex-1 px-3 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Details
            </button>
          </div>
        </div>
      </article>
    );
  }
);

AppCard.displayName = 'AppCard';

export default AppCard;

