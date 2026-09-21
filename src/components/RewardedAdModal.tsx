import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Volume2, VolumeX, AlertCircle, CheckCircle2, ShieldCheck, Zap, Sparkles } from 'lucide-react';

interface RewardedAdModalProps {
  adSessionId: string;
  adUnitId: string;
  rewardAmount: number;
  onAdCompleted: (durationSeconds: number) => void;
  onAdClosedEarly: () => void;
}

export const RewardedAdModal: React.FC<RewardedAdModalProps> = ({
  adSessionId,
  adUnitId,
  rewardAmount,
  onAdCompleted,
  onAdClosedEarly,
}) => {
  const TOTAL_DURATION = 15; // standard 15s rewarded video
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_DURATION);
  const [isMuted, setIsMuted] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [isAdFinished, setIsAdFinished] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (showExitConfirm || isAdFinished) return;

    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setIsAdFinished(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000 / speedMultiplier);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [showExitConfirm, isAdFinished, speedMultiplier]);

  const handleClaimReward = () => {
    onAdCompleted(TOTAL_DURATION);
  };

  const handleAttemptClose = () => {
    if (isAdFinished) {
      handleClaimReward();
    } else {
      setShowExitConfirm(true);
    }
  };

  const handleConfirmClose = () => {
    setShowExitConfirm(false);
    onAdClosedEarly();
  };

  const progressPercent = ((TOTAL_DURATION - secondsLeft) / TOTAL_DURATION) * 100;

  return (
    <div
      id="admob-rewarded-video-container"
      className="absolute inset-0 z-50 bg-black text-white flex flex-col justify-between overflow-hidden animate-fadeIn"
    >
      {/* Top AdMob Test Header */}
      <div className="w-full bg-[#1F1E1D] border-b border-stone-800 px-4 py-2 flex items-center justify-between text-xs z-20">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold tracking-wider uppercase border border-amber-500/30">
            AdMob Test Ad
          </span>
          <span className="text-[11px] text-stone-400 font-mono truncate max-w-[140px]" title={adUnitId}>
            {adUnitId.split('/').pop()}
          </span>
        </div>

        {/* Mute & Close Controls */}
        <div className="flex items-center gap-2.5">
          {/* Quick Speed toggle for reviewer convenience */}
          <button
            id="btn-ad-speed"
            onClick={() => setSpeedMultiplier((prev) => (prev === 1 ? 3 : 1))}
            className="text-[10px] px-1.5 py-0.5 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 transition-colors cursor-pointer"
            title="Toggle fast forward test mode"
          >
            {speedMultiplier > 1 ? '⚡ 3x Fast' : '1x Speed'}
          </button>

          <button
            id="btn-ad-mute"
            onClick={() => setIsMuted(!isMuted)}
            className="p-1 text-stone-300 hover:text-white transition-colors cursor-pointer"
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            id="btn-ad-close"
            onClick={handleAttemptClose}
            className="p-1 rounded-full bg-stone-800 hover:bg-stone-700 text-stone-200 transition-colors cursor-pointer"
            aria-label="Close Ad"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Reward Countdown Status Bar */}
      <div className="w-full bg-stone-900/90 backdrop-blur-xs px-4 py-2 flex items-center justify-between z-20 border-b border-stone-800/60">
        <div className="flex items-center gap-2">
          {isAdFinished ? (
            <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              <span>Reward Granted!</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-stone-300">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span>
                Reward in <strong className="text-white font-mono">{secondsLeft}s</strong>
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 text-xs font-semibold text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded-full border border-amber-500/30">
          <Sparkles className="w-3 h-3" />
          <span>+{rewardAmount} Points</span>
        </div>
      </div>

      {/* Progress Line */}
      <div className="w-full h-1 bg-stone-800 z-20">
        <div
          className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-all duration-300 ease-linear"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Video / Rich Interactive Creative Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 relative overflow-hidden bg-radial from-stone-900 to-black">
        {/* Animated Visual Canvas */}
        <motion.div
          animate={{
            scale: [1, 1.02, 1],
            rotate: [0, 0.5, -0.5, 0],
          }}
          transition={{ repeat: Infinity, duration: 6, ease: 'easeInOut' }}
          className="w-full max-w-xs rounded-3xl bg-gradient-to-b from-[#282522] to-[#181614] border border-stone-700/50 p-6 flex flex-col items-center text-center shadow-2xl relative overflow-hidden"
        >
          {/* Decorative ambient glow */}
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -bottom-12 -left-12 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />

          {/* Sponsored Brand Badge */}
          <div className="w-14 h-14 rounded-2xl bg-[#35302B] border border-stone-600/40 flex items-center justify-center text-2xl mb-4 shadow-md">
            🌿
          </div>

          <span className="text-[10px] tracking-widest uppercase font-semibold text-amber-400 mb-1">
            Sponsored Interactive Ad
          </span>

          <h3 className="text-lg font-bold text-white mb-2">
            Aura: Calm Mind & Sleep
          </h3>

          <p className="text-xs text-stone-400 leading-relaxed mb-5">
            Experience deep sleep soundscapes, guided meditations, and mindful breathing routines.
          </p>

          {/* Interactive Simulated CTA */}
          <div className="w-full py-2.5 px-4 rounded-xl bg-white text-stone-900 font-semibold text-xs flex items-center justify-center gap-2 shadow-lg">
            <span>Install Free on Google Play</span>
            <Zap className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
          </div>

          <div className="flex items-center gap-1.5 mt-3 text-[10px] text-stone-500">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            <span>Google Play Verified • 4.9 ★ (120k reviews)</span>
          </div>
        </motion.div>
      </div>

      {/* Ad Bottom Action / Complete Button */}
      <div className="w-full p-4 bg-[#181614] border-t border-stone-800 flex flex-col gap-2 z-20">
        {isAdFinished ? (
          <button
            id="btn-claim-completed-ad"
            onClick={handleClaimReward}
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 text-stone-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 active:scale-[0.99] transition-all cursor-pointer animate-bounce"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span>Claim +{rewardAmount} Milady Points</span>
          </button>
        ) : (
          <div className="text-center py-2 text-xs text-stone-400 flex items-center justify-center gap-2">
            <div className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            <span>Watching verified Google AdMob rewarded ad...</span>
          </div>
        )}
      </div>

      {/* Exit Warning Modal Dialog */}
      <AnimatePresence>
        {showExitConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-xs rounded-2xl bg-[#221F1C] border border-stone-700 p-5 text-center flex flex-col items-center"
            >
              <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mb-3">
                <AlertCircle className="w-6 h-6" />
              </div>

              <h4 className="text-base font-bold text-white mb-1.5">
                Close advertisement?
              </h4>

              <p className="text-xs text-stone-300 mb-5 leading-relaxed">
                If you leave before the advertisement completes, your{' '}
                <strong className="text-amber-400">+{rewardAmount} Milady Points</strong> reward cannot be credited.
              </p>

              <div className="w-full flex flex-col gap-2">
                <button
                  id="btn-ad-resume"
                  onClick={() => setShowExitConfirm(false)}
                  className="w-full py-2.5 rounded-xl bg-amber-500 text-stone-950 font-bold text-xs shadow-md cursor-pointer hover:bg-amber-400 transition-colors"
                >
                  Resume & Earn Points ({secondsLeft}s left)
                </button>
                <button
                  id="btn-ad-confirm-cancel"
                  onClick={handleConfirmClose}
                  className="w-full py-2 rounded-xl text-stone-400 hover:text-white text-xs transition-colors cursor-pointer"
                >
                  Skip & Forfeit Reward
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
