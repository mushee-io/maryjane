import './browserPolyfills';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { ThirtyThreeBetaScreen } from './components/ThirtyThreeBetaScreen';
import { MarketsExplorerScreen } from './components/MarketsExplorerScreen';
import { MarketHomeScreen } from './components/MarketHomeScreen';
import { MarketLintScreen } from './components/MarketLintScreen';
import { CreateMarketScreen } from './components/CreateMarketScreen';
import { LaunchReadinessScreen } from './components/LaunchReadinessScreen';
import { PortfolioScreen } from './components/PortfolioScreen';
import { FortyFourMiladyScreen } from './components/FortyFourMiladyScreen';
import { SeventySeventyScreen } from './components/SeventySeventyScreen';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './index.css';

const pathname = window.location.pathname;
const isFastMarkets = pathname === '/33-beta' || pathname === '/beta';
const isMarketHome = pathname === '/' || pathname === '/markets';
const isMarketsExplorer = pathname === '/analytics';
const isMarketLint = pathname === '/marketlint';
const isCreateMarket = pathname === '/create';
const isLaunchReadiness = pathname === '/launch';
const isPortfolio = pathname === '/portfolio' || pathname === '/positions';
const isFortyFourMilady = pathname === '/44-milady' || pathname === '/44milady';
const isSeventySeventy = pathname === '/7070';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
    {isFastMarkets ? (
      <ThirtyThreeBetaScreen />
    ) : isCreateMarket ? (
      <CreateMarketScreen />
    ) : isLaunchReadiness ? (
      <LaunchReadinessScreen />
    ) : isPortfolio ? (
      <PortfolioScreen />
    ) : isFortyFourMilady ? (
      <FortyFourMiladyScreen />
    ) : isSeventySeventy ? (
      <SeventySeventyScreen />
    ) : isMarketLint ? (
      <MarketLintScreen />
    ) : isMarketsExplorer ? (
      <MarketsExplorerScreen />
    ) : isMarketHome ? (
      <MarketHomeScreen />
    ) : (
      <MarketHomeScreen />
    )}
    </AppErrorBoundary>
  </StrictMode>,
);
