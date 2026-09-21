import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  User,
  CheckinEligibility,
  AdSessionInitResponse,
  ClaimRewardResponse,
} from '../types';

// Client-safe environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl && 
  supabaseAnonKey && 
  !supabaseUrl.includes('placeholder') &&
  !supabaseUrl.includes('YOUR_PROJECT_ID')
);

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) {
    return null;
  }
  if (!supabaseInstance) {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }
  return supabaseInstance;
}

/**
 * Milady Serverless API Client
 * Uses Supabase Edge Functions in production.
 * Gracefully falls back to local API proxy during development container runs.
 */
export const miladyEdgeApi = {
  async fetchUserProfile(token?: string): Promise<{ user: User | null; eligibility: CheckinEligibility | null; adminConfig?: any }> {
    const authHeader = token ? (token.startsWith('Bearer ') ? token : `Bearer ${token}`) : undefined;
    const supabase = getSupabaseClient();
    if (supabase && authHeader) {
      try {
        const { data, error } = await supabase.functions.invoke('user-profile', {
          headers: { Authorization: authHeader },
        });
        if (!error && data?.success) {
          return { user: data.user, eligibility: data.eligibility, adminConfig: data.adminConfig };
        }
      } catch {
        // fallback
      }
    }

    const headers: Record<string, string> = {};
    if (authHeader) headers['Authorization'] = authHeader;
    const res = await fetch('/api/user/me', { headers });
    if (res.ok) {
      const data = await res.json();
      return { user: data.user, eligibility: data.eligibility, adminConfig: data.adminConfig };
    }
    return { user: null, eligibility: null };
  },

  async initiateCheckin(userId: string, token?: string): Promise<AdSessionInitResponse> {
    const authHeader = token ? (token.startsWith('Bearer ') ? token : `Bearer ${token}`) : undefined;
    const supabase = getSupabaseClient();
    if (supabase && authHeader) {
      try {
        const { data, error } = await supabase.functions.invoke('initiate-checkin', {
          body: { userId },
          headers: { Authorization: authHeader },
        });
        if (!error && data) {
          return data as AdSessionInitResponse;
        }
      } catch {
        // fallback
      }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authHeader) headers['Authorization'] = authHeader;
    const res = await fetch('/api/checkin/initiate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ userId }),
    });
    return res.json();
  },

  async claimReward(payload: {
    userId: string;
    adSessionId: string;
    idempotencyKey: string;
    watchedDurationSeconds: number;
    userCancelled?: boolean;
    simulatedTestAdMobSsv?: boolean;
  }, token?: string): Promise<ClaimRewardResponse> {
    const authHeader = token ? (token.startsWith('Bearer ') ? token : `Bearer ${token}`) : undefined;
    const supabase = getSupabaseClient();
    if (supabase && authHeader) {
      try {
        const { data, error } = await supabase.functions.invoke('claim-checkin', {
          body: payload,
          headers: { Authorization: authHeader },
        });
        if (!error && data) {
          return data as ClaimRewardResponse;
        }
      } catch {
        // fallback
      }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authHeader) headers['Authorization'] = authHeader;
    const res = await fetch('/api/checkin/claim', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    return res.json();
  },
};
