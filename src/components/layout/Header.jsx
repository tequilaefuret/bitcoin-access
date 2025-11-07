// src/components/layout/Header.jsx
import React, { useState } from 'react';
import { Bitcoin, Wallet, LogOut, ChevronDown, TestTube } from 'lucide-react';

const Header = ({ connectedAddress, connectedWallet, onDisconnect, isTestMode }) => {
  const [showDropdown, setShowDropdown] = useState(false);

  // Formater l'adresse : 6 premiers caractères ... 4 derniers
  const formatAddress = (address) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  return (
    <div className="bg-white rounded-2xl shadow-2xl p-8 mb-6 relative">
      {/* WALLET INFO EN HAUT À DROITE */}
      {connectedAddress && (
        <div className="absolute top-4 right-4">
          <div className="relative">
            {/* Bouton déclencheur */}
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              onMouseEnter={() => setShowDropdown(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-50 to-yellow-50 border-2 border-orange-200 rounded-lg hover:border-orange-300 transition-all duration-200 group"
            >
              <Wallet className="w-4 h-4 text-orange-600" />
              <span className="font-mono text-sm font-medium text-gray-700">
                {formatAddress(connectedAddress)}
              </span>
              <ChevronDown 
                className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${
                  showDropdown ? 'rotate-180' : ''
                }`} 
              />
            </button>

            {/* Dropdown */}
            {showDropdown && (
              <div 
                className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-2xl border-2 border-gray-100 z-50 overflow-hidden"
                onMouseLeave={() => setShowDropdown(false)}
              >
                {/* Info wallet */}
                <div className="p-4 bg-gradient-to-r from-orange-50 to-yellow-50 border-b border-gray-200">
                  <p className="text-xs text-gray-500 mb-1 font-medium">Connecté avec</p>
                  <div className="flex items-center gap-2 mb-2">
                    <Wallet className="w-4 h-4 text-orange-600" />
                    <p className="text-sm font-semibold text-gray-800">
                      {connectedWallet || 'Bitcoin Wallet'}
                    </p>
                  </div>
                  <p className="font-mono text-xs text-gray-600 bg-white px-2 py-1 rounded border border-gray-200 break-all">
                    {connectedAddress}
                  </p>
                </div>

                {/* Bouton déconnexion */}
                <button
                  onClick={() => {
                    setShowDropdown(false);
                    onDisconnect();
                  }}
                  className="w-full px-4 py-3 text-left flex items-center gap-3 text-red-600 hover:bg-red-50 transition-colors duration-150 group"
                >
                  <LogOut className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-150" />
                  <span className="font-medium text-sm">
                    {isTestMode ? 'Quitter le mode test' : 'Déconnecter le wallet'}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TITRE ET LOGO CENTRÉS */}
      <div className="flex items-center justify-center gap-3 mb-2">
        <Bitcoin className="w-10 h-10 text-orange-500" />
        <h1 className="text-4xl font-bold text-gray-800">Bitcoin Exclusive Access</h1>
      </div>
      
      <p className="text-center text-gray-600">
        Prouvez votre détention de Bitcoin pour accéder au contenu exclusif
      </p>

      {/* INFO WBTC */}
      <div className="mt-4 bg-purple-50 border-l-4 border-purple-500 p-4">
        <p className="text-sm text-purple-800">
          <strong>💎 Système wBTC :</strong> Votre solde BTC est converti 1:1 en wBTC (monnaie virtuelle).
          Chaque partie coûte 0.000001 wBTC. Votre solde se synchronise automatiquement avec vos BTC réels.
        </p>
      </div>
    </div>
  );
};

export default Header;