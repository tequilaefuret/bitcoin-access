// src/components/ui/ErrorAlert.jsx
import React from 'react';
import { AlertCircle, CheckCircle } from 'lucide-react';

const ErrorAlert = ({ error, success, className = '' }) => {
  if (!error && !success) return null;

  return (
    <div
      className={`border-l-4 p-4 mb-4 flex items-start gap-2 ${
        success
          ? 'bg-green-50 border-green-500'
          : 'bg-red-50 border-red-500'
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
            <p className="text-green-800 font-semibold">{success.title}</p>
            {success.message && (
              <p className="text-green-700">{success.message}</p>
            )}
          </div>
        ) : (
          <p className="text-red-800 whitespace-pre-line">{error}</p>
        )}
      </div>
    </div>
  );
};

export default ErrorAlert;