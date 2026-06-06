import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { AuthProvider } from './contexts/AuthContext.js';
import { NotificationProvider } from './contexts/NotificationContext.js';
import { App } from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('No #root element');
createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <NotificationProvider>
        <App />
      </NotificationProvider>
    </AuthProvider>
  </StrictMode>,
);
