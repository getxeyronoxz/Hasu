import {StrictMode, lazy, Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ApiKeyGate} from './components/ApiKeyGate.tsx';
import {CrashGuard} from './components/CrashGuard.tsx';
import './index.css';
import {applyStoredAccent} from './lib/accent.ts';

// Paint the remembered accent before the first frame; App re-applies the
// server setting once it loads.
applyStoredAccent();

// The desktop companion window loads the same bundle with ?mode=companion and
// renders only the character, without the app shell or key gate.
const CompanionApp = lazy(() => import('./companion/CompanionApp.tsx'));
const isCompanion = new URLSearchParams(location.search).get('mode') === 'companion';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashGuard>
    {isCompanion ? (
      <Suspense fallback={null}>
        <CompanionApp />
      </Suspense>
    ) : (
      <ApiKeyGate>
        <App />
      </ApiKeyGate>
    )}
    </CrashGuard>
  </StrictMode>,
);
