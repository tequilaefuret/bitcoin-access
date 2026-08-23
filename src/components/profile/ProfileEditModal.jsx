import React, { useEffect, useState } from 'react';
import { Camera, Image as ImageIcon, Loader, MapPin, Save, X } from 'lucide-react';
import { removeProfileMedia, uploadProfileMedia, upsertUserProfile } from '../../supabaseClient';
import { formatShellAmount } from '../../lib/displayPreferences';

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ProfileEditModal = ({ address, profile, onClose, onSaved, onBalanceUpdated }) => {
  const [displayName, setDisplayName] = useState(profile.display_name || '');
  const [bio, setBio] = useState(profile.bio || '');
  const [location, setLocation] = useState(profile.location || '');
  const [websiteUrl, setWebsiteUrl] = useState(profile.website_url || '');
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url || '');
  const [coverUrl, setCoverUrl] = useState(profile.cover_url || '');
  const [avatarFile, setAvatarFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [avatarDimensions, setAvatarDimensions] = useState(null);
  const [coverDimensions, setCoverDimensions] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(profile.avatar_url || '');
  const [coverPreview, setCoverPreview] = useState(profile.cover_url || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => {
    if (avatarPreview?.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
    if (coverPreview?.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
  }, [avatarPreview, coverPreview]);

  const selectImage = async (file, kind) => {
    setError('');
    if (!file) return;
    if (!ACCEPTED_TYPES.has(file.type)) {
      setError('Use a JPG, PNG or WebP image.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Each image must be smaller than 5 MB.');
      return;
    }
    const preview = URL.createObjectURL(file);
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      setError('Unable to read this image. Try another JPG, PNG or WebP file.');
      URL.revokeObjectURL(preview);
      return;
    }
    const dimensions = {
      width: bitmap.width,
      height: bitmap.height,
      pixels: bitmap.width * bitmap.height,
      bytes: file.size,
      kib: Math.ceil(file.size / 1024),
    };
    bitmap.close?.();
    if (kind === 'avatar') {
      setAvatarFile(file);
      setAvatarPreview(preview);
      setAvatarUrl(profile.avatar_url || '');
      setAvatarDimensions(dimensions);
    } else {
      setCoverFile(file);
      setCoverPreview(preview);
      setCoverUrl(profile.cover_url || '');
      setCoverDimensions(dimensions);
    }
  };

  const removeImage = (kind) => {
    if (kind === 'avatar') {
      setAvatarFile(null);
      setAvatarPreview('');
      setAvatarUrl('');
      setAvatarDimensions({ width: 0, height: 0, pixels: 0, bytes: 0, kib: 0 });
    } else {
      setCoverFile(null);
      setCoverPreview('');
      setCoverUrl('');
      setCoverDimensions({ width: 0, height: 0, pixels: 0, bytes: 0, kib: 0 });
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      let avatarMedia = null;
      let coverMedia = null;
      if (avatarFile) avatarMedia = await uploadProfileMedia(address, avatarFile, 'avatar');
      else if (!avatarUrl && profile.avatar_url) avatarMedia = await removeProfileMedia(address, 'avatar');
      if (coverFile) coverMedia = await uploadProfileMedia(address, coverFile, 'cover');
      else if (!coverUrl && profile.cover_url) coverMedia = await removeProfileMedia(address, 'cover');

      const savedProfile = await upsertUserProfile(address, displayName, {
        bio,
        location,
        websiteUrl,
      });
      const mergedProfile = {
        ...savedProfile,
        ...(avatarMedia ? {
          avatar_url: avatarMedia.public_url,
          avatar_pixels: avatarMedia.pixels,
          avatar_bytes: avatarMedia.bytes,
        } : {}),
        ...(coverMedia ? {
          cover_url: coverMedia.public_url,
          cover_pixels: coverMedia.pixels,
          cover_bytes: coverMedia.bytes,
        } : {}),
      };
      onBalanceUpdated?.(coverMedia?.user || avatarMedia?.user || null);
      onSaved(mergedProfile);
    } catch (saveError) {
      setError(saveError.message || 'Unable to save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Edit profile">
      <form onSubmit={handleSubmit} className="mx-auto my-4 w-full max-w-2xl overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#11131a] text-white shadow-[0_32px_100px_rgba(0,0,0,0.65)] sm:my-8">
        <header className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">Public profile</p><h2 className="mt-1 text-xl font-black">Edit profile</h2></div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full text-white/40 transition hover:bg-white/[0.06] hover:text-white"><X className="h-5 w-5" /></button>
        </header>

        <div className="relative h-36 bg-white/[0.035] sm:h-44">
          {coverPreview ? <img src={coverPreview} alt="Cover preview" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><ImageIcon className="h-7 w-7 text-white/15" /></div>}
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/20 opacity-0 transition hover:opacity-100 focus-within:opacity-100">
            <label className="cursor-pointer rounded-full bg-black/70 px-4 py-2 text-xs font-bold text-white backdrop-blur"><input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => selectImage(event.target.files?.[0], 'cover')} />Choose cover</label>
            {coverPreview && <button type="button" onClick={() => removeImage('cover')} className="rounded-full bg-black/70 px-4 py-2 text-xs font-bold text-white">Remove</button>}
          </div>
        </div>

        <div className="px-5 pb-6 sm:px-7">
          <div className="relative -mt-10 mb-5 h-20 w-20 rounded-[1.4rem] border-4 border-[#11131a] bg-[#1b1d24]">
            {avatarPreview ? <img src={avatarPreview} alt="Avatar preview" className="h-full w-full rounded-[1.1rem] object-cover" /> : <div className="grid h-full place-items-center"><Camera className="h-5 w-5 text-white/20" /></div>}
            <label className="absolute inset-0 grid cursor-pointer place-items-center rounded-[1.1rem] bg-black/50 opacity-0 transition hover:opacity-100 focus-within:opacity-100"><Camera className="h-5 w-5" /><input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => selectImage(event.target.files?.[0], 'avatar')} /></label>
          </div>
          {avatarPreview && <button type="button" onClick={() => removeImage('avatar')} className="-mt-3 mb-4 text-xs font-semibold text-white/35 hover:text-red-300">Remove profile photo</button>}

          {(avatarDimensions || coverDimensions) && <div className="mb-5 grid gap-2 rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] p-4 text-xs text-white/55 sm:grid-cols-2">
            {avatarDimensions && <p><strong className="text-white">Profile photo:</strong> {avatarDimensions.width} × {avatarDimensions.height} · {formatShellAmount(avatarDimensions.kib)} shells locked</p>}
            {coverDimensions && <p><strong className="text-white">Cover:</strong> {coverDimensions.width} × {coverDimensions.height} · {formatShellAmount(coverDimensions.kib)} shells locked</p>}
          </div>}

          <div className="grid gap-4">
            <label className="block"><span className="mb-1.5 block text-xs font-bold text-white/55">Display name</span><input required minLength={3} maxLength={50} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="w-full rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3 text-white outline-none focus:border-amber-300/60" /></label>
            <label className="block"><span className="mb-1.5 flex items-center justify-between text-xs font-bold text-white/55"><span>Bio</span><span className="font-medium text-white/25">{bio.length}/300</span></span><textarea rows={4} maxLength={300} value={bio} onChange={(event) => setBio(event.target.value)} placeholder="Tell people what matters to you." className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3 text-white outline-none placeholder:text-white/20 focus:border-amber-300/60" /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-white/55">Location</span><div className="relative"><MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" /><input maxLength={80} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="City or region" className="w-full rounded-xl border border-white/10 bg-white/[0.045] py-3 pl-10 pr-4 text-white outline-none placeholder:text-white/20 focus:border-amber-300/60" /></div></label>
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-white/55">Website</span><input value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="example.com" className="w-full rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3 text-white outline-none placeholder:text-white/20 focus:border-amber-300/60" /></label>
            </div>
          </div>

          <p className="mt-4 text-xs leading-5 text-white/30">JPG, PNG or WebP, 5 MB maximum. Each started KB (1,024 bytes) locks 1 refundable shell; replacing or removing an image adjusts the amount.</p>
          {error && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
          <button type="submit" disabled={saving || !displayName.trim()} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-300 px-5 py-3.5 text-sm font-extrabold text-slate-950 transition hover:bg-amber-200 disabled:opacity-50">{saving ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? 'Saving profile...' : 'Save profile'}</button>
        </div>
      </form>
    </div>
  );
};

export default ProfileEditModal;
