import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Bell, X } from 'lucide-react';

interface NotificationToastProps {
  message: string | null;
  onDismiss: () => void;
  onTap: () => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({
  message,
  onDismiss,
  onTap,
}) => {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      onDismiss();
    }, 6000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ y: -60, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -60, opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          className="absolute top-12 left-4 right-4 z-50 select-none cursor-pointer"
          onClick={onTap}
        >
          <div className="w-full p-3 rounded-2xl bg-white/95 dark:bg-[#24211E]/95 backdrop-blur-md border border-[#E5E1D8] dark:border-[#38332E] shadow-xl flex items-center justify-between gap-3 text-[#1E1B18] dark:text-[#EDE8E1]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-[#1E1B18] dark:bg-[#EDE8E1] text-[#FAF8F5] dark:text-[#181614] flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                M
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-[#A8A29E] dark:text-[#78716C]">
                    Milady Daily
                  </span>
                  <span className="text-[9px] text-stone-400">• now</span>
                </div>
                <p className="text-xs font-semibold text-[#1E1B18] dark:text-[#FAF8F5] truncate">
                  {message}
                </p>
              </div>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
              className="p-1 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
