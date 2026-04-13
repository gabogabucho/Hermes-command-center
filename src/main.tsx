import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { PinGate } from './components/PinGate';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PinGate>
      <App />
    </PinGate>
  </React.StrictMode>,
);
