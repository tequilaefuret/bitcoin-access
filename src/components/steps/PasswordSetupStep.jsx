import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader,
  LockKeyhole,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { configurePassword } from '../../supabaseClient';
import { formatBitcoinAddress } from '../../lib/displayPreferences';
import DanausMark from '../layout/DanausMark';

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

const PasswordSetupStep = ({ address, mode = 'set', onComplete, onSkip, addressDisplay = 'shortened' }) => {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const [error, setError] = useState('');
  const isReset = mode === 'reset';

  const checks = [
    { label: '12 characters minimum', valid: password.length >= MIN_PASSWORD_LENGTH },
    { label: 'Passwords match', valid: Boolean(confirmation) && password === confirmation },
  ];
  const validation = useMemo(() => {
    if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
    if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters`;
    if (password !== confirmation) return 'Passwords do not match';
    return '';
  }, [confirmation, password]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (validation) {
      setError(validation);
      return;
    }
    try {
      setIsSaving(true);
      await configurePassword(password, { reset: isReset });
      onComplete?.();
    } catch (saveError) {
      setError(saveError.message || 'Unable to save the password');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSkip = async () => {
    setError('');
    try {
      setIsSkipping(true);
      await onSkip?.();
    } catch (skipError) {
      setError(skipError.message || 'Unable to continue without a password');
    } finally {
      setIsSkipping(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl py-4 sm:py-8">
      {!isReset && (
        <div className="mb-6 flex items-center justify-center gap-2" aria-label="Setup progress">
          <span className="h-1.5 w-12 rounded-full bg-emerald-400" />
          <span className="h-1.5 w-12 rounded-full bg-amber-300" />
          <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Step 2 of 2</span>
        </div>
      )}

      <div className="grid overflow-hidden rounded-[2rem] border border-white/10 bg-[#101218]/95 shadow-[0_32px_100px_-28px_rgba(0,0,0,0.8)] backdrop-blur-xl lg:grid-cols-[0.82fr_1.18fr]">
        <aside className="relative overflow-hidden border-b border-white/[0.08] bg-white/[0.025] p-7 lg:border-b-0 lg:border-r lg:p-9">
          <div className="absolute -left-20 -top-20 h-52 w-52 rounded-full bg-amber-400/15 blur-3xl" />
          <div className="relative">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-300 text-slate-950"><DanausMark className="h-7 w-7" /></span>
            <p className="mt-8 text-xs font-bold uppercase tracking-[0.2em] text-amber-300">Account access</p>
            <h1 className="mt-3 text-3xl font-black leading-[1.02] tracking-[-0.045em] text-white sm:text-4xl">Your wallet remains the master key.</h1>
            <p className="mt-4 text-sm leading-6 text-white/50">A password simply gives you a faster way back in. It never replaces your wallet or gives Danaus access to your funds.</p>
            <div className="mt-8 grid gap-3">
              <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-4">
                <Wallet className="h-5 w-5 text-amber-300" />
                <p className="mt-3 text-sm font-bold text-white">Wallet sign-in</p>
                <p className="mt-1 text-xs leading-5 text-white/40">Always available and remains your sovereign recovery path.</p>
              </div>
              <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-4">
                <KeyRound className="h-5 w-5 text-emerald-300" />
                <p className="mt-3 text-sm font-bold text-white">Password sign-in</p>
                <p className="mt-1 text-xs leading-5 text-white/40">Convenient on another device when your wallet is not nearby.</p>
              </div>
            </div>
          </div>
        </aside>

        <section className="p-6 sm:p-8 lg:p-10">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-amber-200/15 bg-amber-300/10 text-amber-300"><LockKeyhole className="h-6 w-6" /></span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/35">{isReset ? 'Secure recovery' : 'Optional security'}</p>
              <h2 className="mt-1 text-2xl font-black tracking-[-0.035em] text-white">{isReset ? 'Choose a new password' : 'Create your password'}</h2>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/30">Verified account</p>
            <p className="mt-1 truncate font-mono text-xs text-white/60">{formatBitcoinAddress(address, addressDisplay)}</p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-white/80">Password</span>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  maxLength={MAX_PASSWORD_LENGTH}
                  required
                  autoFocus
                  placeholder="A long, unique passphrase"
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-4 pr-12 text-white outline-none transition placeholder:text-white/20 hover:border-white/20 focus:border-amber-300/70 focus:bg-white/[0.075] focus:ring-4 focus:ring-amber-300/10"
                />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/35 transition hover:bg-white/[0.06] hover:text-white">
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-white/80">Confirm password</span>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="new-password"
                maxLength={MAX_PASSWORD_LENGTH}
                required
                placeholder="Repeat your passphrase"
                className="w-full rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-4 text-white outline-none transition placeholder:text-white/20 hover:border-white/20 focus:border-amber-300/70 focus:bg-white/[0.075] focus:ring-4 focus:ring-amber-300/10"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              {checks.map((check) => (
                <span key={check.label} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${check.valid ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-white/[0.08] bg-white/[0.035] text-white/35'}`}>
                  <Check className="h-3.5 w-3.5" /> {check.label}
                </span>
              ))}
            </div>

            <div className="flex items-start gap-3 rounded-2xl border border-amber-200/10 bg-amber-300/[0.06] px-4 py-3 text-xs leading-5 text-amber-100/65">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> A long passphrase unique to Danaus is safer and easier to remember than a short complex password.
            </div>

            {error && (
              <div className="flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><p>{error}</p>
              </div>
            )}

            <button type="submit" disabled={isSaving || isSkipping || Boolean(validation)} className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-300 px-5 py-4 font-extrabold text-slate-950 shadow-[0_14px_40px_rgba(252,211,77,0.16)] transition hover:-translate-y-0.5 hover:bg-amber-200 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-40">
              {isSaving ? <Loader className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />}
              {isSaving ? 'Saving...' : isReset ? 'Replace password' : 'Create password'}
              {!isSaving && <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />}
            </button>

            {!isReset && onSkip && (
              <button type="button" onClick={handleSkip} disabled={isSaving || isSkipping} className="w-full rounded-2xl px-5 py-3 text-sm font-semibold text-white/40 transition hover:bg-white/[0.045] hover:text-white/75 disabled:opacity-40">
                {isSkipping ? 'Continuing...' : 'Continue with wallet only'}
              </button>
            )}
          </form>
        </section>
      </div>
    </main>
  );
};

export default PasswordSetupStep;
