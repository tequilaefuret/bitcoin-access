// src/components/steps/DashboardStep.jsx
import React from 'react';
import { Unlock, Bitcoin, Coins, Gamepad2, History, TrendingUp, RefreshCw, Loader } from 'lucide-react';
import ErrorAlert from '../ui/ErrorAlert';

const DashboardStep = ({ 
  btcBalance,
  wbtcAvailable,
  wbtcSpentTotal,
  onStartGame,
  onSync,
  onShowHistory,
  onShowStats,
  loading,
  error
}) => {
  return (
    <div className="text-center">
      <Unlock className="w-20 h-20 text-green-500 mx-auto mb-4" />
      <h2 className="text-2xl font-bold mb-4 text-green-600">Accès autorisé!</h2>
      <p className="text-gray-600 mb-4">
        Votre compte wBTC est prêt
      </p>
      
      {/* SOLDES */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-6 rounded-lg mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Bitcoin className="w-5 h-5 text-orange-500" />
              <p className="text-sm text-gray-600">BTC Blockchain</p>
            </div>
            <p className="text-2xl font-bold text-gray-800">{btcBalance.toFixed(8)}</p>
          </div>
          
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Coins className="w-5 h-5 text-purple-600" />
              <p className="text-sm text-gray-600">wBTC Disponible</p>
            </div>
            <p className="text-2xl font-bold text-purple-600">{wbtcAvailable.toFixed(8)}</p>
          </div>
          
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Gamepad2 className="w-5 h-5 text-green-600" />
              <p className="text-sm text-gray-600">Parties Restantes</p>
            </div>
            <p className="text-2xl font-bold text-green-600">{Math.floor(wbtcAvailable / 0.000001)}</p>
          </div>
        </div>
        
        <div className="text-sm text-gray-600">
          <p>💰 Total dépensé : {wbtcSpentTotal.toFixed(8)} wBTC</p>
          <p className="mt-1">💎 Coût par partie : 0.000001 wBTC</p>
        </div>
      </div>

      <ErrorAlert error={error} />
      
      {/* BOUTONS PRINCIPAUX */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={onStartGame}
          className="bg-green-500 text-white px-8 py-4 rounded-lg font-semibold hover:bg-green-600 transition flex items-center justify-center gap-2"
        >
          <Gamepad2 className="w-5 h-5" />
          Jouer au Mini-Jeu
        </button>
        
        <button
          onClick={onSync}
          disabled={loading}
          className="bg-blue-500 text-white px-8 py-4 rounded-lg font-semibold hover:bg-blue-600 transition flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <Loader className="w-5 h-5 animate-spin" />
          ) : (
            <RefreshCw className="w-5 h-5" />
          )}
          Synchroniser
        </button>
      </div>
      
      {/* BOUTONS SECONDAIRES */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <button
          onClick={onShowHistory}
          className="bg-gray-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-gray-600 transition flex items-center justify-center gap-2"
        >
          <History className="w-5 h-5" />
          Historique
        </button>
        
        <button
          onClick={onShowStats}
          className="bg-gray-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-gray-600 transition flex items-center justify-center gap-2"
        >
          <TrendingUp className="w-5 h-5" />
          Statistiques
        </button>
      </div>
    </div>
  );
};

export default DashboardStep;