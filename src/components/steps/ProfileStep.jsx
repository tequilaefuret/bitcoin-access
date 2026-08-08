import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Bitcoin,
  Copy,
  Loader,
  KeyRound,
  Lightbulb,
  MessageSquare,
  Repeat2,
  UserRound
} from 'lucide-react';
import MessageCard from '../social/MessageCard';
import {
  getUserData,
  getPublicProfile,
  getPublicUserMessages,
  getPublicUserUsefulMessages,
  getUserMessages,
  getUserStats,
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
  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(profileAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      setError('Unable to copy the address');
    }
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
    'Anonymous';

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

  if (!profileAddress) {
    return null;
  }

  return (
    <div className="max-w-5xl mx-auto">
      <button
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-2 text-gray-700 hover:text-gray-900 transition"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500 px-6 py-8 text-white">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${avatarClass} flex items-center justify-center shadow-lg`}>
                <UserRound className="w-10 h-10 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-3xl font-bold">{displayName}</h2>
                  {verified && (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white/20 text-sm font-semibold">
                      <BadgeCheck className="w-4 h-4" />
                      Verified
                    </span>
                  )}
                  {isOwnProfile && (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-black/20 text-sm font-semibold">
                      Your profile
                    </span>
                  )}
                </div>
                {isOwnProfile && (
                  <p className="mt-1 text-white/90 font-mono text-sm break-all">
                    {profileAddress}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {!isOwnProfile && onToggleFollow && (
                <button
                  onClick={() => onToggleFollow(profileAddress)}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold shadow transition ${
                    followingProfile
                      ? 'bg-slate-900 text-white hover:bg-slate-800'
                      : 'bg-white text-orange-700 hover:bg-orange-50'
                  }`}
                >
                  <UserRound className="w-4 h-4" />
                  {followingProfile ? 'Following' : 'Follow'}
                </button>
              )}

              {isOwnProfile && !passwordConfigured && onAddPassword && (
                <button
                  type="button"
                  onClick={onAddPassword}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold shadow transition bg-slate-900 text-white hover:bg-slate-800"
                >
                  <KeyRound className="w-4 h-4" />
                  Add password
                </button>
              )}

              {isOwnProfile && (
                <button
                  onClick={handleCopyAddress}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold shadow transition bg-white text-orange-700 hover:bg-orange-50"
                >
                  <Copy className="w-4 h-4" />
                  {copied ? 'Address copied' : 'Copy address'}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 lg:p-8">
          {loading ? (
            <div className="py-16 text-center">
              <Loader className="w-8 h-8 animate-spin mx-auto text-orange-500" />
              <p className="mt-3 text-gray-600">Loading profile...</p>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-800">
                  {error}
                </div>
              )}

              {isOwnProfile && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-orange-50 rounded-2xl p-4 border border-orange-100">
                    <p className="text-sm text-orange-700 font-medium">BTC balance</p>
                    <p className="text-2xl font-bold text-orange-900 mt-1">{Number(btcBalance).toFixed(8)}</p>
                  </div>
                  <div className="bg-blue-50 rounded-2xl p-4 border border-blue-100">
                    <p className="text-sm text-blue-700 font-medium">Shells available</p>
                    <p className="text-2xl font-bold text-blue-900 mt-1">{Number(shellsAvailable).toFixed(8)}</p>
                  </div>
                  {isOwnProfile && onShowStats ? (
                    <button
                      type="button"
                      onClick={onShowStats}
                      className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100 text-left transition hover:bg-emerald-100 hover:border-emerald-200 cursor-pointer"
                    >
                      <p className="text-sm text-emerald-700 font-medium">Shells spent</p>
                      <p className="text-2xl font-bold text-emerald-900 mt-1">{Number(shellsSpentTotal).toFixed(8)}</p>
                      <p className="text-xs text-emerald-700/80 mt-2">Click to view details</p>
                    </button>
                  ) : (
                    <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100">
                      <p className="text-sm text-emerald-700 font-medium">Shells spent</p>
                      <p className="text-2xl font-bold text-emerald-900 mt-1">{Number(shellsSpentTotal).toFixed(8)}</p>
                    </div>
                  )}
                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
                    <p className="text-sm text-slate-700 font-medium">Signature</p>
                    <p className="text-lg font-bold text-slate-900 mt-1">
                      {verified ? 'Verified' : 'Unverified'}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {verifiedAt ? `Since ${verifiedAt}` : 'No date available'}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
                <div className="bg-white rounded-2xl p-5 border border-gray-200">
                  <p className="text-sm text-gray-500">Activity</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                    <div className="bg-orange-50 rounded-xl p-3">
                      <p className="text-2xl font-bold text-orange-700">{posts.length}</p>
                      <p className="text-xs text-orange-900/70">Posts</p>
                    </div>
                    <div className="bg-blue-50 rounded-xl p-3">
                      <p className="text-2xl font-bold text-blue-700">{replies.length}</p>
                      <p className="text-xs text-blue-900/70">Replies</p>
                    </div>
                    <div className="bg-emerald-50 rounded-xl p-3">
                      <p className="text-2xl font-bold text-emerald-700">{reposts.length}</p>
                      <p className="text-xs text-emerald-900/70">Reposts</p>
                    </div>
                    <div className="rounded-xl bg-amber-50 p-3">
                      <p className="text-2xl font-bold text-amber-700">{usefulMessages.length}</p>
                      <p className="text-xs text-amber-900/70">Useful</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl p-5 border border-gray-200">
                  <p className="text-sm text-gray-500">Social summary</p>
                  <div className="mt-3 space-y-2 text-sm text-gray-700">
                    <div className="flex justify-between gap-4">
                      <span>Loaded messages</span>
                      <span className="font-semibold">{normalizedMessages.length}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span>Last activity</span>
                      <span className="font-semibold">
                        {formatDate(normalizedMessages[0]?.created_at || normalizedMessages[0]?.timestamp) || 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mb-5 flex flex-wrap gap-2">
                {[
                  { id: 'posts', label: 'Posts', count: posts.length, icon: MessageSquare },
                  { id: 'replies', label: 'Replies', count: replies.length, icon: MessageSquare },
                  { id: 'reposts', label: 'Reposts', count: reposts.length, icon: Repeat2 },
                  { id: 'useful', label: 'Useful', count: usefulMessages.length, icon: Lightbulb }
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;

                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border transition ${
                        isActive
                          ? 'bg-orange-500 text-white border-orange-500 shadow'
                          : 'bg-white text-gray-700 border-gray-200 hover:border-orange-300'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{tab.label}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        isActive ? 'bg-white/20' : 'bg-gray-100'
                      }`}>
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-4">
                {currentMessages.length === 0 ? (
                  <div className="bg-gray-50 rounded-2xl border border-dashed border-gray-200 p-10 text-center">
                    <p className="text-gray-700 font-medium">
                      No {activeTab === 'posts' ? 'posts' : activeTab === 'replies' ? 'replies' : activeTab === 'reposts' ? 'reposts' : 'Useful posts'} yet.
                    </p>
                    <p className="text-sm text-gray-500 mt-2">
                      This section will fill up once matching content is published.
                    </p>
                  </div>
                ) : (
                  currentMessages.map((message) => (
                    <div key={message.id} className="bg-white rounded-2xl border border-gray-200 p-4">
                      <MessageCard
                        message={message}
                        currentAddress={currentAddress}
                        onUserClick={onOpenProfile}
                        showActions={false}
                      />
                    </div>
                  ))
                )}
              </div>

              <div className="mt-6 flex items-center justify-center">
                {currentHasMore ? (
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gray-900 text-white font-semibold hover:bg-gray-800 disabled:opacity-50 transition"
                  >
                    {loadingMore ? (
                      <>
                        <Loader className="w-4 h-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <Bitcoin className="w-4 h-4" />
                        Load more
                      </>
                    )}
                  </button>
                ) : (
                  <p className="text-sm text-gray-500">
                    All messages loaded.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfileStep;
