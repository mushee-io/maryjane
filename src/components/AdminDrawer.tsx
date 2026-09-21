import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Sliders,
  BarChart3,
  RefreshCw,
  Zap,
  Shield,
  Bell,
  CheckCircle2,
  AlertCircle,
  Save,
  Users,
  Search,
  PlusCircle,
  MinusCircle,
  FileText
} from 'lucide-react';
import { AdminConfig, AnalyticsSummary, User } from '../types';

interface AdminDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigSaved: () => void;
  onResetUserCooldown: () => Promise<void>;
}

export const AdminDrawer: React.FC<AdminDrawerProps> = ({
  isOpen,
  onClose,
  onConfigSaved,
  onResetUserCooldown,
}) => {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [activeTab, setActiveTab] = useState<'config' | 'analytics' | 'users'>('config');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [resetMessage, setResetMessage] = useState('');

  // User search & manual adjustment state
  const [userQuery, setUserQuery] = useState('');
  const [searchedUsers, setSearchedUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [adjustmentAmount, setAdjustmentAmount] = useState<string>('1.0');
  const [adjustmentReason, setAdjustmentReason] = useState<string>('');
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [adjustSuccess, setAdjustSuccess] = useState<string | null>(null);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchAdminData();
    }
  }, [isOpen]);

  const fetchAdminData = async () => {
    try {
      const [configRes, analyticsRes, usersRes] = await Promise.all([
        fetch('/api/admin/config'),
        fetch('/api/analytics'),
        fetch('/api/admin/users?q='),
      ]);
      if (configRes.ok) {
        const c = await configRes.json();
        setConfig(c);
      }
      if (analyticsRes.ok) {
        const a = await analyticsRes.json();
        setAnalytics(a);
      }
      if (usersRes.ok) {
        const u = await usersRes.json();
        setSearchedUsers(u.users || []);
        if (u.users && u.users.length > 0 && !selectedUser) {
          setSelectedUser(u.users[0]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch admin data:', err);
    }
  };

  const handleSearchUsers = async (q: string) => {
    setUserQuery(q);
    try {
      const res = await fetch(`/api/admin/users?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchedUsers(data.users || []);
      }
    } catch (err) {
      console.error('Search users error:', err);
    }
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setSaveSuccess(true);
        onConfigSaved();
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    } catch (err) {
      console.error('Error saving admin config:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyAdjustment = async () => {
    if (!selectedUser) return;
    if (!adjustmentReason.trim() || adjustmentReason.trim().length < 5) {
      setAdjustError('A detailed reason (min 5 characters) is required for audit logs.');
      return;
    }
    const num = Number(adjustmentAmount);
    if (isNaN(num) || num === 0) {
      setAdjustError('Please specify a valid non-zero adjustment amount.');
      return;
    }

    setIsAdjusting(true);
    setAdjustError(null);
    setAdjustSuccess(null);

    try {
      const res = await fetch('/api/admin/adjust-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: selectedUser.id,
          amount: num,
          reason: adjustmentReason.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAdjustSuccess(`Adjusted ${num > 0 ? '+' : ''}${num} PTS. New balance: ${data.newBalance} PTS.`);
        setAdjustmentReason('');
        fetchAdminData();
        setTimeout(() => setAdjustSuccess(null), 4000);
      } else {
        setAdjustError(data.error || 'Failed to adjust points.');
      }
    } catch {
      setAdjustError('Network error during points adjustment.');
    } finally {
      setIsAdjusting(false);
    }
  };

  const handleResetCooldown = async () => {
    await onResetUserCooldown();
    setResetMessage('Check-in cooldown reset to 0s! Check-in is available immediately.');
    setTimeout(() => setResetMessage(''), 3500);
  };

  if (!isOpen) return null;

  return (
    <div
      id="admin-drawer-backdrop"
      className="absolute inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fadeIn"
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="w-full max-w-lg max-h-[90vh] bg-[#FAF8F5] dark:bg-[#1C1A17] rounded-t-3xl sm:rounded-3xl border border-[#E5E1D8] dark:border-[#38332E] shadow-2xl flex flex-col overflow-hidden text-[#1E1B18] dark:text-[#EDE8E1]"
      >
        {/* Drawer Header */}
        <div className="p-4 border-b border-[#E5E1D8] dark:border-[#38332E] flex items-center justify-between bg-white dark:bg-[#201D1A]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#1E1B18] dark:text-[#FAF8F5]">
                Milady Admin Portal
              </h2>
              <p className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                Remote Config, Audit Ledger & Analytics
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-stone-200 dark:hover:bg-stone-800 text-[#78716C] dark:text-[#A8A29E] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-[#E5E1D8] dark:border-[#38332E] bg-[#EFECE6]/50 dark:bg-[#23201C]">
          <button
            onClick={() => setActiveTab('config')}
            className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'config'
                ? 'border-[#1E1B18] dark:border-[#EDE8E1] text-[#1E1B18] dark:text-[#FAF8F5] bg-white dark:bg-[#201D1A]'
                : 'border-transparent text-[#78716C] dark:text-[#A8A29E]'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Config</span>
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'users'
                ? 'border-[#1E1B18] dark:border-[#EDE8E1] text-[#1E1B18] dark:text-[#FAF8F5] bg-white dark:bg-[#201D1A]'
                : 'border-transparent text-[#78716C] dark:text-[#A8A29E]'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Users & Audit</span>
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'analytics'
                ? 'border-[#1E1B18] dark:border-[#EDE8E1] text-[#1E1B18] dark:text-[#FAF8F5] bg-white dark:bg-[#201D1A]'
                : 'border-transparent text-[#78716C] dark:text-[#A8A29E]'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Analytics</span>
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 p-5 overflow-y-auto space-y-5">
          {/* TAB 1: REMOTE CONFIG */}
          {activeTab === 'config' && config && (
            <div className="space-y-4">
              {/* Daily Reward Amount */}
              <div className="p-4 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] shadow-2xs">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-[#1E1B18] dark:text-[#FAF8F5]">
                    Daily Reward Points (PTS)
                  </label>
                  <span className="text-xs font-mono font-bold text-amber-600 dark:text-amber-400">
                    {config.daily_reward_points} PTS
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="5.0"
                  step="0.1"
                  value={config.daily_reward_points}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      daily_reward_points: parseFloat(e.target.value),
                      daily_reward_amount: parseFloat(e.target.value),
                    })
                  }
                  className="w-full accent-[#1E1B18] dark:accent-[#EDE8E1] cursor-pointer"
                />
                <p className="text-[11px] text-[#78716C] dark:text-[#A8A29E] mt-1">
                  Adjust points credited without releasing a new APK build.
                </p>
              </div>

              {/* Maintenance & Check-in Toggles */}
              <div className="p-4 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-[#1E1B18] dark:text-[#FAF8F5] block">
                      Enable Daily Check-in
                    </span>
                    <span className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                      Master switch for daily claims
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.checkin_enabled}
                    onChange={(e) =>
                      setConfig({ ...config, checkin_enabled: e.target.checked })
                    }
                    className="w-4 h-4 accent-[#1E1B18] dark:accent-[#EDE8E1] cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#E5E1D8] dark:border-[#38332E]">
                  <div>
                    <span className="text-xs font-bold text-rose-600 dark:text-rose-400 block">
                      Maintenance Mode
                    </span>
                    <span className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                      Gracefully pause app operations
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.maintenance_mode}
                    onChange={(e) =>
                      setConfig({ ...config, maintenance_mode: e.target.checked })
                    }
                    className="w-4 h-4 accent-rose-600 cursor-pointer"
                  />
                </div>
              </div>

              {/* Test Cooldown Mode Switch */}
              <div className="p-4 rounded-2xl bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/30 shadow-2xs">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-bold text-xs">
                    <Zap className="w-3.5 h-3.5" />
                    <span>Fast Testing Mode (15s Cooldown)</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.test_cooldown_mode}
                    onChange={(e) =>
                      setConfig({ ...config, test_cooldown_mode: e.target.checked })
                    }
                    className="w-4 h-4 accent-amber-600 cursor-pointer"
                  />
                </div>
                <p className="text-[11px] text-amber-900/80 dark:text-amber-200/80 mb-3">
                  Sets the 24-hour eligibility cooldown down to 15 seconds for rapid streak testing.
                </p>
                <button
                  type="button"
                  onClick={handleResetCooldown}
                  className="w-full py-2 px-3 rounded-xl bg-[#1E1B18] dark:bg-[#FAF8F5] text-[#FAF8F5] dark:text-[#181614] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer hover:opacity-90 transition-opacity"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reset Current User Cooldown to 0s</span>
                </button>
                {resetMessage && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-2 text-center animate-fadeIn">
                    ✓ {resetMessage}
                  </p>
                )}
              </div>

              {/* Push Notification Message */}
              <div className="p-4 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] shadow-2xs">
                <label className="text-xs font-bold text-[#1E1B18] dark:text-[#FAF8F5] flex items-center gap-1.5 mb-2">
                  <Bell className="w-3.5 h-3.5" />
                  <span>Daily Push Notification Text</span>
                </label>
                <input
                  type="text"
                  value={config.notification_message}
                  onChange={(e) =>
                    setConfig({ ...config, notification_message: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-[#FAF8F5] dark:bg-[#181614] border border-[#E5E1D8] dark:border-[#38332E] text-xs focus:outline-none"
                />
              </div>

              {/* Save Button */}
              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={isSaving}
                className="w-full py-3 rounded-2xl bg-[#1E1B18] dark:bg-[#FAF8F5] text-[#FAF8F5] dark:text-[#181614] text-xs font-bold flex items-center justify-center gap-2 shadow-md hover:opacity-90 transition-opacity cursor-pointer"
              >
                {saveSuccess ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>Configuration Saved & Applied</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>{isSaving ? 'Saving Changes...' : 'Save Remote Config'}</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* TAB 2: USERS & AUDIT INSPECTION */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              {/* Search Bar */}
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-[#A8A29E]" />
                <input
                  type="text"
                  placeholder="Search user by email or name..."
                  value={userQuery}
                  onChange={(e) => handleSearchUsers(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] text-xs focus:outline-none"
                />
              </div>

              {/* User Selector List */}
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                {searchedUsers.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setSelectedUser(u)}
                    className={`w-full text-left p-2.5 rounded-xl border text-xs flex items-center justify-between transition-colors cursor-pointer ${
                      selectedUser?.id === u.id
                        ? 'border-[#1E1B18] dark:border-[#EDE8E1] bg-stone-200/50 dark:bg-stone-800'
                        : 'border-[#E5E1D8] dark:border-[#38332E] bg-white dark:bg-[#201D1A]'
                    }`}
                  >
                    <div>
                      <span className="font-bold block">{u.display_name}</span>
                      <span className="text-[10px] text-[#78716C] dark:text-[#A8A29E] font-mono">
                        {u.email}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="font-bold font-mono text-amber-600 dark:text-amber-400 block">
                        {u.points_balance} PTS
                      </span>
                      <span className="text-[10px] text-[#78716C] dark:text-[#A8A29E]">
                        🔥 {u.current_streak}d streak
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Selected User Inspection & Points Adjustment */}
              {selectedUser && (
                <div className="p-4 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] shadow-2xs space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-[#E5E1D8] dark:border-[#38332E]">
                    <div>
                      <span className="text-xs font-bold block">{selectedUser.display_name}</span>
                      <span className="text-[10px] text-[#78716C] dark:text-[#A8A29E] font-mono">
                        ID: {selectedUser.id}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                        {selectedUser.points_balance} PTS
                      </span>
                    </div>
                  </div>

                  <div className="text-xs font-bold text-[#1E1B18] dark:text-[#FAF8F5] flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-amber-500" />
                    <span>Audited Balance Adjustment</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-semibold text-[#78716C] dark:text-[#A8A29E] block mb-1">
                        Adjustment (+/- PTS)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={adjustmentAmount}
                        onChange={(e) => setAdjustmentAmount(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-xl bg-[#FAF8F5] dark:bg-[#181614] border border-[#E5E1D8] dark:border-[#38332E] text-xs font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-[#78716C] dark:text-[#A8A29E] block mb-1">
                        Quick Preset
                      </label>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setAdjustmentAmount('0.5')}
                          className="flex-1 py-1 text-[10px] rounded-lg bg-stone-100 dark:bg-stone-800 font-bold cursor-pointer"
                        >
                          +0.5
                        </button>
                        <button
                          type="button"
                          onClick={() => setAdjustmentAmount('5.0')}
                          className="flex-1 py-1 text-[10px] rounded-lg bg-stone-100 dark:bg-stone-800 font-bold cursor-pointer"
                        >
                          +5.0
                        </button>
                        <button
                          type="button"
                          onClick={() => setAdjustmentAmount('-1.0')}
                          className="flex-1 py-1 text-[10px] rounded-lg bg-rose-100 dark:bg-rose-900/30 text-rose-600 font-bold cursor-pointer"
                        >
                          -1.0
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-[#78716C] dark:text-[#A8A29E] block mb-1">
                      Mandatory Reason for Audit Log
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Compensated for ad playback timeout issue"
                      value={adjustmentReason}
                      onChange={(e) => setAdjustmentReason(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-xl bg-[#FAF8F5] dark:bg-[#181614] border border-[#E5E1D8] dark:border-[#38332E] text-xs"
                    />
                  </div>

                  {adjustError && (
                    <p className="text-[11px] text-rose-500 font-semibold">{adjustError}</p>
                  )}
                  {adjustSuccess && (
                    <p className="text-[11px] text-emerald-500 font-semibold">{adjustSuccess}</p>
                  )}

                  <button
                    type="button"
                    onClick={handleApplyAdjustment}
                    disabled={isAdjusting}
                    className="w-full py-2 rounded-xl bg-[#1E1B18] dark:bg-[#FAF8F5] text-[#FAF8F5] dark:text-[#181614] text-xs font-bold cursor-pointer hover:opacity-90 transition-opacity"
                  >
                    {isAdjusting ? 'Executing Audit...' : 'Commit Audited Adjustment'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: AGGREGATED ANALYTICS & RETENTION */}
          {activeTab === 'analytics' && analytics && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] shadow-2xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#A8A29E] dark:text-[#78716C] block">
                    Daily Active Users (DAU)
                  </span>
                  <span className="text-xl font-bold text-[#1E1B18] dark:text-[#FAF8F5]">
                    {analytics.activeToday}
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] shadow-2xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#A8A29E] dark:text-[#78716C] block">
                    Ad Completion Rate
                  </span>
                  <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                    {analytics.adCompletionRate}%
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] shadow-2xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#A8A29E] dark:text-[#78716C] block">
                    Points Issued Today
                  </span>
                  <span className="text-xl font-bold text-amber-600 dark:text-amber-400">
                    +{analytics.pointsIssuedToday} PTS
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] shadow-2xs">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#A8A29E] dark:text-[#78716C] block">
                    Average User Streak
                  </span>
                  <span className="text-xl font-bold text-[#1E1B18] dark:text-[#FAF8F5]">
                    🔥 {analytics.averageStreak} Days
                  </span>
                </div>
              </div>

              {/* Retention Metrics */}
              <div className="p-4 rounded-2xl bg-white dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] shadow-2xs space-y-3">
                <span className="text-xs font-bold text-[#1E1B18] dark:text-[#FAF8F5] block">
                  Cohort Retention Indicators
                </span>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#78716C] dark:text-[#A8A29E]">D1 Retention</span>
                  <span className="font-bold text-emerald-600">{analytics.d1Retention}%</span>
                </div>
                <div className="flex items-center justify-between text-xs pt-2 border-t border-[#E5E1D8] dark:border-[#38332E]">
                  <span className="text-[#78716C] dark:text-[#A8A29E]">D7 Retention</span>
                  <span className="font-bold text-emerald-600">{analytics.d7Retention}%</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
