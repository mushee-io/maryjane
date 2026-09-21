import React from 'react';
import { motion } from 'motion/react';
import { Sparkles, CheckCircle2, History, TrendingUp, Award, Calendar } from 'lucide-react';
import { RewardTransaction, DailyCheckin } from '../types';

interface ActivityScreenProps {
  transactions: RewardTransaction[];
  checkins: DailyCheckin[];
  totalEarned: number;
  currentStreak: number;
}

export const ActivityScreen: React.FC<ActivityScreenProps> = ({
  transactions,
  checkins,
  totalEarned,
  currentStreak,
}) => {
  // Helper to format date groups
  const formatTimeGroup = (timestamp: number) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const isToday =
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();

    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear();

    if (isToday) return 'Today';
    if (isYesterday) return 'Yesterday';

    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };

  const formatExactTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      id="activity-screen-content"
      className="flex-1 flex flex-col p-5 pb-6 text-[#1E1B18] dark:text-[#EDE8E1] select-none overflow-y-auto"
    >
      {/* Header */}
      <header className="pt-1 mb-5">
        <h1 className="text-xl font-bold tracking-tight text-[#1E1B18] dark:text-[#FAF8F5]">
          Activity
        </h1>
        <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mt-0.5">
          Your daily check-in rewards & verified transactions
        </p>
      </header>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="p-4 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] shadow-2xs flex flex-col">
          <div className="flex items-center gap-1.5 text-xs text-[#78716C] dark:text-[#A8A29E] mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Total Earned</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-[#1E1B18] dark:text-[#FAF8F5]">
              +{totalEarned.toFixed(1)}
            </span>
            <span className="text-xs font-semibold text-[#A8A29E] dark:text-[#78716C]">
              PTS
            </span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] shadow-2xs flex flex-col">
          <div className="flex items-center gap-1.5 text-xs text-[#78716C] dark:text-[#A8A29E] mb-1">
            <Award className="w-3.5 h-3.5 text-amber-500" />
            <span>Check-ins</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-[#1E1B18] dark:text-[#FAF8F5]">
              {checkins.length}
            </span>
            <span className="text-xs font-semibold text-[#A8A29E] dark:text-[#78716C]">
              Completed
            </span>
          </div>
        </div>
      </div>

      {/* Reward History Timeline */}
      <section className="flex-1 flex flex-col">
        <div className="flex items-center justify-between mb-3 px-1">
          <span className="text-xs font-bold uppercase tracking-wider text-[#A8A29E] dark:text-[#78716C]">
            Reward History
          </span>
          <span className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">
            {transactions.length} events
          </span>
        </div>

        {transactions.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#EFECE6] dark:bg-[#282522] text-[#A8A29E] dark:text-[#78716C] flex items-center justify-center mb-3">
              <History className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-[#1E1B18] dark:text-[#EDE8E1]">
              No rewards yet
            </p>
            <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mt-1 max-w-xs">
              Complete your first daily check-in to start your streak and claim Milady Points.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {transactions.map((tx, idx) => {
              const checkinData = checkins.find((c) => Math.abs(c.checked_in_at - tx.created_at) < 5000);
              const groupLabel = formatTimeGroup(tx.created_at);
              const timeLabel = formatExactTime(tx.created_at);

              return (
                <motion.div
                  key={tx.id || idx}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: idx * 0.04 }}
                  className="p-3.5 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] shadow-2xs flex items-center justify-between hover:border-[#D6D3D1] transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#FAF8F5] dark:bg-[#282522] border border-[#E2DDD3] dark:border-[#38332E] text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                      <Sparkles className="w-4 h-4" />
                    </div>

                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#1E1B18] dark:text-[#FAF8F5]">
                          Daily Check-In
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 font-medium">
                          Ad Verified
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-[#78716C] dark:text-[#A8A29E] mt-0.5">
                        <span className="font-medium text-[#1E1B18] dark:text-[#EDE8E1]">
                          {groupLabel}
                        </span>
                        <span>•</span>
                        <span>{timeLabel}</span>
                        {checkinData && (
                          <>
                            <span>•</span>
                            <span className="text-amber-700 dark:text-amber-400 font-medium">
                              Streak Day {checkinData.streak_count}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-sm font-bold text-[#1E1B18] dark:text-[#FAF8F5]">
                      +{tx.amount.toFixed(1)}
                    </span>
                    <span className="block text-[10px] text-[#A8A29E] dark:text-[#78716C] font-mono">
                      {tx.id.substring(0, 8)}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
