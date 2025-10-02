import React, { useState, useEffect } from 'react';
import { Wallet, Lock, Unlock, Bitcoin, Gamepad2, CheckCircle, AlertCircle, Loader } from 'lucide-react';

const BitcoinExclusiveAccess = () => {
  const [step, setStep] = useState('connect');
  const [address, setAddress] = useState('');
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [verificationStatus, setVerificationStatus] = useState('');
  const [score, setScore] = useState(0);
  const [gameActive, setGameActive] = useState(false);
  const [targetPosition, setTargetPosition] = useState({ x: 50, y: 50 });
  const [timeLeft, setTimeLeft] = useState(30);

  const challengeMessage = `Prouver la détention de cette adresse Bitcoin\nTimestamp: ${Date.now()}\nSite: superb-melba-0a81ac.netlify.app`;

  useEffect(() => {
    setMessage(challengeMessage);
  }, [challengeMessage]);

  const checkBitcoinBalance = async (btcAddress) => {
    try {
      setLoading(true);
      setError('');
      
      const response = await fetch(`https://blockchain.info/q/addressbalance/${btcAddress}`);
      
      if (!response.ok) {
        throw new Error('Adresse invalide ou problème de connexion');
      }
      
      const balanceSatoshis = await response.text();
      const balanceBTC = parseInt(balanceSatoshis) / 100000000;
      
      setBalance(balanceBTC);
      
      const minimumBTC = 0.001;
      
      if (balanceBTC >= minimumBTC) {
        setVerificationStatus('success');
        setStep('authorized');
        return true;
      } else {
        setError(`Solde insuffisant. Minimum requis: ${minimumBTC} BTC. Votre solde: ${balanceBTC} BTC`);
        setVerificationStatus('insufficient');
        return false;
      }
    } catch (err) {
      setError('Erreur lors de la vérification de l\'adresse: ' + err.message);
      setVerificationStatus('error');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const connectWallet = async () => {
    setLoading(true);
    setError('');
    
    setTimeout(() => {
      setLoading(false);
      setStep('verify');
    }, 1000);
  };

  const verifyAddress = async () => {
    if (!address) {
      setError('Veuillez entrer une adresse Bitcoin valide');
      return;
    }

    const btcAddressRegex = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/;
    if (!btcAddressRegex.test(address)) {
      setError('Format d\'adresse Bitcoin invalide');
      return;
    }

    await checkBitcoinBalance(address);
  };

  useEffect(() => {
    if (gameActive && timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    } else if (timeLeft === 0) {
      setGameActive(false);
    }
  }, [gameActive, timeLeft]);

  const moveTarget = () => {
    if (gameActive) {
      setScore(score + 1);
      setTargetPosition({
        x: Math.random() * 80 + 10,
        y: Math.random() * 70 + 10
      });
    }
  };

  const startGame = () => {
    setScore(0);
    setTimeLeft(30);
    setGameActive(true);
    setTargetPosition({
      x: Math.random() * 80 + 10,
      y: Math.random() * 70 + 10
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-500 via-yellow-500 to-orange-600 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-2xl p-8 mb-6">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Bitcoin className="w-10 h-10 text-orange-500" />
            <h1 className="text-4xl font-bold text-gray-800">Bitcoin Exclusive Access</h1>
          </div>
          <p className="text-center text-gray-600">
            Prouvez votre détention de Bitcoin pour accéder au contenu exclusif
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8 mb-6">
          <div className="flex items-center justify-between mb-8">
            <div className={`flex items-center gap-2 ${step === 'connect' ? 'text-orange-500' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === 'connect' ? 'bg-orange-500 text-white' : 'bg-gray-200'}`}>1</div>
              <span className="font-semibold">Connexion</span>
            </div>
            <div className="flex-1 h-1 bg-gray-200 mx-4"></div>
            <div className={`flex items-center gap-2 ${step === 'verify' ? 'text-orange-500' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === 'verify' ? 'bg-orange-500 text-white' : 'bg-gray-200'}`}>2</div>
              <span className="font-semibold">Vérification</span>
            </div>
            <div className="flex-1 h-1 bg-gray-200 mx-4"></div>
            <div className={`flex items-center gap-2 ${step === 'authorized' || step === 'game' ? 'text-green-500' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === 'authorized' || step === 'game' ? 'bg-green-500 text-white' : 'bg-gray-200'}`}>3</div>
              <span className="font-semibold">Accès</span>
            </div>
          </div>

          {step === 'connect' && (
            <div className="text-center">
              <Wallet className="w-20 h-20 text-orange-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-4">Connectez votre wallet Bitcoin</h2>
              <p className="text-gray-600 mb-6">
                Cliquez sur le bouton ci-dessous pour commencer le processus de vérification
              </p>
              <button
                onClick={connectWallet}
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
                    Connecter le Wallet
                  </>
                )}
              </button>
            </div>
          )}

          {step === 'verify' && (
            <div>
              <Lock className="w-20 h-20 text-orange-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-4 text-center">Vérification de votre adresse Bitcoin</h2>
              
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
                />
              </div>

              <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-4">
                <p className="text-sm text-blue-800">
                  <strong>Note:</strong> Pour une vérification complète avec signature, vous auriez besoin de signer le message suivant avec votre wallet:
                </p>
                <pre className="bg-white p-2 rounded mt-2 text-xs overflow-x-auto">
                  {message}
                </pre>
              </div>

              {error && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4 flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-red-800">{error}</p>
                </div>
              )}

              {verificationStatus === 'success' && (
                <div className="bg-green-50 border-l-4 border-green-500 p-4 mb-4 flex items-start gap-2">
                  <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-green-800 font-semibold">Vérification réussie!</p>
                    <p className="text-green-700">Solde: {balance} BTC</p>
                  </div>
                </div>
              )}

              <button
                onClick={verifyAddress}
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
                    Vérifier l'adresse
                  </>
                )}
              </button>
            </div>
          )}

          {step === 'authorized' && (
            <div className="text-center">
              <Unlock className="w-20 h-20 text-green-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-4 text-green-600">Accès autorisé!</h2>
              <p className="text-gray-600 mb-2">
                Votre adresse a été vérifiée avec succès
              </p>
              <p className="text-lg font-semibold text-gray-800 mb-6">
                Solde: {balance} BTC
              </p>
              <button
                onClick={() => setStep('game')}
                className="bg-green-500 text-white px-8 py-4 rounded-lg font-semibold hover:bg-green-600 transition flex items-center gap-2 mx-auto"
              >
                <Gamepad2 className="w-5 h-5" />
                Accéder au Mini-Jeu
              </button>
            </div>
          )}

          {step === 'game' && (
            <div>
              <Gamepad2 className="w-20 h-20 text-purple-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-4 text-center">🎮 Click Challenge</h2>
              
              <div className="bg-gray-100 rounded-lg p-6 mb-4">
                <div className="flex justify-between items-center mb-4">
                  <div className="text-xl font-bold">
                    Score: <span className="text-purple-600">{score}</span>
                  </div>
                  <div className="text-xl font-bold">
                    Temps: <span className="text-orange-600">{timeLeft}s</span>
                  </div>
                </div>

                {!gameActive ? (
                  <div className="text-center py-12">
                    <p className="text-gray-600 mb-4">
                      {score > 0 ? `Votre score final: ${score} points!` : 'Cliquez sur les cibles qui apparaissent le plus rapidement possible!'}
                    </p>
                    <button
                      onClick={startGame}
                      className="bg-purple-500 text-white px-8 py-3 rounded-lg font-semibold hover:bg-purple-600 transition"
                    >
                      {score > 0 ? 'Rejouer' : 'Démarrer le jeu'}
                    </button>
                  </div>
                ) : (
                  <div className="relative bg-white rounded-lg h-80 border-4 border-purple-300 overflow-hidden">
                    <div
                      onClick={moveTarget}
                      className="absolute w-16 h-16 bg-gradient-to-br from-orange-400 to-red-500 rounded-full cursor-pointer transform hover:scale-110 transition shadow-lg flex items-center justify-center text-2xl"
                      style={{
                        left: `${targetPosition.x}%`,
                        top: `${targetPosition.y}%`,
                        transform: 'translate(-50%, -50%)'
                      }}
                    >
                      🎯
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => setStep('authorized')}
                className="w-full bg-gray-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-gray-600 transition"
              >
                Retour
              </button>
            </div>
          )}
        </div>

        <div className="text-center text-white text-sm">
          <p>🔒 Plateforme sécurisée - Vos clés privées ne sont jamais partagées</p>
        </div>
      </div>
    </div>
  );
};

export default BitcoinExclusiveAccess;