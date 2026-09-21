import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { ThirtyThreeBetaScreen } from './components/ThirtyThreeBetaScreen';
import { MarketsExplorerScreen } from './components/MarketsExplorerScreen';
import { MarketHomeScreen } from './components/MarketHomeScreen';
import { MarketLintScreen } from './components/MarketLintScreen';
import { CreateMarketScreen } from './components/CreateMarketScreen';
import { LaunchReadinessScreen } from './components/LaunchReadinessScreen';
import './index.css';

const pathname = window.location.pathname;
const isFastMarkets = pathname === '/33-beta' || pathname === '/beta';
const isMarketHome = pathname === '/' || pathname === '/markets';
const isMarketsExplorer = pathname === '/analytics';
const isMarketLint = pathname === '/marketlint';
const isCreateMarket = pathname === '/create';
const isLaunchReadiness = pathname === '/launch';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isFastMarkets ? (
      <ThirtyThreeBetaScreen />
    ) : isCreateMarket ? (
      <CreateMarketScreen />
    ) : isLaunchReadiness ? (
      <LaunchReadinessScreen />
    ) : isMarketLint ? (
      <MarketLintScreen />
    ) : isMarketsExplorer ? (
      <MarketsExplorerScreen />
    ) : isMarketHome ? (
      <MarketHomeScreen />
    ) : (
      <MarketHomeScreen />
    )}
  </StrictMode>,
);
