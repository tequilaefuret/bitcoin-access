// src/components/ui/ErrorAlert.jsx
import React from 'react';
import { AlertCircle, CheckCircle } from 'lucide-react';

const ErrorAlert = ({ error, success, className = '' }) => {
  if (!error && !success) return null;

  return (
    <div
      className={`mb-4 flex items-start gap-2 rounded-2xl border p-4 text-sm ${
        success
          ? 'border-emerald-400/20 bg-emerald-400/10'
          : 'border-red-400/20 bg-red-400/10'
      } ${className}`}
    >
      {success ? (
        <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
      ) : (
        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
      )}
      <div>
        {success ? (
          <div>
            <p className="font-semibold text-emerald-200">{success.title}</p>
            {success.message && (
              <p className="text-emerald-300/70">{success.message}</p>
            )}
          </div>
        ) : (
          <p className="whitespace-pre-line text-red-200">{error}</p>
        )}
      </div>
    </div>
  );
};

export default ErrorAlert;
