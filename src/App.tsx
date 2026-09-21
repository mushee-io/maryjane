import React, { useState, useEffect, useCallback } from 'react';
import { Home, History, User as UserIcon, Flame, AlertCircle, WifiOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AndroidFrame } from './components/AndroidFrame';
import { OnboardingModal } from './components/OnboardingModal';
import { HomeScreen } from './components/HomeScreen';
import { ActivityScreen } from './components/ActivityScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { RewardedAdModal } from './components/RewardedAdModal';
import { SuccessCelebration } from './components/SuccessCelebration';
import { AdminDrawer } from './components/AdminDrawer';
import { NotificationToast } from './components/NotificationToast';
import { MiladyMascot } from './components/MiladyLogo';
import { analytics } from './lib/analytics';
import { crashReporter } from './lib/crashReporting';
import { offlineRewardQueue } from './lib/offlineQueue';
import { miladyEdgeApi } from './lib/supabase';
import { NativeAdMobService } from './lib/nativeAds';
import { NativeAuthService } from './lib/nativeAuth';
import {
  User,
  RewardTransaction,
  DailyCheckin,
  CheckinEligibility,
  AdSessionInitResponse,
  ClaimRewardResponse,
} from './types';

export default function App() {
  const [isDark, setIsDark] = useState(false);
  const [isDeviceView, setIsDeviceView] = useState(true);
  const [activeTab, setActiveTab] = useState<'home' | 'activity' | 'profile'>('home');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const [user, setUser] = useState<User | null>(null);
  const [eligibility, setEligibility] = useState<CheckinEligibility | null>(null);
  const [transactions, setTransactions] = useState<RewardTransaction[]>([]);
  const [checkins, setCheckins] = useState<DailyCheckin[]>([]);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [isAdLoading, setIsAdLoading] = useState(false);

  // Active AdMob ad state
  const [activeAdSession, setActiveAdSession] = useState<{
    sessionId: string;
    idempotencyKey?: string;
    adUnitId: string;
    rewardAmount: number;
  } | null>(null);

  // Success celebration state
  const [celebrationData, setCelebrationData] = useState<{
    rewardAmount: number;
    newStreak: number;
    newBalance: number;
  } | null>(null);

  // Notification simulation
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [testCooldownMode, setTestCooldownMode] = useState(false);

  // Toggle Dark Mode class on HTML document
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  // Initial user fetch
  const fetchUserData = useCallback(async () => {
    try {
      const storedToken = localStorage.getItem('milady_auth_token') || undefined;
      const data = await miladyEdgeApi.fetchUserProfile(storedToken);
      if (data.user) {
        setUser(data.user);
        setEligibility(data.eligibility);
        if (data.adminConfig) {
          setTestCooldownMode(!!data.adminConfig.test_cooldown_mode);
        }
        analytics.track('home_loaded', { points_balance: data.user.points_balance }, data.user.id);
      } else {
        setUser(null);
      }
    } catch (err: any) {
      crashReporter.reportError(err, { context: 'fetchUserData' });
    } finally {
      setIsLoadingUser(false);
    }
  }, []);

  // Fetch transactions & activity
  const fetchActivityData = useCallback(async () => {
    if (!user) return;
    try {
      const storedToken = localStorage.getItem('milady_auth_token') || `milady_session_${user.id}`;
      const res = await fetch('/api/activity', {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions || []);
        setCheckins(data.checkins || []);
      }
    } catch (err: any) {
      crashReporter.reportError(err, { context: 'fetchActivityData' });
    }
  }, [user]);

  // Online / Offline monitor & reward recovery queue trigger
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      analytics.track('online_restored', {}, user?.id);
      offlineRewardQueue.reconcile((result) => {
        if (result && result.newBalance !== undefined) {
          setUser((prev) =>
            prev ? { ...prev, points_balance: result.newBalance, current_streak: result.newStreak } : null
          );
          setCelebrationData({
            rewardAmount: result.rewardAmount,
            newStreak: result.newStreak,
            newBalance: result.newBalance,
          });
          fetchActivityData();
        }
      });
    };

    const handleOffline = () => {
      setIsOnline(false);
      analytics.track('offline_detected', {}, user?.id);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial check & mount telemetry
    analytics.track('app_opened', { userAgent: navigator.userAgent });

    // Initialize Native Services if running inside Capacitor Android
    if (NativeAdMobService.isNative()) {
      NativeAdMobService.initialize();
      NativeAuthService.initDeepLinkListener(() => {
        fetchUserData();
      });
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [user, fetchUserData, fetchActivityData]);

  useEffect(() => {
    fetchUserData();
  }, [fetchUserData]);

  useEffect(() => {
    if (user) {
      fetchActivityData();
    }
  }, [user, fetchActivityData]);

  // Tab switch telemetry
  const handleTabChange = (tab: 'home' | 'activity' | 'profile') => {
    setActiveTab(tab);
    if (tab === 'activity') {
      analytics.track('activity_viewed', {}, user?.id);
    }
  };

  // Google Sign-In handler
  const handleGoogleSignIn = async (email: string, displayName: string) => {
    setIsLoadingUser(true);
    analytics.track('signin_started', { email });
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, displayName }),
      });
      const data = await res.json();
      if (data.success && data.user) {
        localStorage.setItem('milady_auth_token', data.token);
        setUser(data.user);
        setEligibility(data.eligibility);
        analytics.track('signin_completed', { email }, data.user.id);
        setToastMessage(`Welcome to Milady, ${data.user.display_name}! ✨`);
      }
    } catch (err: any) {
      crashReporter.reportError(err, { context: 'handleGoogleSignIn' });
      setErrorMessage('Failed to connect with Google. Please try again.');
    } finally {
      setIsLoadingUser(false);
    }
  };

  // Check In -> Initiate Ad Session
  const handleInitiateCheckIn = async () => {
    if (!user) return;
    setIsAdLoading(true);
    setErrorMessage(null);
    analytics.track('checkin_clicked', { current_streak: user.current_streak }, user.id);
    analytics.track('rewarded_ad_requested', {}, user.id);

    try {
      const storedToken = localStorage.getItem('milady_auth_token') || `milady_session_${user.id}`;
      const data: AdSessionInitResponse = await miladyEdgeApi.initiateCheckin(user.id, storedToken);

      if (data.success && data.adSessionId) {
        analytics.track('rewarded_ad_started', { ad_unit: data.adUnitId }, user.id);
        const sessionPayload = {
          sessionId: data.adSessionId,
          idempotencyKey: data.idempotencyKey,
          adUnitId: data.adUnitId,
          rewardAmount: data.rewardAmount,
        };

        if (NativeAdMobService.isNative()) {
          setActiveAdSession(sessionPayload);
          const shown = await NativeAdMobService.loadAndShowRewardedAd({
            userId: user.id,
            adSessionId: data.adSessionId,
            adUnitId: data.adUnitId,
            onUserEarnedReward: () => {
              handleAdCompleted(15);
            },
            onAdDismissed: (completed) => {
              if (!completed) {
                handleAdClosedEarly();
              }
            },
            onAdFailedToShow: (err) => {
              setErrorMessage(err || 'Failed to display rewarded ad.');
              setActiveAdSession(null);
            },
          });
          if (shown) return;
        }

        setActiveAdSession(sessionPayload);
      } else {
        analytics.track('reward_claim_failed', { reason: data.error }, user.id);
        setErrorMessage(data.error || 'Check-in is currently unavailable.');
      }
    } catch (err: any) {
      crashReporter.reportError(err, { context: 'handleInitiateCheckIn' });
      setErrorMessage('Network connection lost. Please check connection and retry.');
    } finally {
      setIsAdLoading(false);
    }
  };

  // Rewarded Ad Completed -> Secure Server Claim with Offline Queue Reconciliation
  const handleAdCompleted = async (durationSeconds: number) => {
    if (!activeAdSession || !user) return;
    analytics.track('rewarded_ad_completed', { duration: durationSeconds }, user.id);
    analytics.track('reward_claim_started', {}, user.id);

    const idempotencyKey = activeAdSession.idempotencyKey || `claim_${user.id}_${Date.now()}`;

    // Queue for safety before network call
    offlineRewardQueue.enqueueClaim({
      idempotencyKey,
      adSessionId: activeAdSession.sessionId,
      watchedDurationSeconds: durationSeconds,
      timestamp: Date.now(),
      userId: user.id,
    });

    try {
      const storedToken = localStorage.getItem('milady_auth_token') || `milady_session_${user.id}`;
      
      // Attempt claim with support for test SSV simulation
      let data: ClaimRewardResponse = await miladyEdgeApi.claimReward(
        {
          userId: user.id,
          adSessionId: activeAdSession.sessionId,
          idempotencyKey,
          watchedDurationSeconds: durationSeconds,
          simulatedTestAdMobSsv: true,
        },
        storedToken
      );

      // Handle SSV delayed callback polling (up to 4 retries)
      if (!data.success && (data as any).status === 'REWARD_VERIFICATION_PENDING') {
        for (let attempt = 1; attempt <= 4; attempt++) {
          await new Promise((r) => setTimeout(r, 1500));
          data = await miladyEdgeApi.claimReward(
            {
              userId: user.id,
              adSessionId: activeAdSession.sessionId,
              idempotencyKey,
              watchedDurationSeconds: durationSeconds,
              simulatedTestAdMobSsv: true,
            },
            storedToken
          );
          if (data.success) break;
        }
      }

      if (data.success) {
        offlineRewardQueue.removeClaim(idempotencyKey);
        analytics.track(
          'reward_claim_completed',
          { reward_amount: data.rewardAmount, new_streak: data.newStreak },
          user.id
        );

        setUser((prev) =>
          prev
            ? {
                ...prev,
                points_balance: data.newBalance,
                current_streak: data.newStreak,
                longest_streak: Math.max(prev.longest_streak, data.newStreak),
                last_checkin_at: data.checkedInAt,
              }
            : null
        );

        setEligibility({
          eligible: false,
          timeRemainingMs: Math.max(0, data.nextEligibleAt - Date.now()),
          nextEligibleAt: data.nextEligibleAt,
          lastCheckinAt: data.checkedInAt,
          currentStreak: data.newStreak,
          rewardAmount: data.rewardAmount,
        });

        setActiveAdSession(null);
        setCelebrationData({
          rewardAmount: data.rewardAmount,
          newStreak: data.newStreak,
          newBalance: data.newBalance,
        });

        fetchActivityData();
      } else {
        analytics.track('reward_claim_failed', { reason: data.error }, user.id);
        setActiveAdSession(null);
        setErrorMessage(data.error || 'Reward validation failed.');
      }
    } catch (err: any) {
      crashReporter.reportError(err, { context: 'handleAdCompleted' });
      setActiveAdSession(null);
      setErrorMessage('Network drop detected. Your verified reward has been saved and will reconcile as soon as connection restores.');
    }
  };

  // Rewarded Ad Closed Early
  const handleAdClosedEarly = async () => {
    if (!activeAdSession || !user) return;
    analytics.track('reward_claim_failed', { reason: 'user_closed_ad_early' }, user.id);
    try {
      const storedToken = localStorage.getItem('milady_auth_token') || `milady_session_${user.id}`;
      await fetch('/api/checkin/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${storedToken}`,
        },
        body: JSON.stringify({
          userId: user.id,
          adSessionId: activeAdSession.sessionId,
          userCancelled: true,
        }),
      });
    } catch {
      // ignore
    }
    setActiveAdSession(null);
    setErrorMessage('Ad was closed before completion. Reward was cancelled.');
  };

  // Reset Cooldown for instant QA testing
  const handleResetCooldown = async () => {
    if (!user) return;
    try {
      const storedToken = localStorage.getItem('milady_auth_token') || `milady_session_${user.id}`;
      const res = await fetch('/api/admin/reset-cooldown', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${storedToken}`,
        },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (data.success && data.eligibility) {
        setEligibility(data.eligibility);
        setUser((prev) => (prev ? { ...prev, last_checkin_at: null } : null));
        setToastMessage('Cooldown reset! Check-in is ready.');
      }
    } catch (err: any) {
      crashReporter.reportError(err, { context: 'handleResetCooldown' });
    }
  };

  // Update notification settings
  const handleUpdateNotifications = async (enabled: boolean, time: string) => {
    if (!user) return;
    analytics.track('notification_enabled', { enabled, time }, user.id);
    try {
      const storedToken = localStorage.getItem('milady_auth_token') || `milady_session_${user.id}`;
      const res = await fetch('/api/user/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${storedToken}`,
        },
        body: JSON.stringify({ reminder_enabled: enabled, reminder_time: time }),
      });
      if (res.ok) {
        setUser((prev) =>
          prev ? { ...prev, reminder_enabled: enabled, reminder_time: time } : null
        );
      }
    } catch (err: any) {
      crashReporter.reportError(err, { context: 'handleUpdateNotifications' });
    }
  };

  // Sign out
  const handleSignOut = () => {
    localStorage.removeItem('milady_auth_token');
    setUser(null);
    setEligibility(null);
    setActiveTab('home');
  };

  // Delete account (GDPR / Google Play compliant)
  const handleDeleteAccount = async () => {
    if (!user) return;
    try {
      const storedToken = localStorage.getItem('milady_auth_token') || `milady_session_${user.id}`;
      await fetch('/api/user/account', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      handleSignOut();
      setToastMessage('Your account and data were completely deleted.');
    } catch (err: any) {
      crashReporter.reportError(err, { context: 'handleDeleteAccount' });
    }
  };

  const handleTriggerTestNotification = () => {
    setToastMessage('Your Milady check-in is ready ✨');
  };

  return (
    <AndroidFrame
      isDark={isDark}
      toggleDark={() => setIsDark(!isDark)}
      isDeviceView={isDeviceView}
      toggleDeviceView={() => setIsDeviceView(!isDeviceView)}
      onOpenAdmin={() => setIsAdminOpen(true)}
    >
      {/* Offline Alert Banner */}
      {!isOnline && (
        <div className="w-full bg-amber-500/90 text-stone-900 text-xs px-3 py-1.5 flex items-center justify-center gap-1.5 font-medium z-40">
          <WifiOff className="w-3.5 h-3.5" />
          <span>Offline mode • Rewards will sync once connection returns</span>
        </div>
      )}

      {/* Toast Notification Simulation */}
      <NotificationToast
        message={toastMessage}
        onDismiss={() => setToastMessage(null)}
        onTap={() => {
          setToastMessage(null);
          handleTabChange('home');
        }}
      />

      {/* Global Error Banner */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0 }}
            className="absolute top-12 left-4 right-4 z-40 p-3 rounded-2xl bg-red-50 dark:bg-red-950/80 border border-red-200 dark:border-red-800/80 text-red-700 dark:text-red-300 text-xs flex items-center justify-between shadow-lg"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 text-xs px-1 cursor-pointer"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main App Content Routing */}
      {isLoadingUser ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-3xl bg-[#FAF8F5] dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] p-2 text-[#1E1B18] dark:text-[#FAF8F5] flex items-center justify-center mb-3 shadow-sm">
            <MiladyMascot animated className="w-full h-full object-contain" />
          </div>
          <p className="text-xs text-[#78716C] dark:text-[#A8A29E] font-medium animate-pulse">
            Loading Milady...
          </p>
        </div>
      ) : !user ? (
        <OnboardingModal onSignIn={handleGoogleSignIn} isLoading={isLoadingUser} />
      ) : (
        <div className="flex-1 flex flex-col justify-between overflow-hidden relative">
          <div className="flex-1 flex flex-col overflow-y-auto relative">
            <AnimatePresence mode="wait">
              {activeTab === 'home' && (
                <motion.div
                  key="home"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.18 }}
                  className="flex-1 flex flex-col"
                >
                  <HomeScreen
                    user={user}
                    eligibility={eligibility}
                    onInitiateCheckIn={handleInitiateCheckIn}
                    onNavigateToTab={handleTabChange}
                    isLoading={isAdLoading}
                    testCooldownMode={testCooldownMode}
                    onResetCooldown={handleResetCooldown}
                  />
                </motion.div>
              )}

              {activeTab === 'activity' && (
                <motion.div
                  key="activity"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.18 }}
                  className="flex-1 flex flex-col"
                >
                  <ActivityScreen
                    transactions={transactions}
                    checkins={checkins}
                    totalEarned={transactions.reduce((acc, t) => acc + (t.amount || 0), 0)}
                    currentStreak={user.current_streak}
                  />
                </motion.div>
              )}

              {activeTab === 'profile' && (
                <motion.div
                  key="profile"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.18 }}
                  className="flex-1 flex flex-col"
                >
                  <ProfileScreen
                    user={user}
                    onUpdateNotifications={handleUpdateNotifications}
                    onSignOut={handleSignOut}
                    onDeleteAccount={handleDeleteAccount}
                    onOpenAdmin={() => setIsAdminOpen(true)}
                    onTriggerTestNotification={handleTriggerTestNotification}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Minimal 3-Tab Bottom Navigation Bar */}
          <nav
            id="bottom-navigation-bar"
            aria-label="Main Navigation"
            className="w-full px-6 py-3 bg-white/90 dark:bg-[#1C1A18]/90 backdrop-blur-md border-t border-[#E5E1D8] dark:border-[#38332E] flex items-center justify-around z-30 shrink-0 select-none shadow-xs"
          >
            <button
              id="tab-btn-home"
              onClick={() => handleTabChange('home')}
              className={`flex flex-col items-center gap-1 py-1 px-4 rounded-2xl transition-all cursor-pointer ${
                activeTab === 'home'
                  ? 'text-[#1E1B18] dark:text-[#EDE8E1] font-bold'
                  : 'text-[#A8A29E] dark:text-[#78716C] hover:text-[#57534E]'
              }`}
            >
              <Home className={`w-5 h-5 ${activeTab === 'home' ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
              <span className="text-[11px] tracking-tight">Home</span>
            </button>

            <button
              id="tab-btn-activity"
              onClick={() => handleTabChange('activity')}
              className={`flex flex-col items-center gap-1 py-1 px-4 rounded-2xl transition-all cursor-pointer ${
                activeTab === 'activity'
                  ? 'text-[#1E1B18] dark:text-[#EDE8E1] font-bold'
                  : 'text-[#A8A29E] dark:text-[#78716C] hover:text-[#57534E]'
              }`}
            >
              <History className={`w-5 h-5 ${activeTab === 'activity' ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
              <span className="text-[11px] tracking-tight">Activity</span>
            </button>

            <button
              id="tab-btn-profile"
              onClick={() => handleTabChange('profile')}
              className={`flex flex-col items-center gap-1 py-1 px-4 rounded-2xl transition-all cursor-pointer ${
                activeTab === 'profile'
                  ? 'text-[#1E1B18] dark:text-[#EDE8E1] font-bold'
                  : 'text-[#A8A29E] dark:text-[#78716C] hover:text-[#57534E]'
              }`}
            >
              <UserIcon className={`w-5 h-5 ${activeTab === 'profile' ? 'stroke-[2.5]' : 'stroke-[1.75]'}`} />
              <span className="text-[11px] tracking-tight">Profile</span>
            </button>
          </nav>
        </div>
      )}

      {/* Rewarded Ad Fullscreen Modal */}
      <AnimatePresence>
        {activeAdSession && (
          <RewardedAdModal
            adSessionId={activeAdSession.sessionId}
            adUnitId={activeAdSession.adUnitId}
            rewardAmount={activeAdSession.rewardAmount}
            onAdCompleted={handleAdCompleted}
            onAdClosedEarly={handleAdClosedEarly}
          />
        )}
      </AnimatePresence>

      {/* Success Celebration Bottom Sheet / Modal */}
      <AnimatePresence>
        {celebrationData && (
          <SuccessCelebration
            rewardAmount={celebrationData.rewardAmount}
            newStreak={celebrationData.newStreak}
            newBalance={celebrationData.newBalance}
            onDismiss={() => setCelebrationData(null)}
          />
        )}
      </AnimatePresence>

      {/* Admin Remote Config Drawer */}
      <AnimatePresence>
        {isAdminOpen && (
          <AdminDrawer
            isOpen={isAdminOpen}
            onClose={() => setIsAdminOpen(false)}
            onConfigSaved={() => {
              fetchUserData();
            }}
            onResetUserCooldown={handleResetCooldown}
          />
        )}
      </AnimatePresence>
    </AndroidFrame>
  );
}
