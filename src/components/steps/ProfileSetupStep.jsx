import React, { useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, BadgeCheck, Loader, Sparkles, UserRound } from 'lucide-react';
import { truncateAddress, upsertUserProfile } from '../../supabaseClient';

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
    if (charCount === 0) {
      return 'Choose a display name for your profile';
    }
    if (charCount < MIN_LENGTH) {
      return `At least ${MIN_LENGTH} characters`;
    }
    if (charCount > MAX_LENGTH) {
      return `Maximum ${MAX_LENGTH} characters`;
    }
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
      setTimeout(() => {
        onComplete?.(result);
      }, 350);
    } catch (err) {
      setLocalError(err.message || 'Unable to save the display name');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-slate-900 via-orange-700 to-amber-500 px-6 py-8 text-white">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-white/15 flex items-center justify-center">
              <UserRound className="w-8 h-8" />
            </div>
            <div>
              <p className="text-white/80 text-sm">First verified connection</p>
              <h2 className="text-3xl font-bold mt-1">Choose your display name</h2>
              <p className="text-white/80 mt-2">
                Your display name will appear in the feed, on your profile, and in replies.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 lg:p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Verified address</p>
              <p className="font-mono text-sm text-gray-800 break-all">{address}</p>
              <p className="text-xs text-gray-500 mt-2">{truncateAddress(address)}</p>
            </div>

            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
              <p className="text-xs uppercase tracking-wide text-orange-700 mb-2">Available balance</p>
              <p className="text-2xl font-bold text-orange-900">{Number(btcBalance || 0).toFixed(8)} BTC</p>
              <p className="text-xs text-orange-700 mt-2">Your shell balance is ready.</p>
            </div>
          </div>

          {(error || localError) && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 flex items-start gap-3 text-red-800">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <p className="whitespace-pre-line">{localError || error}</p>
            </div>
          )}

          {success && (
            <div className="rounded-2xl border border-green-200 bg-green-50 p-4 flex items-start gap-3 text-green-800">
              <BadgeCheck className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <p>{success}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="block text-sm font-semibold text-gray-800 mb-2">Display name</span>
              <div className="relative">
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. satoshi_orange"
                  maxLength={MAX_LENGTH}
                  autoComplete="nickname"
                  className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 pr-24 text-lg outline-none transition focus:border-orange-500"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                  {charCount}/{MAX_LENGTH}
                </div>
              </div>
            </label>

            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Sparkles className="w-4 h-4 text-orange-600" />
                <span>Your display name must be unique and between {MIN_LENGTH} and {MAX_LENGTH} characters.</span>
              </div>
              <p className="mt-2 text-sm text-gray-500">
                You will then be able to publish, comment, and appear under this name across the network.
              </p>
              {trimmedName && !validation && (
                <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-green-700">
                  <BadgeCheck className="w-4 h-4" />
                  @ {trimmedName}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSaving || loading || !!validation}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 px-5 py-3 text-white font-bold shadow-lg hover:from-orange-600 hover:to-amber-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving || loading ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <ArrowRight className="w-5 h-5" />
                  Confirm display name
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ProfileSetupStep;
