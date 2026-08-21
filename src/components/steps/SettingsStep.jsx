import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader,
  MonitorCog,
  RotateCcw,
  Rss,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { changePassword } from '../../supabaseClient';
import { formatBitcoinAddress } from '../../lib/displayPreferences';
import { ListSkeleton } from '../ui/ContentSkeletons';

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

const SettingsStep = ({
  address,
  passwordConfigured,
  preferences,
  onPreferencesChange,
  onLoadEditorialPreferences,
  onEditorialPreference,
  onAddPassword,
  onBack,
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [editorialPreferences, setEditorialPreferences] = useState([]);
  const [editorialLoading, setEditorialLoading] = useState(false);
  const [editorialAction, setEditorialAction] = useState('');
  const [editorialError, setEditorialError] = useState('');
  const [editorialSuccess, setEditorialSuccess] = useState('');

  useEffect(() => {
    if (!onLoadEditorialPreferences) return undefined;

    let cancelled = false;
    setEditorialLoading(true);
    setEditorialError('');
    onLoadEditorialPreferences()
      .then((items) => {
        if (!cancelled) setEditorialPreferences(Array.isArray(items) ? items : []);
      })
      .catch((error) => {
        if (!cancelled) setEditorialError(error.message || 'Unable to load content controls.');
      })
      .finally(() => {
        if (!cancelled) setEditorialLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, onLoadEditorialPreferences]);

  const passwordValidation = useMemo(() => {
    if (!currentPassword) return 'Enter your current password';
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return `Use at least ${MIN_PASSWORD_LENGTH} characters for the new password`;
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      return `Use at most ${MAX_PASSWORD_LENGTH} characters for the new password`;
    }
    if (newPassword === currentPassword) return 'Choose a password different from your current password';
    if (newPassword !== confirmation) return 'New passwords do not match';
    return '';
  }, [confirmation, currentPassword, newPassword]);

  const updatePreference = (name, value) => {
    onPreferencesChange?.({ ...preferences, [name]: value });
  };

  const handlePasswordChange = async (event) => {
    event.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    if (passwordValidation) {
      setPasswordError(passwordValidation);
      return;
    }

    try {
      setIsSavingPassword(true);
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setPasswordSuccess('Password updated. Your other active sessions have been signed out.');
    } catch (error) {
      setPasswordError(error.message || 'Unable to update the password');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const restoreEditorialAuthor = async (targetAddress) => {
    if (!onEditorialPreference || editorialAction) return;
    setEditorialAction(targetAddress);
    setEditorialError('');
    setEditorialSuccess('');
    try {
      await onEditorialPreference(targetAddress, 'none');
      setEditorialPreferences((current) => (
        current.filter((item) => item.target_address !== targetAddress)
      ));
      setEditorialSuccess('This account is visible and can interact with you again.');
    } catch (error) {
      setEditorialError(error.message || 'Unable to restore this account.');
    } finally {
      setEditorialAction('');
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-white/50 transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="mb-7">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-300">Your account</p>
        <h2 className="mt-2 text-3xl font-black tracking-tight text-white">Settings</h2>
        <p className="mt-2 text-sm text-white/45">
          Security and display preferences for {formatBitcoinAddress(address, preferences.addressDisplay)}.
        </p>
      </div>

      <div className="space-y-6">
        <section className="overflow-hidden rounded-[1.75rem] border border-stone-200 bg-[#f7f5ef] shadow-[0_24px_70px_-38px_rgba(0,0,0,0.9)]">
          <header className="flex items-start gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-orange-500 text-white">
              <KeyRound className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-lg font-black text-slate-950">Password</h3>
              <p className="mt-1 text-sm text-slate-500">Keep password access to your account secure.</p>
            </div>
          </header>

          {passwordConfigured ? (
            <form onSubmit={handlePasswordChange} className="space-y-4 px-5 py-6 sm:px-7">
              {[
                {
                  id: 'current-password',
                  label: 'Current password',
                  value: currentPassword,
                  setter: setCurrentPassword,
                  autoComplete: 'current-password',
                },
                {
                  id: 'new-password',
                  label: 'New password',
                  value: newPassword,
                  setter: setNewPassword,
                  autoComplete: 'new-password',
                },
                {
                  id: 'confirm-new-password',
                  label: 'Confirm new password',
                  value: confirmation,
                  setter: setConfirmation,
                  autoComplete: 'new-password',
                },
              ].map((field, index) => (
                <label key={field.id} htmlFor={field.id} className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">{field.label}</span>
                  <div className="relative">
                    <input
                      id={field.id}
                      type={showPasswords ? 'text' : 'password'}
                      value={field.value}
                      onChange={(event) => field.setter(event.target.value)}
                      autoComplete={field.autoComplete}
                      minLength={index === 0 ? undefined : MIN_PASSWORD_LENGTH}
                      maxLength={MAX_PASSWORD_LENGTH}
                      required
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 pr-12 text-slate-950 outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10"
                    />
                    {index === 0 && (
                      <button
                        type="button"
                        onClick={() => setShowPasswords((visible) => !visible)}
                        aria-label={showPasswords ? 'Hide passwords' : 'Show passwords'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:text-slate-700"
                      >
                        {showPasswords ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    )}
                  </div>
                </label>
              ))}

              <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
                <p>Use at least 12 characters. Changing your password signs out your other sessions.</p>
              </div>

              {passwordError && (
                <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                  <p>{passwordError}</p>
                </div>
              )}

              {passwordSuccess && (
                <div role="status" className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                  <p>{passwordSuccess}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isSavingPassword || Boolean(passwordValidation)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-3.5 font-bold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {isSavingPassword ? <Loader className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />}
                {isSavingPassword ? 'Updating...' : 'Update password'}
              </button>
            </form>
          ) : (
            <div className="px-5 py-6 sm:px-7">
              <p className="text-sm leading-6 text-slate-600">
                No password is configured. You currently sign in by proving ownership with your Bitcoin wallet.
              </p>
              <button
                type="button"
                onClick={onAddPassword}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 font-bold text-white hover:bg-orange-600"
              >
                <KeyRound className="h-5 w-5" />
                Create a password
              </button>
            </div>
          )}
        </section>

        <section className="rounded-[1.75rem] border border-stone-200 bg-[#f7f5ef] p-5 shadow-[0_24px_70px_-38px_rgba(0,0,0,0.9)] sm:p-7">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white">
              <Rss className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <label htmlFor="default-feed" className="block text-lg font-black text-slate-950">Default feed</label>
              <p className="mt-1 text-sm text-slate-500">Choose what opens first when you visit the network.</p>
              <select
                id="default-feed"
                value={preferences.defaultFeed}
                onChange={(event) => updatePreference('defaultFeed', event.target.value)}
                className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 sm:max-w-xs"
              >
                <option value="for_you">For you</option>
                <option value="recent">Latest posts</option>
                <option value="followed">People you follow</option>
              </select>
            </div>
          </div>
        </section>

        {onLoadEditorialPreferences && (
          <section className="rounded-[1.75rem] border border-stone-200 bg-[#f7f5ef] p-5 shadow-[0_24px_70px_-38px_rgba(0,0,0,0.9)] sm:p-7">
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-black text-slate-950">Content controls</h3>
                <p className="mt-1 text-sm text-slate-500">Manage authors you show less, hide, or block.</p>

                {editorialError && (
                  <div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {editorialError}
                  </div>
                )}
                {editorialSuccess && (
                  <div role="status" className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {editorialSuccess}
                  </div>
                )}

                {editorialLoading ? (
                  <ListSkeleton label="Loading content controls" count={2} className="mt-5" />
                ) : editorialPreferences.length === 0 ? (
                  <p className="mt-5 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    No author restrictions.
                  </p>
                ) : (
                  <ul className="mt-5 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
                    {editorialPreferences.map((item) => (
                      <li key={item.target_address} className="flex items-center justify-between gap-4 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-900">
                            {item.display_name || formatBitcoinAddress(item.target_address, preferences.addressDisplay)}
                          </p>
                          <p className="mt-0.5 text-xs capitalize text-slate-500">
                            {item.preference === 'reduce' ? 'Show fewer posts' : item.preference === 'mute' ? 'Hidden' : 'Blocked'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => restoreEditorialAuthor(item.target_address)}
                          disabled={Boolean(editorialAction)}
                          aria-label={`Restore ${item.display_name || formatBitcoinAddress(item.target_address, preferences.addressDisplay)}`}
                          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-orange-300 hover:text-orange-700 disabled:opacity-50"
                        >
                          {editorialAction === item.target_address
                            ? <Loader className="h-4 w-4 animate-spin" />
                            : <RotateCcw className="h-4 w-4" />}
                          Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        )}

        <section className="rounded-[1.75rem] border border-stone-200 bg-[#f7f5ef] p-5 shadow-[0_24px_70px_-38px_rgba(0,0,0,0.9)] sm:p-7">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white">
              <MonitorCog className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <label htmlFor="motion-setting" className="block text-lg font-black text-slate-950">Animations</label>
              <p className="mt-1 text-sm text-slate-500">Follow your device preference or override it for Danaus.</p>
              <select
                id="motion-setting"
                value={preferences.motion}
                onChange={(event) => updatePreference('motion', event.target.value)}
                className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 sm:max-w-xs"
              >
                <option value="system">Follow device setting</option>
                <option value="full">Show animations</option>
                <option value="reduced">Reduce animations</option>
              </select>
            </div>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-stone-200 bg-[#f7f5ef] p-5 shadow-[0_24px_70px_-38px_rgba(0,0,0,0.9)] sm:p-7">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white">
              <WalletCards className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div>
                <label htmlFor="address-display" className="block text-lg font-black text-slate-950">Show Bitcoin address</label>
                <p className="mt-1 text-sm leading-6 text-slate-500">Choose how your connected address appears throughout Danaus.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-center">
                  <select id="address-display" value={preferences.addressDisplay} onChange={(event) => updatePreference('addressDisplay', event.target.value)} className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10">
                    <option value="full">Full address</option>
                    <option value="shortened">Shortened</option>
                    <option value="masked">Masked</option>
                  </select>
                  <code className="min-w-0 break-all rounded-2xl border border-stone-200 bg-stone-100 px-4 py-3 text-xs text-slate-600">{formatBitcoinAddress(address, preferences.addressDisplay)}</code>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-stone-200 bg-[#f7f5ef] p-5 shadow-[0_24px_70px_-38px_rgba(0,0,0,0.9)] sm:p-7">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white"><Eye className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <label htmlFor="balance-display" className="block text-lg font-black text-slate-950">Show balance</label>
              <p className="mt-1 text-sm leading-6 text-slate-500">Control which account balances are visible across Danaus.</p>
              <select id="balance-display" value={preferences.balanceDisplay} onChange={(event) => updatePreference('balanceDisplay', event.target.value)} className="mt-4 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 sm:max-w-sm">
                <option value="show_all">Show bitcoin and shell balances</option>
                <option value="hide_all">Hide bitcoin and shell balances</option>
                <option value="hide_bitcoin">Hide bitcoin balance</option>
                <option value="hide_shells">Hide shell balances</option>
              </select>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default SettingsStep;
