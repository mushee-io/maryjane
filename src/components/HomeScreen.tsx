import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Flame, Sparkles, Check, Clock, ShieldCheck, Play, ArrowUpRight, Zap } from 'lucide-react';
import { User, CheckinEligibility } from '../types';
import { MiladyLogo, MiladyMascot } from './MiladyLogo';

interface HomeScreenProps {
  user: User;
  eligibility: CheckinEligibility | null;
  onInitiateCheckIn: () => void;
  onNavigateToTab: (tab: 'home' | 'activity' | 'profile') => void;
  isLoading: boolean;
  testCooldownMode: boolean;
  onResetCooldown: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  user,
  eligibility,
  onInitiateCheckIn,
  onNavigateToTab,
  isLoading,
  testCooldownMode,
  onResetCooldown,
}) => {
  const [countdownText, setCountdownText] = useState('');
  const [isEligible, setIsEligible] = useState(true);

  useEffect(() => {
    if (!eligibility) return;

    const updateCountdown = () => {
      const now = Date.now();
      if (!eligibility.nextEligibleAt || eligibility.eligible) {
        setIsEligible(true);
        setCountdownText('');
        return;
      }

      const diff = eligibility.nextEligibleAt - now;
      if (diff <= 0) {
        setIsEligible(true);
        setCountdownText('');
      } else {
        setIsEligible(false);
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        if (hours > 0) {
          setCountdownText(`${hours}h ${minutes}m ${seconds}s`);
        } else {
          setCountdownText(`${minutes}m ${seconds}s`);
        }
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [eligibility]);

  const streakDays = Array.from({ length: 7 }, (_, i) => i + 1);
  const currentStreakMod = (user.current_streak % 7) || (user.current_streak > 0 ? 7 : 0);

  return (
    <div
      id="home-screen-content"
      className="flex-1 flex flex-col justify-between p-5 pb-6 text-[#1E1B18] dark:text-[#EDE8E1] select-none"
    >
      {/* Top App Header */}
      <header className="flex items-center justify-between pt-1 mb-6">
        <MiladyLogo size="md" />

        {/* Profile Avatar Button */}
        <button
          id="btn-header-profile"
          onClick={() => onNavigateToTab('profile')}
          className="flex items-center gap-2 p-1 pl-2.5 rounded-full bg-[#EFECE6] dark:bg-[#282522] border border-[#E2DDD3] dark:border-[#38332E] hover:border-[#D6D3D1] transition-all cursor-pointer shadow-2xs"
        >
          <div className="flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
            <Flame className="w-3.5 h-3.5 fill-current" />
            <span>{user.current_streak}</span>
          </div>
          <img
            src={user.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'}
            alt={user.display_name}
            className="w-7 h-7 rounded-full object-cover border border-[#D6D3D1] dark:border-[#44403C]"
          />
        </button>
      </header>

      {/* Main Core Stack */}
      <div className="flex flex-col gap-5 my-auto">
        {/* Main Points Card (Inspired by Aloe minimalism) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full rounded-3xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] p-6 shadow-xs flex flex-col items-center text-center relative overflow-hidden"
        >
          {/* Subtle background glow & mascot watermark */}
          <div className="absolute -right-4 -bottom-4 w-28 h-28 opacity-[0.07] dark:opacity-[0.09] pointer-events-none text-[#1E1B18] dark:text-[#FAF8F5]">
            <MiladyMascot />
          </div>
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-100/40 dark:bg-amber-900/10 rounded-full blur-2xl pointer-events-none" />

          <span className="text-xs font-semibold uppercase tracking-wider text-[#A8A29E] dark:text-[#78716C] mb-1">
            Your Points
          </span>

          {/* Big Points Number */}
          <div className="flex items-baseline justify-center gap-1.5 my-2">
            <h1 className="text-5xl font-bold tracking-tight text-[#1E1B18] dark:text-[#FAF8F5]">
              {user.points_balance.toFixed(1)}
            </h1>
            <span className="text-sm font-medium text-[#78716C] dark:text-[#A8A29E]">
              PTS
            </span>
          </div>

          {/* Streak Badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FAF8F5] dark:bg-[#282522] border border-[#E2DDD3] dark:border-[#38332E] text-xs font-semibold text-[#1E1B18] dark:text-[#EDE8E1] mt-1 shadow-2xs">
            <Flame className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
            <span>{user.current_streak} Day Streak</span>
          </div>

          {/* 7-Day Visual Mini Track */}
          <div className="w-full mt-6 pt-4 border-t border-[#F2EFE9] dark:border-[#2C2825] flex items-center justify-between px-1">
            {streakDays.map((day) => {
              const isPassed = day <= currentStreakMod;
              const isToday = day === currentStreakMod;
              return (
                <div key={day} className="flex flex-col items-center gap-1">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                      isPassed
                        ? 'bg-[#1E1B18] dark:bg-[#EDE8E1] text-[#FAF8F5] dark:text-[#181614] shadow-xs'
                        : 'bg-[#F2EFE9] dark:bg-[#282522] text-[#A8A29E] dark:text-[#78716C] border border-[#E2DDD3] dark:border-[#38332E]'
                    }`}
                  >
                    {isPassed ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : `D${day}`}
                  </div>
                  <span className="text-[9px] text-[#A8A29E] dark:text-[#78716C] font-medium">
                    +0.5
                  </span>
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* Check-In Action Section */}
        <div className="w-full flex flex-col items-center">
          {isEligible ? (
            /* Eligible State: Active CTA */
            <div className="w-full flex flex-col items-center gap-2.5">
              <button
                id="btn-main-checkin"
                disabled={isLoading}
                onClick={onInitiateCheckIn}
                className="w-full py-4 px-6 rounded-2xl bg-[#1E1B18] dark:bg-[#EDE8E1] hover:bg-[#2D2A26] dark:hover:bg-[#FFFFFF] text-[#FAF8F5] dark:text-[#181614] font-semibold text-base flex items-center justify-center gap-2.5 shadow-sm active:scale-[0.99] transition-all cursor-pointer group"
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                    <span>Loading AdMob Video...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current transition-transform group-hover:scale-110" />
                    <span>Check In (+0.5 Points)</span>
                  </>
                )}
              </button>

              <span className="text-xs text-[#78716C] dark:text-[#A8A29E] text-center font-medium">
                Watch a short ad to complete today's check-in.
              </span>
            </div>
          ) : (
            /* Completed Today State: Disabled + Countdown */
            <div className="w-full rounded-2xl bg-[#EFECE6] dark:bg-[#201D1A] border border-[#E2DDD3] dark:border-[#38332E] p-4 flex flex-col items-center text-center gap-2">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold text-sm">
                <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center border border-emerald-300 dark:border-emerald-800">
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                </div>
                <span>Checked in today</span>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-[#78716C] dark:text-[#A8A29E]">
                <Clock className="w-3.5 h-3.5" />
                <span>Come back tomorrow</span>
                {countdownText && (
                  <span className="font-mono font-semibold text-[#1E1B18] dark:text-[#EDE8E1] bg-white dark:bg-[#2C2825] px-2 py-0.5 rounded-md border border-[#D6D3D1] dark:border-[#44403C]">
                    {countdownText}
                  </span>
                )}
              </div>

              {/* Dev shortcut button for rapid multi-streak testing */}
              <button
                id="btn-dev-instant-reset"
                onClick={onResetCooldown}
                className="mt-1 text-[11px] text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
                title="Reset cooldown to test checking in again"
              >
                <Zap className="w-3 h-3" />
                <span>Test: Reset cooldown now</span>
              </button>
            </div>
          )}
        </div>

        {/* Security & Activity Quick Teaser */}
        <div className="w-full flex items-center justify-between px-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-[11px]">Server Verified Reward</span>
          </div>

          <button
            id="btn-view-activity-quick"
            onClick={() => onNavigateToTab('activity')}
            className="text-[11px] font-medium text-[#1E1B18] dark:text-[#EDE8E1] hover:underline flex items-center gap-0.5 cursor-pointer"
          >
            <span>View History</span>
            <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Bottom Subtext */}
      <footer className="pt-2 text-center text-[10px] text-[#A8A29E] dark:text-[#78716C]">
        Milady V1 • 1 daily check-in per user every 24h
      </footer>
    </div>
  );
};
