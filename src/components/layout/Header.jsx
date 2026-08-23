import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Clock3,
  Flame,
  Gamepad2,
  Grid3X3,
  LayoutGrid,
  LogOut,
  MessageSquareText,
  Settings as SettingsIcon,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react';
import DanausMark from './DanausMark';
import { formatBitcoinAddress } from '../../lib/displayPreferences';

const FeedControls = ({ networkMode, onNetworkModeChange, feedSort, onFeedSortChange }) => (
  <div className="flex w-full items-center gap-2 overflow-x-auto px-4 pb-2 md:w-auto md:gap-3 md:overflow-visible md:px-0 md:pb-0">
    <div className="flex shrink-0 rounded-full border border-white/[0.08] bg-white/[0.035] p-1">
      {[
        { id: 'classic', label: 'Classic', icon: MessageSquareText },
        { id: 'opinion', label: 'Opinion', icon: Flame },
      ].map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" onClick={() => onNetworkModeChange?.(id)} aria-label={label} aria-pressed={networkMode === id} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-bold transition md:px-3 ${networkMode === id ? 'bg-amber-300 text-slate-950' : 'text-white/40 hover:text-white'}`}>
          <Icon className="h-3.5 w-3.5" /> <span className={networkMode === id ? '' : 'hidden md:inline'}>{label}</span>
        </button>
      ))}
    </div>

    {networkMode === 'classic' && (
      <div className="flex shrink-0 rounded-full border border-white/[0.08] bg-white/[0.035] p-1">
        {[
          { id: 'for_you', label: 'For you', icon: Sparkles },
          { id: 'recent', label: 'Latest', icon: Clock3 },
          { id: 'followed', label: 'Followed', icon: Users },
        ].map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => onFeedSortChange?.(id)} aria-label={label} aria-pressed={feedSort === id} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold transition md:px-3 ${feedSort === id ? 'bg-white text-slate-950' : 'text-white/40 hover:text-white'}`}>
            <Icon className="h-3.5 w-3.5" /> <span className={feedSort === id ? '' : 'hidden md:inline'}>{label}</span>
          </button>
        ))}
      </div>
    )}
  </div>
);

const Header = ({
  connectedAddress,
  displayName,
  avatarUrl = '',
  onDisconnect,
  onViewProfile,
  onSettings,
  onHome,
  onOpenGame,
  onOpenCanvas,
  showNetworkNavigation = false,
  networkMode = 'classic',
  onNetworkModeChange,
  feedSort = 'for_you',
  onFeedSortChange,
  addressDisplay = 'shortened',
  minimal = false,
}) => {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [mobileHidden, setMobileHidden] = useState(false);
  const previousScroll = useRef(0);
  const userName = displayName || 'Danaus member';

  useEffect(() => {
    if (minimal) return undefined;
    previousScroll.current = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const current = Math.max(0, window.scrollY);
        const delta = current - previousScroll.current;
        if (current < 24 || delta < -5) setMobileHidden(false);
        else if (current > 110 && delta > 5 && !showCreateMenu && !showProfileMenu) setMobileHidden(true);
        previousScroll.current = current;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [minimal, showCreateMenu, showProfileMenu]);

  if (minimal) {
    return (
      <header className="relative z-30 mb-2 flex items-center justify-between px-1 py-4 sm:px-2">
        <button type="button" onClick={onHome} className="group flex items-center gap-2.5" aria-label="Back to Danaus introduction">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-300 text-black shadow-[0_0_32px_rgba(252,211,77,0.22)]"><DanausMark className="h-6 w-6 transition-transform duration-500 group-hover:-translate-y-0.5" /></span>
          <span className="text-xl font-black tracking-[-0.07em] text-white">danaus</span>
        </button>
        <button type="button" onClick={onHome} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/55 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white sm:px-4">
          <ArrowLeft className="h-3.5 w-3.5" /><span className="hidden sm:inline">Back to introduction</span><span className="sm:hidden">Back</span>
        </button>
      </header>
    );
  }

  return (
    <header className={`fixed inset-x-0 top-0 z-50 border-b border-white/[0.08] bg-[#07080c]/90 backdrop-blur-2xl transition-transform duration-300 ease-out md:translate-y-0 ${mobileHidden ? '-translate-y-[118px]' : 'translate-y-0'}`}>
      <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <button type="button" onClick={onHome} className="group flex shrink-0 items-center gap-2.5" aria-label="Danaus home">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-300 text-black shadow-[0_0_28px_rgba(252,211,77,0.2)]"><DanausMark className="h-6 w-6 transition-transform duration-500 group-hover:-translate-y-0.5" /></span>
          <span className="hidden text-xl font-black tracking-[-0.07em] text-white sm:block">danaus</span>
        </button>

        {showNetworkNavigation && (
          <div className="absolute inset-x-0 top-[68px] min-w-0 border-t border-white/[0.06] bg-[#07080c]/95 md:static md:border-0 md:bg-transparent">
            <FeedControls networkMode={networkMode} onNetworkModeChange={onNetworkModeChange} feedSort={feedSort} onFeedSortChange={onFeedSortChange} />
          </div>
        )}

        {connectedAddress && (
          <div className="flex shrink-0 items-center gap-2">
            {(onOpenGame || onOpenCanvas) && (
              <div className="relative">
                <button type="button" onClick={() => { setShowCreateMenu((visible) => !visible); setShowProfileMenu(false); }} aria-label="Open Danaus apps" aria-expanded={showCreateMenu} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.045] text-white/55 transition hover:border-amber-300/30 hover:bg-amber-300/10 hover:text-amber-300">
                  <LayoutGrid className={`h-5 w-5 transition ${showCreateMenu ? 'text-amber-300' : ''}`} />
                </button>
                {showCreateMenu && (
                  <div className="absolute right-0 mt-2 w-52 overflow-hidden rounded-2xl border border-white/10 bg-[#15171e] p-1.5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.5)]">
                    {onOpenGame && <button type="button" onClick={() => { setShowCreateMenu(false); onOpenGame(); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-white/65 transition hover:bg-white/[0.06] hover:text-white"><Gamepad2 className="h-4 w-4 text-amber-300" /> Game</button>}
                    {onOpenCanvas && <button type="button" onClick={() => { setShowCreateMenu(false); onOpenCanvas(); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-white/65 transition hover:bg-white/[0.06] hover:text-white"><Grid3X3 className="h-4 w-4 text-amber-300" /> Canvas</button>}
                  </div>
                )}
              </div>
            )}

            <div className="relative">
              <button type="button" onClick={() => { setShowProfileMenu((visible) => !visible); setShowCreateMenu(false); }} aria-expanded={showProfileMenu} aria-haspopup="menu" aria-label="Private session" className="grid h-10 w-10 place-items-center rounded-full text-white transition hover:-translate-y-0.5 hover:brightness-110">
                <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-amber-200 to-orange-500 text-slate-950 shadow-[0_0_22px_rgba(251,191,36,0.14)]">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={`${userName}'s profile`} className="h-full w-full object-cover" />
                  ) : (
                    <UserRound className="h-4 w-4" />
                  )}
                </span>
              </button>

              {showProfileMenu && (
                <div role="menu" className="absolute right-0 mt-2 w-72 overflow-hidden rounded-2xl border border-white/10 bg-[#15171e] text-white shadow-[0_24px_70px_rgba(0,0,0,0.5)]">
                  <div className="border-b border-white/[0.08] bg-white/[0.035] p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">Signed in as</p>
                    <p className="mt-2 truncate text-base font-black text-white">{userName}</p>
                    <p className="mt-2 break-all rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 font-mono text-xs text-white/55">{formatBitcoinAddress(connectedAddress, addressDisplay)}</p>
                  </div>
                  {onViewProfile && <button type="button" role="menuitem" onClick={() => { setShowProfileMenu(false); onViewProfile(); }} className="flex w-full items-center gap-3 border-b border-white/[0.06] px-4 py-3 text-left text-sm font-semibold text-white/70 transition hover:bg-white/[0.06] hover:text-white"><UserRound className="h-4 w-4 text-white/45" /> View my profile</button>}
                  {onSettings && <button type="button" role="menuitem" onClick={() => { setShowProfileMenu(false); onSettings(); }} className="group flex w-full items-center gap-3 border-b border-white/[0.06] px-4 py-3 text-left text-sm font-semibold text-white/70 transition hover:bg-white/[0.06] hover:text-white"><SettingsIcon className="h-4 w-4 text-white/45 transition-transform duration-300 group-hover:rotate-45" /> Settings</button>}
                  <button type="button" role="menuitem" onClick={() => { setShowProfileMenu(false); onDisconnect(); }} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-red-300 transition hover:bg-red-400/10"><LogOut className="h-4 w-4" /> Log out</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
