// src/components/ui/StatsModal.jsx
import React from 'react';
import { X, TrendingUp, MessageSquare, DollarSign, BarChart3 } from 'lucide-react';

const StatsModal = ({ stats, onClose }) => {
  if (!stats) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <p className="text-center text-gray-600">Chargement des statistiques...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-orange-500" />
            Statistiques
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Soldes */}
        <div className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white p-4 rounded-lg mb-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-5 h-5" />
            <h3 className="font-semibold">Soldes</h3>
          </div>
          <div className="space-y-1 text-sm">
            <p>BTC : {stats.btc_balance.toFixed(8)}</p>
            <p>wBTC disponible : {stats.wbtc_available.toFixed(8)}</p>
            <p>wBTC dépensé : {stats.wbtc_spent_total.toFixed(8)}</p>
          </div>
        </div>

        {/* Statistiques messages */}
        <div className="bg-blue-50 p-4 rounded-lg mb-4">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="w-5 h-5 text-blue-600" />
            <h3 className="font-semibold text-blue-800">Messages publiés</h3>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Total de messages :</span>
              <span className="font-bold text-blue-600">{stats.total_messages}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Coût total :</span>
              <span className="font-bold text-blue-600">
                {stats.total_cost_messages?.toFixed(8) || '0.00000000'} wBTC
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Coût moyen/message :</span>
              <span className="font-bold text-blue-600">
                {stats.average_cost_per_message?.toFixed(8) || '0.00000000'} wBTC
              </span>
            </div>
          </div>
        </div>

        {/* Capacité restante */}
        <div className="bg-green-50 p-4 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-5 h-5 text-green-600" />
            <h3 className="font-semibold text-green-800">Capacité restante</h3>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Caractères disponibles :</span>
              <span className="font-bold text-green-600">
                {stats.characters_remaining?.toLocaleString() || '0'}
              </span>
            </div>
            <div className="text-sm text-gray-600 mt-2">
              <p>💡 1 caractère = 0.00000001 wBTC (1 satoshi)</p>
            </div>
          </div>
        </div>

        {/* Bouton fermer */}
        <button
          onClick={onClose}
          className="w-full mt-4 bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300 transition"
        >
          Fermer
        </button>
      </div>
    </div>
  );
};

export default StatsModal;