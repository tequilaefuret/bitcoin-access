import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Check,
  Loader,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { truncateAddress, upsertUserProfile } from '../../supabaseClient';
import DanausMark from '../layout/DanausMark';

const MIN_LENGTH = 3;
const MAX_LENGTH = 50;

const ProfileSetupStep = ({ address, btcBalance, onComplete, loading, error }) => {
  const [displayName, setDisplayName] = useState('');
  const [localError, setLocalError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState('');

  const trimmedName = displayName.trim();
  const charCount = trimmedName.length;
  const validation = useMemo(() => {
    if (charCount === 0) return 'Choose a display name for your profile';
    if (charCount < MIN_LENGTH) return `At least ${MIN_LENGTH} characters`;
    if (charCount > MAX_LENGTH) return `Maximum ${MAX_LENGTH} characters`;
    return '';
  }, [charCount]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLocalError('');
    setSuccess('');
    if (validation) {
      setLocalError(validation);
      return;
    }
    try {
      setIsSaving(true);
      const result = await upsertUserProfile(address, trimmedName);
      setSuccess('Display name saved');
      setTimeout(() => onComplete?.(result), 350);
    } catch (err) {
      setLocalError(err.message || 'Unable to save the display name');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl py-4 sm:py-8">
      <div className="mb-6 flex items-center justify-center gap-2" aria-label="Setup progress">
        <span className="h-1.5 w-12 rounded-full bg-amber-300" />
        <span className="h-1.5 w-12 rounded-full bg-white/10" />
        <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Step 1 of 2</span>
      </div>

      <div className="grid overflow-hidden rounded-[2rem] border border-white/10 bg-[#101218]/95 shadow-[0_32px_100px_-28px_rgba(0,0,0,0.8)] backdrop-blur-xl lg:grid-cols-[0.82fr_1.18fr]">
        <aside className="relative overflow-hidden border-b border-white/[0.08] bg-white/[0.025] p-7 lg:border-b-0 lg:border-r lg:p-9">
          <div className="absolute -left-20 -top-20 h-52 w-52 rounded-full bg-amber-400/15 blur-3xl" />
          <div className="relative">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-300 text-slate-950 shadow-[0_0_32px_rgba(252,211,77,0.2)]">
              <DanausMark className="h-7 w-7" />
            </span>
            <p className="mt-8 text-xs font-bold uppercase tracking-[0.2em] text-amber-300">Your public identity</p>
            <h1 className="mt-3 text-3xl font-black leading-[1.02] tracking-[-0.045em] text-white sm:text-4xl">Choose how the network will know you.</h1>
            <p className="mt-4 text-sm leading-6 text-white/50">No legal name, email, or phone number. Just a pseudonym linked to the Bitcoin ownership proof you already made.</p>
            <div className="mt-8 space-y-4">
              {['Visible on posts and replies', 'Changeable later from settings', 'Your real identity stays private'].map((item) => (
                <p key={item} className="flex items-center gap-3 text-sm font-semibold text-white/65">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-400/10 text-emerald-300"><Check className="h-3.5 w-3.5" /></span>
                  {item}
                </p>
              ))}
            </div>
          </div>
        </aside>

        <section className="p-6 sm:p-8 lg:p-10">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-amber-200/15 bg-amber-300/10 text-amber-300"><UserRound className="h-6 w-6" /></span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/35">First verified connection</p>
              <h2 className="mt-1 text-2xl font-black tracking-[-0.035em] text-white">Create your pseudonym</h2>
            </div>
          </div>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <div className="min-w-0 flex-1 rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/30">Verified address</p>
              <p className="mt-1 truncate font-mono text-xs text-white/60" title={address}>{truncateAddress(address)}</p>
            </div>
            <div className="rounded-2xl border border-amber-200/10 bg-amber-300/[0.06] px-4 py-3 sm:min-w-40">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200/50">Balance ready</p>
              <p className="mt-1 text-sm font-black text-amber-300">{Number(btcBalance || 0).toFixed(8)} BTC</p>
            </div>
          </div>

          {(error || localError) && (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><p className="whitespace-pre-line">{localError || error}</p>
            </div>
          )}
          {success && (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">
              <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0" /><p>{success}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6">
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-white/80">Display name</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-white/25">@</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="satseeker"
                  maxLength={MAX_LENGTH}
                  autoComplete="nickname"
                  autoFocus
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.055] py-4 pl-9 pr-20 text-lg font-semibold text-white outline-none transition placeholder:text-white/20 hover:border-white/20 focus:border-amber-300/70 focus:bg-white/[0.075] focus:ring-4 focus:ring-amber-300/10"
                />
                <span className={`absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold ${charCount > MAX_LENGTH - 10 ? 'text-amber-300' : 'text-white/30'}`}>{charCount}/{MAX_LENGTH}</span>
              </div>
            </label>

            <div className="mt-3 flex min-h-6 items-center gap-2 text-xs">
              {trimmedName && !validation ? (
                <><BadgeCheck className="h-4 w-4 text-emerald-300" /><span className="font-semibold text-emerald-200">Looks good — @{trimmedName}</span></>
              ) : (
                <><ShieldCheck className="h-4 w-4 text-white/30" /><span className="text-white/40">Unique · {MIN_LENGTH}–{MAX_LENGTH} characters · pseudonymous</span></>
              )}
            </div>

            <button type="submit" disabled={isSaving || loading || !!validation} className="group mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-300 px-5 py-4 font-extrabold text-slate-950 shadow-[0_14px_40px_rgba(252,211,77,0.16)] transition hover:-translate-y-0.5 hover:bg-amber-200 hover:shadow-[0_18px_48px_rgba(252,211,77,0.22)] disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none">
              {isSaving || loading ? <Loader className="h-5 w-5 animate-spin" /> : null}
              {isSaving || loading ? 'Saving...' : 'Continue with this name'}
              {!isSaving && !loading && <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
};

export default ProfileSetupStep;
