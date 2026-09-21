import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  User as UserIcon,
  Bell,
  HelpCircle,
  Shield,
  FileText,
  Trash2,
  LogOut,
  ChevronRight,
  Flame,
  Sparkles,
  Award,
  Sliders,
  Check,
  AlertTriangle,
  Send,
  X
} from 'lucide-react';
import { User } from '../types';
import { MiladyMascot, MiladyIcon } from './MiladyLogo';

interface ProfileScreenProps {
  user: User;
  onUpdateNotifications: (enabled: boolean, time: string) => Promise<void>;
  onSignOut: () => void;
  onDeleteAccount: () => Promise<void>;
  onOpenAdmin: () => void;
  onTriggerTestNotification: () => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  user,
  onUpdateNotifications,
  onSignOut,
  onDeleteAccount,
  onOpenAdmin,
  onTriggerTestNotification,
}) => {
  const [reminderEnabled, setReminderEnabled] = useState(user.reminder_enabled ?? true);
  const [reminderTime, setReminderTime] = useState(user.reminder_time || '09:00');
  const [activeModal, setActiveModal] = useState<'faq' | 'privacy' | 'terms' | 'delete' | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleToggleReminder = async (checked: boolean) => {
    setReminderEnabled(checked);
    await onUpdateNotifications(checked, reminderTime);
  };

  const handleTimeChange = async (time: string) => {
    setReminderTime(time);
    await onUpdateNotifications(reminderEnabled, time);
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    await onDeleteAccount();
    setIsDeleting(false);
    setActiveModal(null);
  };

  return (
    <div
      id="profile-screen-content"
      className="flex-1 flex flex-col p-5 pb-6 text-[#1E1B18] dark:text-[#EDE8E1] select-none overflow-y-auto"
    >
      {/* Header */}
      <header className="pt-1 mb-5">
        <h1 className="text-xl font-bold tracking-tight text-[#1E1B18] dark:text-[#FAF8F5]">
          Profile
        </h1>
        <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mt-0.5">
          Account details, preferences, & settings
        </p>
      </header>

      {/* Google User Identity Card */}
      <div className="p-4 rounded-3xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] shadow-2xs flex items-center gap-3.5 mb-5">
        <img
          src={user.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'}
          alt={user.display_name}
          className="w-14 h-14 rounded-2xl object-cover border border-[#E2DDD3] dark:border-[#38332E] shadow-xs"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-base font-bold text-[#1E1B18] dark:text-[#FAF8F5] truncate">
              {user.display_name}
            </h2>
            {/* Google Badge */}
            <span className="shrink-0 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-[10px] font-semibold border border-blue-200 dark:border-blue-800/60">
              Google
            </span>
          </div>

          <p className="text-xs text-[#78716C] dark:text-[#A8A29E] truncate mt-0.5">
            {user.email}
          </p>

          <span className="text-[10px] text-[#A8A29E] dark:text-[#78716C] font-mono block mt-1">
            UID: {user.id}
          </span>
        </div>
      </div>

      {/* Stats Quad */}
      <div className="grid grid-cols-3 gap-2.5 mb-6">
        <div className="p-3 rounded-2xl bg-[#EFECE6] dark:bg-[#282522] border border-[#E2DDD3] dark:border-[#38332E] flex flex-col items-center text-center">
          <div className="flex items-center gap-1 text-[#1E1B18] dark:text-[#FAF8F5] font-bold text-base">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>{user.points_balance.toFixed(1)}</span>
          </div>
          <span className="text-[10px] text-[#78716C] dark:text-[#A8A29E] font-medium mt-0.5">
            Total Points
          </span>
        </div>

        <div className="p-3 rounded-2xl bg-[#EFECE6] dark:bg-[#282522] border border-[#E2DDD3] dark:border-[#38332E] flex flex-col items-center text-center">
          <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-bold text-base">
            <Flame className="w-3.5 h-3.5 fill-current" />
            <span>{user.current_streak}d</span>
          </div>
          <span className="text-[10px] text-[#78716C] dark:text-[#A8A29E] font-medium mt-0.5">
            Current
          </span>
        </div>

        <div className="p-3 rounded-2xl bg-[#EFECE6] dark:bg-[#282522] border border-[#E2DDD3] dark:border-[#38332E] flex flex-col items-center text-center">
          <div className="flex items-center gap-1 text-purple-700 dark:text-purple-400 font-bold text-base">
            <Award className="w-3.5 h-3.5" />
            <span>{user.longest_streak}d</span>
          </div>
          <span className="text-[10px] text-[#78716C] dark:text-[#A8A29E] font-medium mt-0.5">
            Best Streak
          </span>
        </div>
      </div>

      {/* Settings & Preferences Section */}
      <div className="flex flex-col gap-2 mb-6">
        <span className="text-xs font-bold uppercase tracking-wider text-[#A8A29E] dark:text-[#78716C] px-1">
          Preferences
        </span>

        {/* Daily Reminder Notification Card */}
        <div className="p-4 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] shadow-2xs flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-[#FAF8F5] dark:bg-[#282522] text-[#1E1B18] dark:text-[#EDE8E1] flex items-center justify-center">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-semibold text-[#1E1B18] dark:text-[#FAF8F5] block">
                  Daily Check-in Reminder
                </span>
                <span className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                  Receive 1 gentle reminder daily
                </span>
              </div>
            </div>

            {/* Switch */}
            <button
              id="switch-daily-reminder"
              onClick={() => handleToggleReminder(!reminderEnabled)}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                reminderEnabled ? 'bg-[#1E1B18] dark:bg-[#EDE8E1]' : 'bg-[#D6D3D1] dark:bg-[#44403C]'
              }`}
            >
              <div
                className={`bg-white dark:bg-[#181614] w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  reminderEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {reminderEnabled && (
            <div className="pt-2 border-t border-[#F2EFE9] dark:border-[#2C2825] flex items-center justify-between text-xs">
              <span className="text-[#78716C] dark:text-[#A8A29E]">Reminder Time</span>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={reminderTime}
                  onChange={(e) => handleTimeChange(e.target.value)}
                  className="px-2 py-1 rounded-lg bg-[#FAF8F5] dark:bg-[#282522] border border-[#E2DDD3] dark:border-[#38332E] text-xs font-semibold text-[#1E1B18] dark:text-[#EDE8E1] outline-none"
                />
                <button
                  id="btn-test-notification"
                  onClick={onTriggerTestNotification}
                  className="px-2 py-1 rounded-lg bg-[#FAF8F5] dark:bg-[#282522] border border-[#E2DDD3] dark:border-[#38332E] hover:bg-[#EFECE6] text-[11px] text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1 cursor-pointer"
                  title="Trigger simulation notification"
                >
                  <Send className="w-3 h-3" />
                  <span>Test Alert</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Legal, Help & Tools Menu */}
      <div className="flex flex-col gap-1.5 mb-6">
        <span className="text-xs font-bold uppercase tracking-wider text-[#A8A29E] dark:text-[#78716C] px-1 mb-1">
          Support & Legal
        </span>

        <button
          id="btn-open-faq"
          onClick={() => setActiveModal('faq')}
          className="p-3.5 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] hover:border-[#D6D3D1] flex items-center justify-between text-xs font-medium cursor-pointer transition-all"
        >
          <div className="flex items-center gap-3">
            <HelpCircle className="w-4 h-4 text-[#78716C] dark:text-[#A8A29E]" />
            <span>Help & FAQ</span>
          </div>
          <ChevronRight className="w-4 h-4 text-[#A8A29E] dark:text-[#78716C]" />
        </button>

        <button
          id="btn-open-privacy"
          onClick={() => setActiveModal('privacy')}
          className="p-3.5 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] hover:border-[#D6D3D1] flex items-center justify-between text-xs font-medium cursor-pointer transition-all"
        >
          <div className="flex items-center gap-3">
            <Shield className="w-4 h-4 text-[#78716C] dark:text-[#A8A29E]" />
            <span>Privacy Policy</span>
          </div>
          <ChevronRight className="w-4 h-4 text-[#A8A29E] dark:text-[#78716C]" />
        </button>

        <button
          id="btn-open-terms"
          onClick={() => setActiveModal('terms')}
          className="p-3.5 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] hover:border-[#D6D3D1] flex items-center justify-between text-xs font-medium cursor-pointer transition-all"
        >
          <div className="flex items-center gap-3">
            <FileText className="w-4 h-4 text-[#78716C] dark:text-[#A8A29E]" />
            <span>Terms of Service</span>
          </div>
          <ChevronRight className="w-4 h-4 text-[#A8A29E] dark:text-[#78716C]" />
        </button>

        <button
          id="btn-open-admin-drawer"
          onClick={onOpenAdmin}
          className="p-3.5 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] hover:border-[#D6D3D1] flex items-center justify-between text-xs font-medium cursor-pointer transition-all"
        >
          <div className="flex items-center gap-3">
            <Sliders className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span className="text-amber-700 dark:text-amber-400 font-semibold">
              Admin & Remote Config
            </span>
          </div>
          <ChevronRight className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        </button>
      </div>

      {/* App Mascot Brand Badge */}
      <div className="p-4 rounded-3xl bg-[#FAF8F5] dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] flex items-center gap-3 mb-6 shadow-2xs">
        <MiladyIcon size="md" />
        <div className="flex-1">
          <span className="font-serif-display text-lg text-[#1E1B18] dark:text-[#FAF8F5] leading-none block">
            Milady Daily Rewards
          </span>
          <span className="text-[10px] text-[#78716C] dark:text-[#A8A29E] mt-0.5 block">
            Version 1.0.0 • Hand-drawn simplicity
          </span>
        </div>
      </div>

      {/* Account Actions */}
      <div className="flex flex-col gap-2 mt-auto pt-2">
        <button
          id="btn-profile-signout"
          onClick={onSignOut}
          className="w-full py-3 px-4 rounded-2xl bg-[#FAF8F5] dark:bg-[#282522] border border-[#E2DDD3] dark:border-[#38332E] hover:bg-[#EFECE6] text-xs font-semibold text-[#1E1B18] dark:text-[#EDE8E1] flex items-center justify-center gap-2 cursor-pointer transition-all"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>

        <button
          id="btn-profile-delete"
          onClick={() => setActiveModal('delete')}
          className="w-full py-2.5 px-4 text-[11px] font-medium text-red-600 dark:text-red-400 hover:underline text-center cursor-pointer"
        >
          Delete Account & Personal Data
        </button>
      </div>

      {/* Modal Dialogs */}
      <AnimatePresence>
        {activeModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-5"
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              className="w-full max-w-sm rounded-3xl bg-[#FAF8F5] dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] p-5 shadow-2xl flex flex-col max-h-[80vh] overflow-y-auto"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-[#EFECE6] dark:border-[#2C2825]">
                <h3 className="text-base font-bold text-[#1E1B18] dark:text-[#FAF8F5]">
                  {activeModal === 'faq' && 'Help & FAQ'}
                  {activeModal === 'privacy' && 'Privacy Policy'}
                  {activeModal === 'terms' && 'Terms of Service'}
                  {activeModal === 'delete' && 'Delete Account'}
                </h3>
                <button
                  onClick={() => setActiveModal(null)}
                  className="p-1 rounded-full text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="text-xs text-[#57534E] dark:text-[#A8A29E] leading-relaxed space-y-3">
                {activeModal === 'faq' && (
                  <>
                    <div>
                      <strong className="text-[#1E1B18] dark:text-[#FAF8F5] block mb-0.5">
                        How does Milady daily check-in work?
                      </strong>
                      <p>
                        Open Milady once every 24 hours, tap Check In, and watch a brief verified Google AdMob rewarded advertisement to collect +0.5 Milady Points.
                      </p>
                    </div>

                    <div>
                      <strong className="text-[#1E1B18] dark:text-[#FAF8F5] block mb-0.5">
                        How do streaks work?
                      </strong>
                      <p>
                        Every consecutive daily check-in within 24 to 48 hours increments your daily streak by 1. If you miss your check-in period, the streak resets to 1 on your next claim.
                      </p>
                    </div>

                    <div>
                      <strong className="text-[#1E1B18] dark:text-[#FAF8F5] block mb-0.5">
                        Why are points verified server-side?
                      </strong>
                      <p>
                        All reward validation occurs strictly on backend servers to guarantee security and prevent device clock tampering.
                      </p>
                    </div>
                  </>
                )}

                {activeModal === 'privacy' && (
                  <>
                    <p>
                      <strong>Privacy Commitment:</strong> Milady collects minimal essential data necessary for in-app check-ins and Google account identity.
                    </p>
                    <p>
                      <strong>Data Collected:</strong> Google email address, display name, account avatar, check-in timestamps, and points ledger.
                    </p>
                    <p>
                      <strong>AdMob Data:</strong> Advertisements are served via official Google AdMob test/production SDKs complying with Google Play Privacy guidelines. No sensitive personal information is shared with advertisers.
                    </p>
                  </>
                )}

                {activeModal === 'terms' && (
                  <>
                    <p>
                      <strong>Milady Points Notice:</strong> Milady Points are solely non-monetary in-app reward points used within the Milady experience.
                    </p>
                    <p>
                      <strong>Non-Financial Asset:</strong> Milady Points are NOT cryptocurrency, tokens, investments, financial assets, cash, or tradable securities.
                    </p>
                    <p>
                      <strong>Usage:</strong> Strictly 1 verified check-in per user per 24-hour interval. Fraudulent or automated access may result in account termination.
                    </p>
                  </>
                )}

                {activeModal === 'delete' && (
                  <div className="flex flex-col items-center text-center gap-3 py-2">
                    <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 flex items-center justify-center">
                      <AlertTriangle className="w-6 h-6" />
                    </div>
                    <p className="text-xs text-[#1E1B18] dark:text-[#EDE8E1] font-medium">
                      Are you sure you want to permanently delete your Milady account?
                    </p>
                    <p className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                      All your Milady Points balance ({user.points_balance.toFixed(1)} PTS), streak records, and check-in history will be erased immediately.
                    </p>

                    <div className="w-full flex gap-2 mt-2">
                      <button
                        onClick={() => setActiveModal(null)}
                        className="flex-1 py-2.5 rounded-xl bg-[#EFECE6] dark:bg-[#282522] text-[#1E1B18] dark:text-[#EDE8E1] font-semibold text-xs cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        id="btn-confirm-delete-account"
                        disabled={isDeleting}
                        onClick={handleDeleteConfirm}
                        className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-semibold text-xs cursor-pointer hover:bg-red-700 transition-colors"
                      >
                        {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {activeModal !== 'delete' && (
                <button
                  onClick={() => setActiveModal(null)}
                  className="mt-5 w-full py-2.5 rounded-xl bg-[#1E1B18] dark:bg-[#EDE8E1] text-[#FAF8F5] dark:text-[#181614] font-semibold text-xs cursor-pointer"
                >
                  Close
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
