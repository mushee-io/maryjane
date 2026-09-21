import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ThirtyThreeBetaScreen } from './components/ThirtyThreeBetaScreen';
import { MarketsExplorerScreen } from './components/MarketsExplorerScreen';
import { MarketLintScreen } from './components/MarketLintScreen';
import { CreateMarketScreen } from './components/CreateMarketScreen';
import { LaunchReadinessScreen } from './components/LaunchReadinessScreen';
import './index.css';

const pathname = window.location.pathname;
const isThirtyThreeBeta = pathname === '/33-beta';
const isMarketsExplorer = pathname === '/markets' || pathname === '/analytics';
const isMarketLint = pathname === '/marketlint';
const isCreateMarket = pathname === '/create';
const isLaunchReadiness = pathname === '/launch';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isThirtyThreeBeta ? (
      <ThirtyThreeBetaScreen />
    ) : isCreateMarket ? (
      <CreateMarketScreen />
    ) : isLaunchReadiness ? (
      <LaunchReadinessScreen />
    ) : isMarketLint ? (
      <MarketLintScreen />
    ) : isMarketsExplorer ? (
      <MarketsExplorerScreen />
    ) : (
      <App />
    )}
  </StrictMode>,
);
