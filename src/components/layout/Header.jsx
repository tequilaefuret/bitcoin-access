// src/components/layout/Header.jsx
import React, { useState } from 'react';
import { ArrowLeft, Wallet, LogOut, ChevronDown, Settings as SettingsIcon } from 'lucide-react';
import DanausMark from './DanausMark';

const shortenAddress = (address) => {
  if (!address || address.length < 15) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
};

const Header = ({
  connectedAddress,
  connectedWallet,
  onDisconnect,
  onViewProfile,
  onSettings,
  onHome,
  showFullAddress = false,
  minimal = false,
}) => {
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <div className={minimal
      ? 'relative mb-2 flex items-center justify-between px-2 py-4'
      : 'relative mb-6 rounded-2xl bg-white p-6 shadow-2xl'
    }>
      {connectedAddress && (
        <div className="absolute top-4 right-4">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowDropdown(!showDropdown)}
              onMouseEnter={() => setShowDropdown(true)}
              aria-expanded={showDropdown}
              aria-haspopup="menu"
              className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-full hover:border-slate-300 transition-all duration-200 group"
            >
              <Wallet className="w-4 h-4 text-slate-600" />
              <span className="text-sm font-medium text-gray-700">
                Private session
              </span>
              <ChevronDown 
                className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${
                  showDropdown ? 'rotate-180' : ''
                }`} 
              />
            </button>

            {showDropdown && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-2xl border-2 border-gray-100 z-50 overflow-hidden"
                onMouseLeave={() => setShowDropdown(false)}
              >
                <div className="p-4 bg-gradient-to-r from-orange-50 to-yellow-50 border-b border-gray-200">
                  <p className="text-xs text-gray-500 mb-1 font-medium">Signed in as</p>
                  <div className="flex items-center gap-2 mb-2">
                    <Wallet className="w-4 h-4 text-orange-600" />
                    <p className="text-sm font-semibold text-gray-800">
                      {connectedWallet || 'Bitcoin account'}
                    </p>
                  </div>
                  <p className="font-mono text-xs text-gray-600 bg-white px-2 py-1 rounded border border-gray-200 break-all">
                    {showFullAddress ? connectedAddress : shortenAddress(connectedAddress)}
                  </p>
                </div>

                {onViewProfile && (
                  <button
                    onClick={() => {
                      setShowDropdown(false);
                      onViewProfile();
                    }}
                    className="w-full px-4 py-3 text-left flex items-center gap-3 text-gray-700 hover:bg-gray-50 transition-colors duration-150 group border-b border-gray-100"
                  >
                    <span className="text-base">👤</span>
                    <span className="font-medium text-sm">
                      View my profile
                    </span>
                  </button>
                )}

                {onSettings && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowDropdown(false);
                      onSettings();
                    }}
                    className="w-full px-4 py-3 text-left flex items-center gap-3 text-gray-700 hover:bg-gray-50 transition-colors duration-150 group border-b border-gray-100"
                  >
                    <SettingsIcon className="h-4 w-4 text-slate-500 transition-transform duration-300 group-hover:rotate-45" />
                    <span className="font-medium text-sm">Settings</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setShowDropdown(false);
                    onDisconnect();
                  }}
                  className="w-full px-4 py-3 text-left flex items-center gap-3 text-red-600 hover:bg-red-50 transition-colors duration-150 group"
                  >
                  <LogOut className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-150" />
                  <span className="font-medium text-sm">
                    Log out
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {minimal ? (
        <button type="button" onClick={onHome} className="group flex items-center gap-2.5" aria-label="Back to Danaus introduction">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-300 text-black shadow-[0_0_32px_rgba(252,211,77,0.22)]">
            <DanausMark className="h-6 w-6 transition-transform duration-500 group-hover:-translate-y-0.5" />
          </span>
          <span className="text-xl font-black tracking-[-0.07em] text-white">danaus</span>
        </button>
      ) : (
        <div className="mb-2 flex items-center justify-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-300 text-black">
            <DanausMark className="h-6 w-6" />
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">Danaus</h1>
        </div>
      )}
      
      {!minimal && (
        <p className="text-center text-gray-600">
          The bitcoin social network
        </p>
      )}

      {minimal && (
        <button type="button" onClick={onHome} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/55 transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white sm:px-4">
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Back to introduction</span>
          <span className="sm:hidden">Back</span>
        </button>
      )}
    </div>
  );
};

export default Header;
