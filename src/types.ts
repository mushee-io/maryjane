export type AccountStatus = 'active' | 'suspended' | 'deleted';
export type RewardTxType = 'daily_checkin' | 'admin_adjustment' | 'bonus' | 'streak_milestone';
export type RewardTxStatus = 'pending' | 'completed' | 'failed' | 'reversed';

export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  points_balance: number;
  current_streak: number;
  longest_streak: number;
  last_checkin_at: number | null; // Unix timestamp in ms
  onboarding_completed?: boolean;
  reminder_enabled: boolean;
  reminder_time: string; // e.g. "09:00"
  account_status?: AccountStatus;
  is_admin?: boolean;
  created_at: number;
  updated_at: number;
}

export interface RewardTransaction {
  id: string;
  user_id: string;
  reward_type: RewardTxType;
  type?: RewardTxType;
  amount: number;
  status: RewardTxStatus;
  idempotency_key?: string;
  related_checkin_id?: string;
  ad_unit_id?: string;
  metadata?: Record<string, any>;
  created_at: number;
  completed_at?: number;
}

export interface DailyCheckin {
  id: string;
  user_id: string;
  checkin_date?: string; // YYYY-MM-DD
  reward_amount: number;
  reward_status?: string;
  ad_reward_verified: boolean;
  ad_session_id?: string;
  ad_reward_reference?: string;
  checked_in_at: number;
  streak_count: number;
  created_at?: number;
}

export interface AdminConfig {
  daily_reward_points: number;
  daily_reward_amount?: number;
  checkin_interval_hours: number;
  test_cooldown_mode: boolean; // when true, cooldown is 15 seconds instead of 24h
  checkin_enabled: boolean;
  maintenance_mode: boolean;
  minimum_app_version: string;
  notification_message: string;
  admob_test_mode: boolean;
  admob_rewarded_unit_id: string;
  require_ad_completion: boolean;
  updated_at?: number;
}

export interface AnalyticsSummary {
  totalUsers: number;
  newUsersToday: number;
  activeToday: number;
  checkinClicks: number;
  adsStarted: number;
  adsCompleted: number;
  successfulCheckins: number;
  failedCheckins: number;
  pointsIssuedToday: number;
  totalPointsDistributed: number;
  averageStreak: number;
  retentionRate: number;
  d1Retention: number;
  d7Retention: number;
  adCompletionRate: number;
}

export interface CheckinEligibility {
  eligible: boolean;
  timeRemainingMs: number;
  nextEligibleAt: number;
  lastCheckinAt: number | null;
  currentStreak: number;
  rewardAmount: number;
  message?: string;
}

export interface AdSessionInitResponse {
  success: boolean;
  adSessionId: string;
  adUnitId: string;
  rewardAmount: number;
  minDurationSeconds: number;
  expiresAt: number;
  idempotencyKey?: string;
  error?: string;
}

export interface ClaimRewardResponse {
  success: boolean;
  rewardAmount: number;
  newBalance: number;
  newStreak: number;
  longestStreak?: number;
  transactionId: string;
  checkinId?: string;
  checkedInAt: number;
  nextEligibleAt: number;
  message: string;
  idempotentReplay?: boolean;
  error?: string;
}

export interface AdminAuditLog {
  id: string;
  admin_id: string;
  target_user_id?: string;
  action: string;
  reason: string;
  previous_state?: Record<string, any>;
  new_state?: Record<string, any>;
  created_at: number;
}
