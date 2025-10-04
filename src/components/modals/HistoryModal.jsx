// src/components/modals/HistoryModal.jsx
import React from 'react';
import { History } from 'lucide-react';

const HistoryModal = ({ show, onClose, transactions }) => {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <History className="w-6 h-6" />
            Historique des transactions
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
          >
            ✕
          </button>
        </div>

        {transactions.length === 0 ? (
          <p className="text-center text-gray-500 py-8">
            Aucune transaction pour le moment
          </p>
        ) : (
          <div className="space-y-3">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className={`p-4 rounded-lg border-l-4 ${
                  tx.type === 'sync'
                    ? 'bg-blue-50 border-blue-500'
                    : 'bg-purple-50 border-purple-500'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-gray-800">
                      {tx.type === 'sync' ? '🔄 Synchronisation' : '🎮 Partie de jeu'}
                    </p>
                    <p className="text-sm text-gray-600">
                      {new Date(tx.created_at).toLocaleString('fr-FR')}
                    </p>
                  </div>
                  <p className={`font-bold ${
                    tx.amount >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(8)} wBTC
                  </p>
                </div>
                {tx.game_score !== null && (
                  <p className="text-sm text-gray-500 mt-1">
                    Score obtenu : {tx.game_score} points
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full mt-6 bg-gray-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-gray-600 transition"
        >
          Fermer
        </button>
      </div>
    </div>
  );
};

export default HistoryModal;