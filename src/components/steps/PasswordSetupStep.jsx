import React, { useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, KeyRound, Loader, ShieldCheck } from 'lucide-react';
import { configurePassword, truncateAddress } from '../../supabaseClient';

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

const PasswordSetupStep = ({ address, mode = 'set', onComplete, onSkip }) => {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const [error, setError] = useState('');
  const isReset = mode === 'reset';

  const validation = useMemo(() => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      return `Use at most ${MAX_PASSWORD_LENGTH} characters`;
    }
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
    <div className="mx-auto max-w-xl py-4 sm:py-8">
      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_-32px_rgba(15,23,42,0.38)]">
        <header className="border-b border-slate-100 px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/20">
              <KeyRound className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">Account security</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
                {isReset ? 'Choose a new password' : 'Create your password'}
              </h1>
              <p className="mt-2 text-sm text-slate-500">Optional, but recommended for easier access.</p>
            </div>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5 px-5 py-6 sm:px-8 sm:py-8">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Verified account</p>
            <p className="mt-1 font-mono text-sm text-slate-800">{truncateAddress(address)}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">Faster sign-in</p>
              <p className="mt-1 text-sm text-slate-500">Use your username or address without signing again.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">Works on another device</p>
              <p className="mt-1 text-sm text-slate-500">Access your account when your wallet is not nearby.</p>
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-800">Password</span>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                required
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 pr-12 text-slate-950 outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:text-slate-700"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-800">Confirm password</span>
            <input
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              maxLength={MAX_PASSWORD_LENGTH}
              required
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-slate-950 outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10"
            />
          </label>

          <div className="flex items-start gap-3 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-900">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
            <p>Use at least 12 characters. A long, unique phrase is stronger and easier to remember than a short complex password.</p>
          </div>

          {error && (
            <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isSaving || isSkipping || Boolean(validation)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-4 font-bold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? <Loader className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />}
            {isSaving ? 'Saving...' : isReset ? 'Replace password' : 'Create password'}
            {!isSaving && <ArrowRight className="h-5 w-5" />}
          </button>

          {!isReset && onSkip && (
            <button
              type="button"
              onClick={handleSkip}
              disabled={isSaving || isSkipping}
              className="w-full rounded-2xl px-5 py-3 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSkipping ? 'Continuing...' : 'Continue with wallet only'}
            </button>
          )}

          {!isReset && (
            <p className="text-center text-xs text-slate-400">
              You can add a password later from your profile. Wallet authentication remains available.
            </p>
          )}
        </form>
      </div>
    </div>
  );
};

export default PasswordSetupStep;
