import React, { useEffect, useState } from 'react';
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
  getPublicUserMessages,
  getPublicUserUsefulMessages,
  getUserMessages,
  getUserStats,
  truncateAddress,
} from '../../supabaseClient';

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

const isReplyMessage = (message) => Boolean(
  message?.parent_id ||
  message?.parentId ||
  message?.reply_to ||
  message?.replyTo ||
  message?.reply_of ||
  message?.comment_of ||
  message?.type === 'comment' ||
  message?.type === 'reply'
);

const isRepostMessage = (message) => Boolean(
  message?.repost_of ||
  message?.repostOf ||
  message?.is_repost ||
  message?.type === 'repost'
);

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
  showFullAddress = false,
  onEditorialPreference,
  onEditorialTopicPreference,
  onReportMessage,
  onReportProfile,
  onProfileUpdated,
}) => {
  const [profileUser, setProfileUser] = useState(null);
  const [profileStats, setProfileStats] = useState(null);
  const [messages, setMessages] = useState([]);
  const [usefulMessages, setUsefulMessages] = useState([]);
  const [activeTab, setActiveTab] = useState('posts');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [hasMoreUseful, setHasMoreUseful] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showEditorialMenu, setShowEditorialMenu] = useState(false);
  const [editorialAction, setEditorialAction] = useState('');
  const [editorialNotice, setEditorialNotice] = useState('');
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [connectionsRelation, setConnectionsRelation] = useState('');
  const [followersAdjustment, setFollowersAdjustment] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      if (!profileAddress) return;

      setLoading(true);
      setError('');
      setCopied(false);
      setMessages([]);
      setUsefulMessages([]);
      setHasMore(true);
      setHasMoreUseful(true);
      setActiveTab('posts');
      setShowEditProfile(false);
      setConnectionsRelation('');
      setFollowersAdjustment(0);

      try {
        const isOwner = profileAddress === currentAddress;
        const [user, stats, initialMessages, initialUsefulMessages] = await Promise.all([
          isOwner ? getUserData(profileAddress) : getPublicProfile(profileAddress),
          isOwner ? getUserStats(profileAddress).catch(() => null) : Promise.resolve(null),
          isOwner
            ? getUserMessages(profileAddress, PAGE_SIZE, 0)
            : getPublicUserMessages(profileAddress, PAGE_SIZE, 0),
          getPublicUserUsefulMessages(profileAddress, PAGE_SIZE, 0),
        ]);

        if (cancelled) return;

        setProfileUser(user);
        setProfileStats(stats);
        setMessages(Array.isArray(initialMessages) ? initialMessages : []);
        setUsefulMessages(Array.isArray(initialUsefulMessages) ? initialUsefulMessages : []);
        setHasMore((initialMessages || []).length === PAGE_SIZE);
        setHasMoreUseful((initialUsefulMessages || []).length === PAGE_SIZE);
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
  }, [currentAddress, profileAddress]);

  const normalizedMessages = messages
    .filter(Boolean)
    .map((message) => ({
      ...message,
      bitcoin_address: message.bitcoin_address || profileAddress
    }))
    .sort((a, b) => {
      const left = safeDate(b.created_at || b.timestamp)?.getTime() || 0;
      const right = safeDate(a.created_at || a.timestamp)?.getTime() || 0;
      return left - right;
    });

  const posts = normalizedMessages.filter((message) => !isReplyMessage(message) && !isRepostMessage(message));
  const replies = normalizedMessages.filter((message) => isReplyMessage(message));
  const reposts = normalizedMessages.filter((message) => isRepostMessage(message));

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

  const handleEditorialTopicPreference = async (messageId, preference) => {
    if (!onEditorialTopicPreference) return null;
    const result = await onEditorialTopicPreference(messageId, preference);
    setEditorialNotice('You will see fewer posts related to this topic.');
    return result;
  };

  const loadMore = async () => {
    if ((activeTab === 'useful' ? !hasMoreUseful : !hasMore) || loadingMore) return;

    setLoadingMore(true);
    setError('');

    try {
      if (activeTab === 'useful') {
        const nextUseful = await getPublicUserUsefulMessages(
          profileAddress,
          PAGE_SIZE,
          usefulMessages.length,
        );
        const safeUseful = Array.isArray(nextUseful) ? nextUseful : [];
        setUsefulMessages((previous) => [...previous, ...safeUseful]);
        setHasMoreUseful(safeUseful.length === PAGE_SIZE);
        return;
      }

      const nextMessages = isOwnProfile
        ? await getUserMessages(profileAddress, PAGE_SIZE, messages.length)
        : await getPublicUserMessages(profileAddress, PAGE_SIZE, messages.length);
      const safeNextMessages = Array.isArray(nextMessages) ? nextMessages : [];
      setMessages((prev) => [...prev, ...safeNextMessages]);
      setHasMore(safeNextMessages.length === PAGE_SIZE);
    } catch (err) {
      setError(err.message || 'Unable to load more messages');
    } finally {
      setLoadingMore(false);
    }
  };

  const currentMessages = {
    posts,
    replies,
    reposts,
    useful: usefulMessages,
  }[activeTab] || posts;
  const currentHasMore = activeTab === 'useful' ? hasMoreUseful : hasMore;

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
  const followingProfile = isFollowing ? isFollowing(profileAddress) : false;
  const followersCount = Math.max(0, (Number(profileUser?.followers_count ?? profile.followers_count) || 0) + followersAdjustment);
  const followingCount = Number(profileUser?.following_count ?? profile.following_count) || 0;

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
            <div className={`-mt-12 grid h-24 w-24 place-items-center overflow-hidden rounded-[1.65rem] border-4 border-[#101218] bg-gradient-to-br ${avatarClass} shadow-xl sm:-mt-14 sm:h-28 sm:w-28`}>
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
              {isOwnProfile && (
                <button onClick={handleCopyAddress} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-4 py-2.5 text-sm font-semibold text-white/60 transition hover:bg-white/[0.08] hover:text-white"><Copy className="h-4 w-4" /> {copied ? 'Address copied' : 'Copy address'}</button>
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
            {isOwnProfile && <p className="mt-2 max-w-xl break-all font-mono text-xs text-white/35">{showFullAddress ? profileAddress : truncateAddress(profileAddress)}</p>}
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
              <div className="grid gap-3 border-t border-white/[0.08] p-5 sm:grid-cols-2 sm:p-8 lg:grid-cols-3">
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 text-left">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/30">BTC balance</p>
                  <p className="mt-2 text-xl font-black text-white">{Number(btcBalance).toFixed(8)}</p>
                  <a href={`https://mempool.space/address/${profileAddress}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-amber-300/65 transition hover:text-amber-300 hover:underline">View on mempool.space <ExternalLink className="h-3 w-3" /></a>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 text-left">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/30">Shells available</p>
                  <p className="mt-2 text-xl font-black text-white">{Number(shellsAvailable).toFixed(8)}</p>
                </div>
                {onShowStats ? <button type="button" onClick={onShowStats} className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 text-left transition hover:border-white/[0.13] hover:bg-white/[0.05]">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/30">Shells spent</p>
                  <p className="mt-2 text-xl font-black text-white">{Number(shellsSpentTotal).toFixed(8)}</p>
                  <p className="mt-1 text-xs text-white/40 underline underline-offset-2">View activity</p>
                </button> : <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 text-left"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/30">Shells spent</p><p className="mt-2 text-xl font-black text-white">{Number(shellsSpentTotal).toFixed(8)}</p></div>}
              </div>
            )}

            <nav className="sticky top-[68px] z-10 flex overflow-x-auto border-y border-white/[0.08] bg-[#101218]/90 px-3 backdrop-blur-xl sm:px-6" aria-label="Profile content">
              {[
                { id: 'posts', label: 'Posts', count: posts.length, icon: MessageSquare },
                { id: 'replies', label: 'Replies', count: replies.length, icon: MessageSquare },
                { id: 'reposts', label: 'Reposts', count: reposts.length, icon: Repeat2 },
                { id: 'useful', label: 'Useful', count: usefulMessages.length, icon: Lightbulb },
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
              {currentMessages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
                  <p className="font-semibold text-white/60">No {activeTab === 'posts' ? 'posts' : activeTab === 'replies' ? 'replies' : activeTab === 'reposts' ? 'reposts' : 'Useful posts'} yet.</p>
                  <p className="mt-2 text-sm text-white/30">This section will fill up as the conversation grows.</p>
                </div>
              ) : currentMessages.map((message) => (
                <MessageCard key={message.id} message={message} currentAddress={currentAddress} onUserClick={onOpenProfile} onEditorialPreference={onEditorialPreference ? handleEditorialPreference : null} onEditorialTopicPreference={onEditorialTopicPreference ? handleEditorialTopicPreference : null} onReportMessage={onReportMessage ? handleReportMessage : null} showActions={false} />
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
        />
      )}
      {connectionsRelation && (
        <ProfileConnectionsModal
          address={profileAddress}
          initialRelation={connectionsRelation}
          onClose={() => setConnectionsRelation('')}
          onOpenProfile={onOpenProfile}
        />
      )}
    </main>
  );
};

export default ProfileStep;
