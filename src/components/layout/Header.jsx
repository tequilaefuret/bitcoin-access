// src/components/layout/Header.jsx
import React, { useState } from 'react';
import { Wallet, LogOut, ChevronDown } from 'lucide-react';
import DanausMark from './DanausMark';

const Header = ({ connectedAddress, connectedWallet, onDisconnect, onViewProfile, minimal = false }) => {
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
              onClick={() => setShowDropdown(!showDropdown)}
              onMouseEnter={() => setShowDropdown(true)}
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
                    {connectedAddress}
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

                <button
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

      <div className={`flex items-center gap-3 ${minimal ? '' : 'mb-2 justify-center'}`}>
        <span className={`grid place-items-center rounded-xl bg-amber-300 text-black ${minimal ? 'h-8 w-8' : 'h-10 w-10'}`}>
          <DanausMark className={minimal ? 'h-5 w-5' : 'h-6 w-6'} />
        </span>
        <h1 className={`${minimal ? 'text-xl' : 'text-4xl'} font-bold tracking-tight text-slate-900`}>Danaus</h1>
      </div>
      
      {!minimal && (
        <p className="text-center text-gray-600">
          The bitcoin social network
        </p>
      )}

      {minimal && (
        <div className="hidden rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-500 shadow-sm backdrop-blur sm:block">
          Bitcoin mainnet
        </div>
      )}
    </div>
  );
};

export default Header;
