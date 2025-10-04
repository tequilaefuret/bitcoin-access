// src/components/steps/VerifyStep.jsx
import React from 'react';
import { Lock, CheckCircle, Loader } from 'lucide-react';
import ErrorAlert from '../ui/ErrorAlert';

const VerifyStep = ({ 
  address, 
  setAddress, 
  onVerify, 
  loading, 
  error, 
  verificationStatus 
}) => {
  return (
    <div>
      <Lock className="w-20 h-20 text-orange-500 mx-auto mb-4" />
      <h2 className="text-2xl font-bold mb-4 text-center">
        Vérification de votre adresse Bitcoin
      </h2>
      
      <div className="bg-gray-50 p-4 rounded-lg mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Adresse Bitcoin
        </label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="bc1q... ou 1... ou 3..."
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
          onKeyPress={(e) => e.key === 'Enter' && onVerify()}
        />
      </div>

      <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-4">
        <p className="text-sm text-blue-800">
          <strong>ℹ️ Information :</strong> Pour une sécurité maximale, nous ajouterons bientôt 
          l'authentification par signature cryptographique (WalletConnect). 
          Pour l'instant, seul le solde est vérifié.
        </p>
      </div>

      <ErrorAlert error={error} />

      {verificationStatus === 'success' && (
        <ErrorAlert 
          success={{
            title: 'Vérification réussie!',
            message: 'Compte wBTC créé/synchronisé'
          }}
        />
      )}

      <button
        onClick={onVerify}
        disabled={loading || !address}
        className="w-full bg-orange-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-orange-600 transition flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader className="w-5 h-5 animate-spin" />
            Vérification en cours...
          </>
        ) : (
          <>
            <CheckCircle className="w-5 h-5" />
            Vérifier et créer mon compte wBTC
          </>
        )}
      </button>
    </div>
  );
};

export default VerifyStep;