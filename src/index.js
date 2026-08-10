import React from 'react';
import ReactDOM from 'react-dom/client';
import { Buffer } from 'buffer';
import './index.css';
import App from './App';

if (!window.Buffer) window.Buffer = Buffer;

const root = ReactDOM.createRoot(document.getElementById('root'));
if (process.env.NODE_ENV === 'development') {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  root.render(<App />);
}
