// src/components/ui/EnvIndicator.jsx
import React from 'react';

const EnvIndicator = () => {
  const env = process.env.REACT_APP_ENVIRONMENT || 'development';
  
  // Ne pas afficher en production
  if (env === 'production') return null;
  
  return (
    <div className="fixed top-4 right-4 z-50">
      <div className="bg-yellow-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
        <span className="w-3 h-3 bg-white rounded-full animate-pulse"></span>
        <span className="font-bold text-sm">
          {env.toUpperCase()} MODE
        </span>
      </div>
    </div>
  );
};

export default EnvIndicator;