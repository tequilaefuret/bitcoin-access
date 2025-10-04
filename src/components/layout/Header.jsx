// src/components/layout/Header.jsx
import React from 'react';
import { Bitcoin } from 'lucide-react';

const Header = () => {
  return (
    <div className="bg-white rounded-2xl shadow-2xl p-8 mb-6">
      <div className="flex items-center justify-center gap-3 mb-2">
        <Bitcoin className="w-10 h-10 text-orange-500" />
        <h1 className="text-4xl font-bold text-gray-800">Bitcoin Exclusive Access</h1>
      </div>
      <p className="text-center text-gray-600">
        Prouvez votre détention de Bitcoin pour accéder au contenu exclusif
      </p>
      <div className="mt-4 bg-purple-50 border-l-4 border-purple-500 p-4">
        <p className="text-sm text-purple-800">
          <strong>💎 Système wBTC :</strong> Votre solde BTC est converti 1:1 en wBTC (monnaie virtuelle). 
          Chaque partie coûte 0.0001 wBTC. Votre solde se synchronise automatiquement avec vos BTC réels.
        </p>
      </div>
    </div>
  );
};

export default Header;