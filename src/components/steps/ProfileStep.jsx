import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  Bitcoin,
  Copy,
  Ellipsis,
  ExternalLink,
  EyeOff,
  Flag,
  KeyRound,
  Link as LinkIcon,
  Lightbulb,
  MapPin,
  MessageSquare,
  Pencil,
  Repeat2,
  UserMinus,
  UserRound
} from 'lucide-react';
import MessageCard from '../social/MessageCard';
import ProfileConnectionsModal from '../profile/ProfileConnectionsModal';
import ProfileEditModal from '../profile/ProfileEditModal';
import { FeedSkeleton, ProfileSkeleton } from '../ui/ContentSkeletons';
import {
  getUserData,
  getPublicProfile,
  getProfileMessages,
  getUserStats,
} from '../../supabaseClient';
import {
  canShowBitcoinBalance,
  canShowShellBalance,
  formatBitcoinAddress,
  formatShellAmount,
} from '../../lib/displayPreferences';

const PAGE_SIZE = 25;

const safeDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (value) => {
  const date = safeDate(value);
  if (!date) return null;
  return date.toLocaleDateString('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

const EMPTY_TAB_MESSAGES = Object.freeze({ posts: [], replies: [], reposts: [], useful: [] });
const EMPTY_LOADED_TABS = Object.freeze({ posts: false, replies: false, reposts: false, useful: false });
const INITIAL_HAS_MORE = Object.freeze({ posts: true, replies: true, reposts: true, useful: true });

const ProfileStep = ({
  profileAddress,
  currentAddress,
  onBack,
  onOpenProfile,
  onToggleFollow,
  isFollowing,
  onShowStats,
  passwordConfigured = false,
  onAddPassword,
  addressDisplay = 'shortened',
  balanceDisplay = 'show_all',
  onEditorialPreference,
  onEditorialTopicPreference,
  onReportMessage,
  onReportProfile,
  onProfileUpdated,
  onBalanceUpdated,
  onPublishMessage,
  onLoadComments,
  onToggleUseful,
  onRepostMessage,
  onOpenThread,
}) => {
  const [profileUser, setProfileUser] = useState(null);
  const [profileStats, setProfileStats] = useState(null);
  const [tabMessages, setTabMessages] = useState({ ...EMPTY_TAB_MESSAGES });
  const [loadedTabs, setLoadedTabs] = useState({ ...EMPTY_LOADED_TABS });
  const [hasMoreByTab, setHasMoreByTab] = useState({ ...INITIAL_HAS_MORE });
  const [activeTab, setActiveTab] = useState('posts');
  const [loading, setLoading] = useState(true);
  const [loadingTab, setLoadingTab] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showEditorialMenu, setShowEditorialMenu] = useState(false);
  const [editorialAction, setEditorialAction] = useState('');
  const [editorialNotice, setEditorialNotice] = useState('');
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [connectionsRelation, setConnectionsRelation] = useState('');
  const [followersAdjustment, setFollowersAdjustment] = useState(0);
  const [showSpent, setShowSpent] = useState(false);

  const handleProfileBalanceUpdated = useCallback((balance) => {
    onBalanceUpdated?.(balance);
    if (!balance) return;
    const nextShellBalance = balance.new_balance ?? balance.shells_balance ?? balance.user?.shells_balance;
    const nextSpentTotal = balance.shells_spent_total ?? balance.user?.shells_spent_total;
    if (nextShellBalance !== undefined) {
      setProfileStats((current) => ({
        ...(current || {}),
        shells_available: Number(nextShellBalance) || 0,
        ...(nextSpentTotal !== undefined ? { shells_spent_total: Number(nextSpentTotal) || 0 } : {}),
      }));
      setProfileUser((current) => current ? {
        ...current,
        shells_balance: Number(nextShellBalance) || 0,
        ...(nextSpentTotal !== undefined ? { shells_spent_total: Number(nextSpentTotal) || 0 } : {}),
      } : current);
    }
  }, [onBalanceUpdated]);

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      if (!profileAddress) return;

      setLoading(true);
      setError('');
      setCopied(false);
      setTabMessages({ ...EMPTY_TAB_MESSAGES });
      setLoadedTabs({ ...EMPTY_LOADED_TABS });
      setHasMoreByTab({ ...INITIAL_HAS_MORE });
      setActiveTab('posts');
      setShowEditProfile(false);
      setConnectionsRelation('');
      setFollowersAdjustment(0);

      try {
        const isOwner = profileAddress === currentAddress;
        const [user, stats, initialMessages] = await Promise.all([
          isOwner ? getUserData(profileAddress) : getPublicProfile(profileAddress),
          isOwner ? getUserStats(profileAddress).catch(() => null) : Promise.resolve(null),
          getProfileMessages(currentAddress, profileAddress, 'posts', PAGE_SIZE, 0),
        ]);

        if (cancelled) return;

        setProfileUser(user);
        setProfileStats(stats);
        const initialPosts = initialMessages?.messages || [];
        setTabMessages((current) => ({ ...current, posts: initialPosts }));
        setLoadedTabs((current) => ({ ...current, posts: true }));
        setHasMoreByTab((current) => ({ ...current, posts: initialPosts.length === PAGE_SIZE }));
        handleProfileBalanceUpdated(initialMessages);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Unable to load this profile');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, [currentAddress, handleProfileBalanceUpdated, profileAddress]);

  useEffect(() => {
    if (loading || loadedTabs[activeTab] || !profileAddress || !currentAddress) return undefined;
    let cancelled = false;
    setLoadingTab(true);
    setError('');
    getProfileMessages(currentAddress, profileAddress, activeTab, PAGE_SIZE, 0)
      .then((result) => {
        if (cancelled) return;
        const nextMessages = Array.isArray(result?.messages) ? result.messages : [];
        setTabMessages((current) => ({ ...current, [activeTab]: nextMessages }));
        setLoadedTabs((current) => ({ ...current, [activeTab]: true }));
        setHasMoreByTab((current) => ({ ...current, [activeTab]: nextMessages.length === PAGE_SIZE }));
        handleProfileBalanceUpdated(result);
      })
      .catch((loadError) => !cancelled && setError(loadError.message || 'Unable to load this profile section'))
      .finally(() => !cancelled && setLoadingTab(false));
    return () => { cancelled = true; };
  }, [activeTab, currentAddress, handleProfileBalanceUpdated, loadedTabs, loading, profileAddress]);

  const isOwnProfile = profileAddress && currentAddress && profileAddress === currentAddress;
  const handleProfileFollow = async () => {
    if (!onToggleFollow) return;
    const wasFollowing = followingProfile;
    await onToggleFollow(profileAddress);
    setFollowersAdjustment((current) => current + (wasFollowing ? -1 : 1));
  };

  const handleProfileSaved = (savedProfile) => {
    setProfileUser((current) => ({
      ...current,
      display_name: savedProfile.display_name,
      profile: { ...(current?.profile || {}), ...savedProfile },
    }));
    setShowEditProfile(false);
    onProfileUpdated?.(savedProfile);
  };

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(profileAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      setError('Unable to copy the address');
    }
  };

  const handleEditorialPreference = async (targetAddress, preference) => {
    if (!onEditorialPreference || !targetAddress || editorialAction) return null;
    if (preference === 'block' && !window.confirm(
      'Block this account? Its posts will disappear from your feeds and interactions between both accounts will be disabled.'
    )) return null;

    setEditorialAction(preference);
    setError('');
    setEditorialNotice('');
    try {
      const result = await onEditorialPreference(targetAddress, preference);
      setShowEditorialMenu(false);
      setEditorialNotice({
        reduce: 'You will see fewer posts from this author.',
        mute: 'This author is now hidden from your feeds.',
        block: 'This account is now blocked.',
      }[preference] || 'Your preference was updated.');
      return result;
    } catch (actionError) {
      setError(actionError.message || 'This preference could not be saved.');
      return null;
    } finally {
      setEditorialAction('');
    }
  };

  const handleReportProfile = async () => {
    if (!onReportProfile || editorialAction) return;
    setEditorialAction('report-profile');
    setError('');
    setEditorialNotice('');
    try {
      const result = await onReportProfile(profileAddress);
      setShowEditorialMenu(false);
      setEditorialNotice(result?.created
        ? 'Profile report recorded. Thank you.'
        : 'You already reported this profile.');
    } catch (actionError) {
      setError(actionError.message || 'This profile could not be reported.');
    } finally {
      setEditorialAction('');
    }
  };

  const handleReportMessage = async (messageId) => {
    if (!onReportMessage) return null;
    const result = await onReportMessage(messageId);
    setEditorialNotice(result?.created
      ? 'Post report recorded. Thank you.'
      : 'You already reported this post.');
    return result;
  };

  const handleComment = async (messageId, commentText, onSuccess) => {
    const result = await onPublishMessage?.(commentText.trim(), messageId);
    if (result && result.success !== false) onSuccess?.(result.message || null);
    return result;
  };

  const handleEditorialTopicPreference = async (messageId, preference) => {
    if (!onEditorialTopicPreference) return null;
    const result = await onEditorialTopicPreference(messageId, preference);
    setEditorialNotice('You will see fewer posts related to this topic.');
    return result;
  };

  const loadMore = async () => {
    if (!hasMoreByTab[activeTab] || loadingMore) return;

    setLoadingMore(true);
    setError('');

    try {
      const result = await getProfileMessages(
        currentAddress,
        profileAddress,
        activeTab,
        PAGE_SIZE,
        tabMessages[activeTab].length,
      );
      const nextMessages = Array.isArray(result?.messages) ? result.messages : [];
      handleProfileBalanceUpdated(result);
      setTabMessages((current) => ({
        ...current,
        [activeTab]: [...current[activeTab], ...nextMessages],
      }));
      setHasMoreByTab((current) => ({ ...current, [activeTab]: nextMessages.length === PAGE_SIZE }));
    } catch (err) {
      setError(err.message || 'Unable to load more messages');
    } finally {
      setLoadingMore(false);
    }
  };

  const currentMessages = (tabMessages[activeTab] || [])
    .filter(Boolean)
    .map((message) => ({ ...message, bitcoin_address: message.bitcoin_address || profileAddress }));
  const currentHasMore = hasMoreByTab[activeTab];

  const displayName =
    profileUser?.profile?.display_name ||
    profileUser?.display_name ||
    profileUser?.username ||
    profileUser?.handle ||
    profileUser?.nickname ||
    '';

  const profile = profileUser?.profile || profileUser || {};
  const bio = profile.bio || '';
  const location = profile.location || '';
  const websiteUrl = profile.website_url || '';
  const avatarUrl = profile.avatar_url || '';
  const coverUrl = profile.cover_url || '';

  const avatarSeed = profileAddress || '';
  const avatarPalette = [
    'from-orange-500 to-amber-500',
    'from-blue-500 to-cyan-400',
    'from-emerald-500 to-lime-400',
    'from-rose-500 to-pink-400',
    'from-slate-700 to-slate-500'
  ];
  const avatarClass = avatarPalette[
    avatarSeed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % avatarPalette.length
  ];

  const verified = Boolean(profileUser?.ownership_verified || profileUser?.ownership_verified_at);
  const verifiedAt = formatDate(profileUser?.ownership_verified_at || profileUser?.created_at);

  const btcBalance = profileStats?.btc_balance ?? profileUser?.btc_balance ?? 0;
  const shellsAvailable = profileStats?.shells_available ?? profileUser?.shells_balance ?? 0;
  const shellsSpentTotal = profileStats?.shells_spent_total ?? profileUser?.shells_spent_total ?? 0;
  const showBitcoinBalance = canShowBitcoinBalance(balanceDisplay);
  const showShellBalance = canShowShellBalance(balanceDisplay);
  const totalShellCapacity = Math.max(0, Math.round(Number(btcBalance || 0) * 100000000));
  const availablePercent = totalShellCapacity > 0
    ? Math.max(0, Math.min(100, Number(shellsAvailable || 0) / totalShellCapacity * 100))
    : 0;
  const followingProfile = isFollowing ? isFollowing(profileAddress) : false;
  const followersCount = Math.max(0, (Number(profileUser?.followers_count ?? profile.followers_count) || 0) + followersAdjustment);
  const followingCount = Number(profileUser?.following_count ?? profile.following_count) || 0;
  const profileCounts = profileUser?.profile_counts || profile.profile_counts || {};

  if (!profileAddress) {
    return null;
  }

  return (
    <main className="mx-auto max-w-5xl">
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-white/45 transition hover:bg-white/[0.05] hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <section className="overflow-visible rounded-[2rem] border border-white/[0.09] bg-[#101218] shadow-[0_28px_90px_-40px_rgba(0,0,0,0.9)]">
        <div className="relative h-36 overflow-hidden rounded-t-[2rem] border-b border-white/[0.07] bg-[radial-gradient(circle_at_20%_20%,rgba(252,211,77,0.28),transparent_33%),radial-gradient(circle_at_80%_30%,rgba(249,115,22,0.16),transparent_34%),linear-gradient(135deg,#161921,#0b0d12)] sm:h-44">
          {coverUrl ? <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:36px_36px] [mask-image:linear-gradient(to_right,black,transparent)]" />}
        </div>

        <div className="relative px-5 pb-6 sm:px-8">
          <div className="flex items-end justify-between gap-4">
            <div className={`-mt-12 grid aspect-square h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-[1.65rem] border-4 border-[#101218] bg-gradient-to-br ${avatarClass} shadow-xl transition-transform duration-300 hover:-translate-y-1 sm:-mt-14 sm:h-28 sm:w-28`}>
              {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : <UserRound className="h-11 w-11 text-white sm:h-12 sm:w-12" />}
            </div>

            <div className="relative mt-4 flex flex-wrap justify-end gap-2">
              {!isOwnProfile && onToggleFollow && (
                <button onClick={handleProfileFollow} className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition ${followingProfile ? 'border border-white/15 bg-white/[0.06] text-white hover:bg-white/[0.1]' : 'bg-amber-300 text-slate-950 hover:bg-amber-200'}`}>
                  {followingProfile ? <UserMinus className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}{followingProfile ? 'Following' : 'Follow'}
                </button>
              )}
              {isOwnProfile && !passwordConfigured && onAddPassword && (
                <button type="button" onClick={onAddPassword} className="inline-flex items-center gap-2 rounded-full border border-amber-200/20 bg-amber-300/10 px-4 py-2.5 text-sm font-bold text-amber-300 transition hover:bg-amber-300/15"><KeyRound className="h-4 w-4" /> Add password</button>
              )}
              {isOwnProfile && displayName && (
                <button type="button" onClick={() => setShowEditProfile(true)} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-4 py-2.5 text-sm font-semibold text-white/65 transition hover:bg-white/[0.08] hover:text-white"><Pencil className="h-4 w-4" /> Edit profile</button>
              )}
              {!isOwnProfile && (onEditorialPreference || onReportProfile) && (
                <div className="relative">
                  <button type="button" onClick={() => setShowEditorialMenu((visible) => !visible)} disabled={Boolean(editorialAction)} aria-label="Profile options" aria-expanded={showEditorialMenu} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.045] text-white/55 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40"><Ellipsis className="h-5 w-5" /></button>
                  {showEditorialMenu && (
                    <div className="absolute right-0 top-12 z-20 w-64 overflow-hidden rounded-2xl border border-white/10 bg-[#181a21] py-1 text-left text-white shadow-2xl">
                      {onEditorialPreference && <>
                        <button type="button" onClick={() => handleEditorialPreference(profileAddress, 'reduce')} className="flex w-full items-center gap-3 px-4 py-3 text-sm text-white/65 hover:bg-white/[0.06]"><UserMinus className="h-4 w-4" /> Show fewer posts</button>
                        <button type="button" onClick={() => handleEditorialPreference(profileAddress, 'mute')} className="flex w-full items-center gap-3 px-4 py-3 text-sm text-white/65 hover:bg-white/[0.06]"><EyeOff className="h-4 w-4" /> Hide this author</button>
                        <button type="button" onClick={() => handleEditorialPreference(profileAddress, 'block')} className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-red-300 hover:bg-red-400/10"><Ban className="h-4 w-4" /> Block this account</button>
                      </>}
                      {onReportProfile && <button type="button" onClick={handleReportProfile} className="flex w-full items-center gap-3 border-t border-white/[0.06] px-4 py-3 text-sm text-red-300 hover:bg-red-400/10"><Flag className="h-4 w-4" /> Report this profile</button>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4">
            {displayName && <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-black tracking-[-0.045em] text-white sm:text-4xl">{displayName}</h1>
              {verified && <span title="Bitcoin ownership verified"><BadgeCheck className="h-5 w-5 fill-amber-300 text-slate-950" /></span>}
              {isOwnProfile && <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">Your profile</span>}
            </div>}
            {isOwnProfile && <div className="mt-2 flex max-w-xl items-center gap-2 text-white/35">
              <button type="button" onClick={handleCopyAddress} aria-label="Copy Bitcoin address" title={copied ? 'Address copied' : 'Copy address'} className="shrink-0 rounded-md p-1 transition hover:bg-white/[0.06] hover:text-white"><Copy className="h-3.5 w-3.5" /></button>
              <p className="min-w-0 break-all font-mono text-xs">{formatBitcoinAddress(profileAddress, addressDisplay)}</p>
            </div>}
            {!loading && bio && <p className="mt-4 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-white/60">{bio}</p>}
            {!loading && (location || websiteUrl) && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/40">
              {location && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" /> {location}</span>}
              {websiteUrl && <a href={websiteUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 truncate text-amber-300/75 transition hover:text-amber-300 hover:underline"><LinkIcon className="h-4 w-4 shrink-0" /> {websiteUrl.replace(/^https:\/\//, '').replace(/\/$/, '')}</a>}
            </div>}
            {!loading && <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/40">
              <button type="button" onClick={() => setConnectionsRelation('followers')} className="transition hover:text-white hover:underline"><strong className="text-white">{followersCount}</strong> followers</button>
              <button type="button" onClick={() => setConnectionsRelation('following')} className="transition hover:text-white hover:underline"><strong className="text-white">{followingCount}</strong> following</button>
              {verifiedAt && <span className="inline-flex items-center gap-1.5"><BadgeCheck className="h-4 w-4 text-emerald-300" /> Verified since {verifiedAt}</span>}
            </div>}
          </div>
        </div>

        {loading ? (
          <div className="border-t border-white/[0.08] p-5 sm:p-8"><ProfileSkeleton /></div>
        ) : (
          <>
            {(error || editorialNotice) && (
              <div className="space-y-3 border-t border-white/[0.08] px-5 pt-5 sm:px-8">
                {error && <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>}
                {editorialNotice && <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">{editorialNotice}</div>}
              </div>
            )}

            {isOwnProfile && (
              <div className="border-t border-white/[0.08] p-5 sm:p-8">
                <div className="relative overflow-hidden rounded-[1.75rem] border border-amber-200/15 bg-[linear-gradient(135deg,rgba(252,211,77,0.09),rgba(255,255,255,0.035)_52%,rgba(249,115,22,0.06))] p-5 text-white shadow-[0_20px_60px_-42px_rgba(252,211,77,0.38)] sm:p-6">
                  <div className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-amber-300/10 blur-3xl" aria-hidden="true" />
                  <p className="relative text-[10px] font-extrabold uppercase tracking-[0.18em] text-amber-300/70">Your spending power</p>
                  {showShellBalance ? <p className="relative mt-2 text-3xl font-black tracking-[-0.04em]">{formatShellAmount(shellsAvailable)} <span className="text-base text-white/40">shells</span></p> : <p className="relative mt-2 text-lg font-bold text-white/40">Shell balance hidden</p>}
                  {showShellBalance && <button type="button" onClick={() => setShowSpent((visible) => !visible)} className="group relative mt-5 block w-full text-left" aria-expanded={showSpent}>
                    <span className="block h-3 overflow-hidden rounded-full bg-black/35 ring-1 ring-white/[0.06]">
                      <span className="block h-full rounded-full bg-gradient-to-r from-amber-300 to-orange-500 transition-[width] duration-500" style={{ width: `${availablePercent}%` }} />
                    </span>
                    <span className={`absolute -top-10 right-0 rounded-xl border border-white/10 bg-black/90 px-3 py-2 text-xs font-bold text-white shadow-xl transition ${showSpent ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:opacity-100'}`}>{formatShellAmount(shellsSpentTotal)} shells spent</span>
                  </button>}
                  <div className="relative mt-4 flex flex-wrap items-end justify-between gap-3 text-xs text-white/40">
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {showShellBalance && <span><strong className="text-white">{formatShellAmount(shellsAvailable, { besideBar: true })}</strong> shells available</span>}
                      {showBitcoinBalance && <span><strong className="text-white">{Number(btcBalance).toFixed(8)}</strong> BTC</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      {onShowStats && showShellBalance && <button type="button" onClick={onShowStats} className="font-bold text-white/55 underline underline-offset-2 hover:text-white">View activity</button>}
                      <a href={`https://mempool.space/address/${profileAddress}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-amber-300/75 hover:text-amber-300 hover:underline">mempool.space <ExternalLink className="h-3 w-3" /></a>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <nav className="sticky top-[68px] z-10 flex overflow-x-auto border-y border-white/[0.08] bg-[#101218]/90 px-3 backdrop-blur-xl sm:px-6" aria-label="Profile content">
              {[
                { id: 'posts', label: 'Posts', count: Number(profileCounts.posts) || 0, icon: MessageSquare },
                { id: 'replies', label: 'Replies', count: Number(profileCounts.replies) || 0, icon: MessageSquare },
                { id: 'reposts', label: 'Reposts', count: Number(profileCounts.reposts) || 0, icon: Repeat2 },
                { id: 'useful', label: 'Useful', count: Number(profileCounts.useful) || 0, icon: Lightbulb },
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`relative inline-flex shrink-0 items-center gap-2 px-4 py-4 text-sm font-semibold transition ${isActive ? 'text-white' : 'text-white/35 hover:text-white/65'}`}>
                  <Icon className="h-4 w-4" /> {tab.label}<span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px]">{tab.count}</span>
                  {isActive && <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-amber-300" />}
                </button>;
              })}
            </nav>

            <div className="space-y-3 p-4 sm:p-6">
              {loadingTab ? <FeedSkeleton count={3} /> : currentMessages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
                  <p className="font-semibold text-white/60">No {activeTab === 'posts' ? 'posts' : activeTab === 'replies' ? 'replies' : activeTab === 'reposts' ? 'reposts' : 'Useful posts'} yet.</p>
                  <p className="mt-2 text-sm text-white/30">This section will fill up as the conversation grows.</p>
                </div>
              ) : currentMessages.map((message) => (
                <MessageCard key={message.id} message={message} currentAddress={currentAddress} onUserClick={onOpenProfile} onUseful={onToggleUseful} onComment={handleComment} onLoadComments={onLoadComments} onRepost={onRepostMessage} onOpenThread={onOpenThread} onEditorialPreference={onEditorialPreference ? handleEditorialPreference : null} onEditorialTopicPreference={onEditorialTopicPreference ? handleEditorialTopicPreference : null} onReportMessage={onReportMessage ? handleReportMessage : null} showActions />
              ))}
              {loadingMore && currentMessages.length > 0 && <FeedSkeleton count={2} compact className="mt-4" />}
              <div className="flex items-center justify-center pt-2">
                {currentHasMore && !loadingMore ? <button onClick={loadMore} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-5 py-3 text-sm font-semibold text-white/60 transition hover:bg-white/[0.08] hover:text-white"><Bitcoin className="h-4 w-4 text-amber-300" /> Load more</button> : !currentHasMore ? <p className="text-xs font-medium text-white/25">You are all caught up.</p> : null}
              </div>
            </div>
          </>
        )}
      </section>

      {showEditProfile && (
        <ProfileEditModal
          address={profileAddress}
          profile={{ ...profile, display_name: displayName }}
          onClose={() => setShowEditProfile(false)}
          onSaved={handleProfileSaved}
          onBalanceUpdated={handleProfileBalanceUpdated}
        />
      )}
      {connectionsRelation && (
        <ProfileConnectionsModal
          address={profileAddress}
          initialRelation={connectionsRelation}
          onClose={() => setConnectionsRelation('')}
          onOpenProfile={onOpenProfile}
          addressDisplay={addressDisplay}
        />
      )}
    </main>
  );
};

export default ProfileStep;
