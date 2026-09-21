import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import confetti from 'canvas-confetti';
import { Check, Sparkles, Flame, ArrowRight } from 'lucide-react';
import { MiladyMascot } from './MiladyLogo';

interface SuccessCelebrationProps {
  rewardAmount: number;
  newStreak: number;
  newBalance: number;
  onDismiss: () => void;
}

export const SuccessCelebration: React.FC<SuccessCelebrationProps> = ({
  rewardAmount,
  newStreak,
  newBalance,
  onDismiss,
}) => {
  useEffect(() => {
    // Fire festive confetti
    try {
      confetti({
        particleCount: 65,
        spread: 70,
        origin: { y: 0.55 },
        colors: ['#D97706', '#F59E0B', '#10B981', '#E5E7EB', '#059669', '#1E1B18'],
      });
    } catch {
      // ignore in headless / non-canvas environments
    }
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-6"
    >
      <motion.div
        initial={{ scale: 0.85, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="w-full max-w-xs rounded-3xl bg-[#FAF8F5] dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] p-6 text-center shadow-2xl flex flex-col items-center relative overflow-hidden"
      >
        {/* Animated Celebration Mascot Icon */}
        <div className="w-20 h-20 rounded-3xl bg-[#EFECE6] dark:bg-[#282522] border border-[#E2DDD3] dark:border-[#38332E] p-2 flex items-center justify-center mb-3 text-[#1E1B18] dark:text-[#EDE8E1] shadow-xs relative">
          <MiladyMascot animated className="w-full h-full object-contain" />
          <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-xs">
            <Check className="w-3.5 h-3.5 stroke-[3]" />
          </div>
        </div>

        <span className="text-xs font-bold uppercase tracking-wider text-[#A8A29E] dark:text-[#78716C] mb-1">
          Daily Check-in Complete
        </span>

        {/* Big Reward Text */}
        <h2 className="text-3xl font-bold tracking-tight text-[#1E1B18] dark:text-[#FAF8F5] my-1">
          +{rewardAmount} Points
        </h2>

        <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mb-5">
          Rewarded advertisement completed & validated securely.
        </p>

        {/* Streak & Balance Mini Pill Container */}
        <div className="w-full grid grid-cols-2 gap-2 mb-6">
          <div className="p-3 rounded-2xl bg-[#EFECE6] dark:bg-[#282522] border border-[#E2DDD3] dark:border-[#38332E] flex flex-col items-center">
            <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-bold text-xs">
              <Flame className="w-3.5 h-3.5 fill-current" />
              <span>{newStreak} Day</span>
            </div>
            <span className="text-[10px] text-[#A8A29E] dark:text-[#78716C] font-medium">
              Streak
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-[#EFECE6] dark:bg-[#282522] border border-[#E2DDD3] dark:border-[#38332E] flex flex-col items-center">
            <div className="flex items-center gap-1 text-[#1E1B18] dark:text-[#EDE8E1] font-bold text-xs">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>{newBalance}</span>
            </div>
            <span className="text-[10px] text-[#A8A29E] dark:text-[#78716C] font-medium">
              Total Points
            </span>
          </div>
        </div>

        {/* Continue Button */}
        <button
          id="btn-dismiss-celebration"
          onClick={onDismiss}
          className="w-full py-3.5 px-4 rounded-2xl bg-[#1E1B18] dark:bg-[#EDE8E1] text-[#FAF8F5] dark:text-[#181614] font-medium text-sm flex items-center justify-center gap-2 shadow-sm hover:opacity-95 active:scale-[0.99] transition-all cursor-pointer"
        >
          <span>Done</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </motion.div>
    </motion.div>
  );
};
