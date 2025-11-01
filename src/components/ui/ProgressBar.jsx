// src/components/ui/ProgressBar.jsx
import React from 'react';

const ProgressBar = ({ currentStep }) => {
  const steps = [
    { id: 'connect', label: 'Connexion', number: 1 },
    { id: 'verify', label: 'Vérification', number: 2 },
    { id: 'authorized', label: 'Accès', number: 3 },
  ];

  const isStepActive = (stepId) => {
    if (currentStep === stepId) return true;
    if (currentStep === 'game' && stepId === 'authorized') return true;
    return false;
  };

  const isStepCompleted = (stepNumber) => {
    const currentStepNumber = steps.find(s => 
      s.id === currentStep || (currentStep === 'game' && s.id === 'authorized')
    )?.number || 1;
    return stepNumber < currentStepNumber;
  };

  return (
    <div className="flex items-center justify-between mb-8">
      {steps.map((step, index) => (
        <React.Fragment key={step.id}>
          <div
            className={`flex items-center gap-2 ${
              isStepActive(step.id)
                ? step.id === 'authorized' ? 'text-green-500' : 'text-orange-500'
                : isStepCompleted(step.number)
                ? 'text-gray-600'
                : 'text-gray-400'
            }`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center ${
                isStepActive(step.id)
                  ? step.id === 'authorized'
                    ? 'bg-green-500 text-white'
                    : 'bg-orange-500 text-white'
                  : isStepCompleted(step.number)
                  ? 'bg-gray-400 text-white'
                  : 'bg-gray-200'
              }`}
            >
              {step.number}
            </div>
            <span className="font-semibold hidden sm:inline">{step.label}</span>
          </div>
          {index < steps.length - 1 && (
            <div className="flex-1 h-1 bg-gray-200 mx-4"></div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default ProgressBar;