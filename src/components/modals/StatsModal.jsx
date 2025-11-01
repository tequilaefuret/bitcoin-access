// src/components/modals/StatsModal.jsx
import React from 'react';
import { TrendingUp, Bitcoin, Coins, Gamepad2 } from 'lucide-react';

const StatsModal = ({ show, onClose, stats }) => {
  if (!show || !stats) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <TrendingUp className="w-6 h-6" />
            Vos Statistiques
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-6 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Bitcoin className="w-6 h-6 text-orange-600" />
              <p className="text-sm text-gray-600">BTC Blockchain</p>
            </div>
            <p className="text-3xl font-bold text-gray-800">{stats.btc_balance.toFixed(8)}</p>
            <p className="text-sm text-gray-600 mt-1">Bitcoin</p>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-6 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Coins className="w-6 h-6 text-purple-600" />
              <p className="text-sm text-gray-600">wBTC Disponible</p>
            </div>
            <p className="text-3xl font-bold text-purple-600">{stats.wbtc_available.toFixed(8)}</p>
            <p className="text-sm text-gray-600 mt-1">Wrapped Bitcoin</p>
          </div>

          <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Gamepad2 className="w-6 h-6 text-blue-600" />
              <p className="text-sm text-gray-600">Parties Jouées</p>
            </div>
            <p className="text-3xl font-bold text-blue-600">{stats.total_games}</p>
            <p className="text-sm text-gray-600 mt-1">Total : {stats.wbtc_spent_total.toFixed(8)} wBTC</p>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-green-100 p-6 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-6 h-6 text-green-600" />
              <p className="text-sm text-gray-600">Meilleur Score</p>
            </div>
            <p className="text-3xl font-bold text-green-600">{stats.best_score}</p>
            <p className="text-sm text-gray-600 mt-1">Moyenne : {stats.average_score} pts</p>
          </div>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg mb-6">
          <div className="flex justify-between items-center">
            <span className="text-gray-600">Parties restantes :</span>
            <span className="text-2xl font-bold text-green-600">{stats.games_remaining}</span>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full bg-gray-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-gray-600 transition"
        >
          Fermer
        </button>
      </div>
    </div>
  );
};

export default StatsModal;