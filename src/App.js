import React, { useState } from 'react';
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';
import ProgressBar from './components/ui/ProgressBar';
import ConnectStep from './components/steps/ConnectStep';
import VerifyStep from './components/steps/VerifyStep';
import DashboardStep from './components/steps/DashboardStep';
import GameStep from './components/steps/GameStep';
import HistoryModal from './components/modals/HistoryModal';
import StatsModal from './components/modals/StatsModal';
import EnvIndicator from './components/ui/EnvIndicator';
import { useBitcoinBalance } from './hooks/useBitcoinBalance';

const BitcoinExclusiveAccess = () => {
  // État de navigation
  const [step, setStep] = useState('connect');
  
  // États des modals
  const [showHistory, setShowHistory] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [stats, setStats] = useState(null);

  // Hook personnalisé pour gérer la logique Bitcoin/wBTC
  const {
    address,
    btcBalance,
    wbtcAvailable,
    wbtcSpentTotal,
    loading,
    error,
    verificationStatus,
    setAddress,
    setError,
    checkBitcoinBalance,
    startGame,
    manualSync,
    loadHistory,
    loadStats,
    saveGameScore,
  } = useBitcoinBalance();

  // ===== HANDLERS =====

  const handleConnect = async () => {
    setError('');
    setTimeout(() => {
      setStep('verify');
    }, 1000);
  };

  const handleVerify = async () => {
    if (!address) {
      setError('Veuillez entrer une adresse Bitcoin valide');
      return;
    }

    const btcAddressRegex = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/;
    if (!btcAddressRegex.test(address)) {
      setError('Format d\'adresse Bitcoin invalide');
      return;
    }

    const success = await checkBitcoinBalance(address);
    if (success) {
      setStep('authorized');
    }
  };

  const handleStartGame = async () => {
    const success = await startGame();
    return success; // Retourner true/false pour GameStep
  };

  const handleShowHistory = async () => {
    const history = await loadHistory();
    setTransactions(history);
    setShowHistory(true);
  };

  const handleShowStats = async () => {
    const userStats = await loadStats();
    setStats(userStats);
    setShowStats(true);
  };

  const handleGameToPlay = () => {
    setError('');
    setStep('game');
  };

  const handleGameBack = () => {
    setError('');
    setStep('authorized');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-500 via-yellow-500 to-orange-600 p-4">
      {/* INDICATEUR D'ENVIRONNEMENT */}
      <EnvIndicator />
      
      <div className="max-w-4xl mx-auto">
        
        {/* EN-TÊTE */}
        <Header />

        {/* CONTENU PRINCIPAL */}
        <div className="bg-white rounded-2xl shadow-2xl p-8 mb-6">
          
          {/* BARRE DE PROGRESSION */}
          <ProgressBar currentStep={step} />

          {/* ÉTAPES */}
          {step === 'connect' && (
            <ConnectStep 
              onConnect={handleConnect}
              loading={loading}
            />
          )}

          {step === 'verify' && (
            <VerifyStep
              address={address}
              setAddress={setAddress}
              onVerify={handleVerify}
              loading={loading}
              error={error}
              verificationStatus={verificationStatus}
            />
          )}

          {step === 'authorized' && (
            <DashboardStep
              btcBalance={btcBalance}
              wbtcAvailable={wbtcAvailable}
              wbtcSpentTotal={wbtcSpentTotal}
              onStartGame={handleGameToPlay}
              onSync={manualSync}
              onShowHistory={handleShowHistory}
              onShowStats={handleShowStats}
              loading={loading}
              error={error}
            />
          )}

          {step === 'game' && (
            <GameStep
              wbtcAvailable={wbtcAvailable}
              onStartGame={handleStartGame}
              onUpdateScore={saveGameScore}
              onBack={handleGameBack}
              loading={loading}
              error={error}
            />
          )}
        </div>

        {/* MODALS */}
        <HistoryModal
          show={showHistory}
          onClose={() => setShowHistory(false)}
          transactions={transactions}
        />

        <StatsModal
          show={showStats}
          onClose={() => setShowStats(false)}
          stats={stats}
        />

        {/* PIED DE PAGE */}
        <Footer />
      </div>
    </div>
  );
};

export default BitcoinExclusiveAccess;