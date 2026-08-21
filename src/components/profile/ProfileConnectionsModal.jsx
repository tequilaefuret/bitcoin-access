import React, { useEffect, useState } from 'react';
import { Loader, UserRound, X } from 'lucide-react';
import { getPublicProfileConnections } from '../../supabaseClient';
import { formatBitcoinAddress } from '../../lib/displayPreferences';

const PAGE_SIZE = 50;

const ProfileConnectionsModal = ({ address, initialRelation = 'followers', onClose, onOpenProfile, addressDisplay = 'shortened' }) => {
  const [relation, setRelation] = useState(initialRelation);
  const [accounts, setAccounts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setAccounts([]);
    getPublicProfileConnections(address, relation, PAGE_SIZE, 0)
      .then((result) => {
        if (cancelled) return;
        setAccounts(result.accounts);
        setTotal(result.total);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message || 'Unable to load accounts');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [address, relation]);

  const loadMore = async () => {
    if (loadingMore || accounts.length >= total) return;
    setLoadingMore(true);
    setError('');
    try {
      const result = await getPublicProfileConnections(address, relation, PAGE_SIZE, accounts.length);
      setAccounts((current) => [...current, ...result.accounts]);
      setTotal(result.total);
    } catch (loadError) {
      setError(loadError.message || 'Unable to load more accounts');
    } finally {
      setLoadingMore(false);
    }
  };

  const openProfile = (bitcoinAddress) => {
    onClose();
    onOpenProfile?.(bitcoinAddress);
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Profile connections">
      <section className="flex max-h-[78vh] w-full max-w-lg flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#11131a] text-white shadow-[0_32px_100px_rgba(0,0,0,0.65)]">
        <header className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div className="flex rounded-full border border-white/[0.08] bg-white/[0.035] p-1">
            {[
              ['followers', 'Followers'],
              ['following', 'Following'],
            ].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setRelation(id)} className={`rounded-full px-4 py-2 text-sm font-bold transition ${relation === id ? 'bg-white text-slate-950' : 'text-white/40 hover:text-white'}`}>{label}</button>
            ))}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full text-white/40 transition hover:bg-white/[0.06] hover:text-white"><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-56 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="grid min-h-52 place-items-center"><Loader className="h-6 w-6 animate-spin text-amber-300" /></div>
          ) : error && accounts.length === 0 ? (
            <p className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p>
          ) : accounts.length === 0 ? (
            <div className="grid min-h-52 place-items-center text-center"><div><UserRound className="mx-auto h-7 w-7 text-white/20" /><p className="mt-3 text-sm text-white/35">No {relation} yet.</p></div></div>
          ) : (
            <div className="space-y-1">
              {accounts.map((account) => (
                <button key={account.bitcoin_address} type="button" onClick={() => openProfile(account.bitcoin_address)} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left transition hover:bg-white/[0.055]">
                  {account.avatar_url ? <img src={account.avatar_url} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-200 to-orange-500 text-sm font-black text-slate-950">{account.display_name?.charAt(0)?.toUpperCase() || '?'}</span>}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-white">{account.display_name || formatBitcoinAddress(account.bitcoin_address, addressDisplay)}</span>
                    {account.bio && <span className="mt-0.5 block truncate text-xs text-white/35">{account.bio}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
          {error && accounts.length > 0 && <p className="mt-3 text-center text-xs text-red-300">{error}</p>}
          {accounts.length < total && !loading && (
            <button type="button" onClick={loadMore} disabled={loadingMore} className="mt-3 w-full rounded-xl border border-white/[0.08] py-2.5 text-sm font-semibold text-white/50 transition hover:bg-white/[0.05] hover:text-white disabled:opacity-50">{loadingMore ? 'Loading...' : 'Load more'}</button>
          )}
        </div>
      </section>
    </div>
  );
};

export default ProfileConnectionsModal;
