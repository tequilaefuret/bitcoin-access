// src/components/steps/DashboardStep.jsx
import React from 'react';
import { Bitcoin, Coins, Gamepad2, MessageSquare, History, TrendingUp, RefreshCw, Loader } from 'lucide-react';
import ErrorAlert from '../ui/ErrorAlert';

const DashboardStep = ({ 
  btcBalance,
  wbtcAvailable,
  wbtcSpentTotal,
  onStartGame,
  onPublishMessage,
  onStartCanvas,
  isTestMode,
  onSync,
  onShowHistory,
  onShowStats,
  loading,
  error
}) => {
  return (
    <div className="text-center">      
      {/* SOLDES */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 p-6 rounded-lg mb-6">
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
              <Coins className="w-5 h-5 text-green-600" />
              <p className="text-sm text-gray-600">wBTC Dépensé</p>
            </div>
            <p className="text-2xl font-bold text-green-600">{wbtcSpentTotal.toFixed(8)}</p>
          </div>
        </div>
      </div>

      <ErrorAlert error={error} />
      
      {/* SECTION SERVICES DISPONIBLES */}
      <div className="mb-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4">📱 Services disponibles</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* SERVICE 1 : Mini-Jeu */}
          <button
            onClick={onStartGame}
            className="bg-gradient-to-br from-green-400 to-green-600 text-white p-6 rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
          >
            <Gamepad2 className="w-12 h-12 mx-auto mb-3" />
            <h4 className="font-bold text-lg mb-2">Mini-Jeu</h4>
            <p className="text-sm opacity-90">
              Testez votre réactivité en cliquant sur les cibles
            </p>
            <div className="mt-3 text-xs bg-white/20 rounded-lg py-1 px-3 inline-block">
              💎 0.000001 wBTC par partie
            </div>
          </button>

          {/* SERVICE 2 : Réseau Social */}
          <button
            onClick={onPublishMessage}
            className="bg-gradient-to-br from-blue-400 to-blue-600 text-white p-6 rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
          >
            <MessageSquare className="w-12 h-12 mx-auto mb-3" />
            <h4 className="font-bold text-lg mb-2">Réseau Social</h4>
            <p className="text-sm opacity-90">
              Publiez des messages, 1 satoshi par caractère
            </p>
            <div className="mt-3 text-xs bg-white/20 rounded-lg py-1 px-3 inline-block">
              💰 Paiement au caractère
            </div>
          </button>

          {/* Canvas Collaboratif */}
          <button
            onClick={isTestMode ? undefined : onStartCanvas}
            disabled={isTestMode}
            className={`p-6 rounded-xl shadow-lg transition-all duration-200 ${
              isTestMode
                ? 'bg-gray-300 cursor-not-allowed opacity-60'
                : 'bg-gradient-to-br from-orange-400 to-purple-600 text-white hover:shadow-xl hover:scale-105'
            }`}
          >
            <div className="w-12 h-12 mx-auto mb-3 flex items-center justify-center">
              🎨
            </div>
            <h4 className="font-bold text-lg mb-2">Canvas Collaboratif</h4>
            <p className="text-sm opacity-90">
              {isTestMode 
                ? 'Connexion wallet requise' 
                : 'Peignez pixel par pixel'}
            </p>
            <div className="mt-3 text-xs bg-white/20 rounded-lg py-1 px-3 inline-block">
              💰 1 sat par pixel
            </div>
            {isTestMode && (
              <div className="mt-2 text-xs bg-red-500/20 rounded-lg py-1 px-2">
                ⚠️ Mode test non disponible
              </div>
            )}
          </button>
          
        </div>
      </div>

      {/* SECTION FONCTIONNALITÉS */}
      <div>
        <h3 className="text-lg font-semibold text-gray-700 mb-3">⚙️ Fonctionnalités</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          
          <button
            onClick={onSync}
            disabled={loading}
            className="bg-blue-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-600 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <Loader className="w-5 h-5 animate-spin" />
            ) : (
              <RefreshCw className="w-5 h-5" />
            )}
            Synchroniser
          </button>

          <button
            onClick={onShowHistory}
            className="bg-gray-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-gray-600 transition flex items-center justify-center gap-2"
          >
            <History className="w-5 h-5" />
            Mes messages
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
    </div>
  );
};

export default DashboardStep;