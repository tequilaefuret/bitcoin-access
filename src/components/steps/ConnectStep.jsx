// src/components/steps/ConnectStep.jsx
import React from 'react';
import { Wallet, Loader } from 'lucide-react';

const ConnectStep = ({ onConnect, loading }) => {
  return (
    <div className="text-center">
      <Wallet className="w-20 h-20 text-orange-500 mx-auto mb-4" />
      <h2 className="text-2xl font-bold mb-4">Connectez votre wallet Bitcoin</h2>
      <p className="text-gray-600 mb-6">
        Entrez votre adresse Bitcoin pour vérifier votre solde et créer votre compte wBTC
      </p>
      <button
        onClick={onConnect}
        disabled={loading}
        className="bg-orange-500 text-white px-8 py-4 rounded-lg font-semibold hover:bg-orange-600 transition flex items-center gap-2 mx-auto disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader className="w-5 h-5 animate-spin" />
            Connexion en cours...
          </>
        ) : (
          <>
            <Wallet className="w-5 h-5" />
            Commencer
          </>
        )}
      </button>
    </div>
  );
};

export default ConnectStep;