// src/components/steps/GameStep.jsx
import React, { useState, useEffect } from 'react';
import { Gamepad2, Loader } from 'lucide-react';
import ErrorAlert from '../ui/ErrorAlert';

const GameStep = ({ 
  shellsAvailable,
  onStartGame,
  onBack,
  loading,
  error
}) => {
  const [score, setScore] = useState(0);
  const [gameActive, setGameActive] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const [targetPosition, setTargetPosition] = useState({ x: 50, y: 50 });

  // Timer du jeu
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

  const handleStartGame = async () => {
    const success = await onStartGame();
    
    if (success) {
      setScore(0);
      setTimeLeft(30);
      setGameActive(true);
      setTargetPosition({
        x: Math.random() * 80 + 10,
        y: Math.random() * 70 + 10
      });
    }
  };

  return (
    <div>
      <Gamepad2 className="w-20 h-20 text-purple-500 mx-auto mb-4" />
      <h2 className="text-2xl font-bold mb-4 text-center">🎯 Click Challenge</h2>
      
      <div className="bg-purple-50 p-4 rounded-lg mb-4 flex justify-between items-center">
        <p className="text-purple-800 font-semibold">
          💎 Balance: {shellsAvailable.toFixed(8)} shells
        </p>
        <p className="text-purple-600">
          🎮 {Math.floor(shellsAvailable / 0.000001)} games left
        </p>
      </div>

      <ErrorAlert error={error} />
      
      <div className="bg-gray-100 rounded-lg p-6 mb-4">
        <div className="flex justify-between items-center mb-4">
          <div className="text-xl font-bold">
            Score: <span className="text-purple-600">{score}</span>
          </div>
          <div className="text-xl font-bold">
            Time: <span className="text-orange-600">{timeLeft}s</span>
          </div>
        </div>

        {!gameActive ? (
          <div className="text-center py-12">
            <p className="text-gray-600 mb-4">
              {score > 0 
                ? `🎉 Final score: ${score} points!` 
                : 'Click the targets as fast as possible for 30 seconds!'}
            </p>
            {score === 0 && (
              <p className="text-sm text-purple-600 mb-4">
                💰 This game costs 0.000001 shells
              </p>
            )}
            <button
              onClick={handleStartGame}
              disabled={loading}
              className="bg-purple-500 text-white px-8 py-3 rounded-lg font-semibold hover:bg-purple-600 transition disabled:opacity-50 flex items-center gap-2 mx-auto"
            >
              {loading ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Preparing...
                </>
              ) : (
                <>
                  {score > 0 ? '🔄 Replay' : '▶️ Start'}
                </>
              )}
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
        onClick={onBack}
        className="w-full bg-gray-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-gray-600 transition"
      >
        ← Back to network
      </button>
    </div>
  );
};

export default GameStep;
