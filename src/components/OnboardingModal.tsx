import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, PlayCircle, Flame, ArrowRight, Check } from 'lucide-react';
import { MiladyLogo, MiladyMascot, MiladyIcon } from './MiladyLogo';
import { NativeAuthService } from '../lib/nativeAuth';
import { isSupabaseConfigured } from '../lib/supabase';

interface OnboardingModalProps {
  onSignIn: (email: string, displayName: string) => Promise<void>;
  isLoading: boolean;
}

const steps = [
  {
    title: 'Daily Milady Points',
    subtitle: 'A clean, frictionless daily rewards habit. Check in once every 24 hours to claim your reward points.',
    icon: Sparkles,
    badge: 'Simple & Minimal',
    isMascot: true,
  },
  {
    title: 'Short Rewarded Ad',
    subtitle: 'Watch a brief, verified Google AdMob advertisement to validate and secure your daily reward.',
    icon: PlayCircle,
    badge: 'Instant Credit',
    isMascot: false,
  },
  {
    title: 'Build Your Streak',
    subtitle: 'Keep your consecutive daily check-ins alive and watch your Milady points balance grow over time.',
    icon: Flame,
    badge: 'Daily Habit',
    isMascot: false,
  },
];

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ onSignIn, isLoading }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [customEmail, setCustomEmail] = useState('');
  const [customName, setCustomName] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleGoogleSignIn = async (presetEmail?: string, presetName?: string) => {
    if (NativeAuthService.isNative() && isSupabaseConfigured) {
      const res = await NativeAuthService.signInWithGoogle();
      if (res.success) return;
    }
    const emailToUse = presetEmail || customEmail || 'joycejumbo12@gmail.com';
    const nameToUse = presetName || customName || 'Joyce Jumbo';
    onSignIn(emailToUse, nameToUse);
  };

  return (
    <div
      id="onboarding-screen"
      className="flex-1 flex flex-col justify-between p-6 bg-[#FAF8F5] dark:bg-[#181614] text-[#1E1B18] dark:text-[#EDE8E1] transition-colors overflow-y-auto"
    >
      {/* Brand Header */}
      <header className="pt-4 flex items-center justify-between">
        <MiladyLogo size="md" />
        <span className="text-xs tracking-wider uppercase px-2.5 py-1 rounded-full bg-[#EFECE6] dark:bg-[#282522] text-[#78716C] dark:text-[#A8A29E] font-medium">
          Daily Rewards
        </span>
      </header>

      {/* Step Visual Slide */}
      <div className="my-auto py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col items-center text-center"
          >
            {/* Step Icon / Character Mascot */}
            <div className="w-24 h-24 rounded-3xl bg-[#FAF8F5] dark:bg-[#201D1A] border border-[#E2DDD3] dark:border-[#38332E] flex items-center justify-center mb-6 text-[#1E1B18] dark:text-[#EDE8E1] shadow-xs p-3 relative overflow-hidden">
              {steps[currentStep].isMascot ? (
                <MiladyMascot animated className="w-full h-full object-contain" />
              ) : (
                React.createElement(steps[currentStep].icon, { className: 'w-10 h-10 stroke-[1.5]' })
              )}
            </div>

            <span className="text-xs font-semibold uppercase tracking-wider text-[#A8A29E] dark:text-[#78716C] mb-2">
              {steps[currentStep].badge}
            </span>

            <h1 className="text-2xl font-bold tracking-tight text-[#1E1B18] dark:text-[#FAF8F5] mb-3">
              {steps[currentStep].title}
            </h1>

            <p className="text-sm leading-relaxed text-[#78716C] dark:text-[#A8A29E] max-w-xs">
              {steps[currentStep].subtitle}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Step Indicator Dots */}
        <div className="flex justify-center items-center gap-2 mt-8">
          {steps.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentStep(idx)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                currentStep === idx
                  ? 'w-7 bg-[#1E1B18] dark:bg-[#EDE8E1]'
                  : 'w-1.5 bg-[#D6D3D1] dark:bg-[#44403C]'
              }`}
              aria-label={`Go to step ${idx + 1}`}
            />
          ))}
        </div>
      </div>

      {/* Action Footer */}
      <footer className="w-full pb-2 flex flex-col gap-3">
        {currentStep < steps.length - 1 ? (
          <button
            id="btn-onboarding-next"
            onClick={handleNext}
            className="w-full py-3.5 px-6 rounded-2xl bg-[#1E1B18] dark:bg-[#EDE8E1] text-[#FAF8F5] dark:text-[#181614] font-medium text-sm flex items-center justify-center gap-2 shadow-xs hover:opacity-95 active:scale-[0.99] transition-all cursor-pointer"
          >
            <span>Continue</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <div className="flex flex-col gap-2.5 w-full">
            {/* Primary Google Sign In */}
            <button
              id="btn-google-signin"
              disabled={isLoading}
              onClick={() => handleGoogleSignIn()}
              className="w-full py-3.5 px-4 rounded-2xl bg-white dark:bg-[#262320] border border-[#E7E5E4] dark:border-[#38332E] hover:bg-[#F5F5F4] dark:hover:bg-[#2F2B27] text-[#1E1B18] dark:text-[#EDE8E1] font-medium text-sm flex items-center justify-center gap-3 shadow-xs active:scale-[0.99] transition-all cursor-pointer"
            >
              {/* Google G Logo SVG */}
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.26v3.15C3.26 21.36 7.33 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.26C.46 8.16 0 9.94 0 12s.46 3.84 1.26 5.42l4.02-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.26 6.58l4.02 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
              <span>{isLoading ? 'Connecting to Google...' : 'Continue with Google'}</span>
            </button>

            {/* Quick Switch / Alternate Account toggle */}
            {!showCustomInput ? (
              <button
                id="btn-custom-account-toggle"
                onClick={() => setShowCustomInput(true)}
                className="text-xs text-[#78716C] dark:text-[#A8A29E] hover:underline text-center py-1 cursor-pointer"
              >
                Sign in with custom name or email
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-[#EFECE6] dark:bg-[#201D1A] flex flex-col gap-2 mt-1 text-left">
                <label className="text-[11px] font-semibold text-[#78716C] dark:text-[#A8A29E]">
                  Custom Account Details
                </label>
                <input
                  type="text"
                  placeholder="Your Name (e.g. Alex Smith)"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2C2825] border border-[#D6D3D1] dark:border-[#44403C] text-[#1E1B18] dark:text-[#EDE8E1] outline-none"
                />
                <input
                  type="email"
                  placeholder="name@example.com"
                  value={customEmail}
                  onChange={(e) => setCustomEmail(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2C2825] border border-[#D6D3D1] dark:border-[#44403C] text-[#1E1B18] dark:text-[#EDE8E1] outline-none"
                />
                <div className="flex gap-2 justify-end mt-1">
                  <button
                    onClick={() => setShowCustomInput(false)}
                    className="text-xs px-2 py-1 text-stone-500 hover:text-stone-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleGoogleSignIn(customEmail, customName)}
                    className="text-xs px-3 py-1 bg-[#1E1B18] dark:bg-[#EDE8E1] text-[#FAF8F5] dark:text-[#181614] rounded-md font-medium cursor-pointer"
                  >
                    Sign In
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <p className="text-[11px] text-[#A8A29E] dark:text-[#78716C] text-center leading-tight">
          By continuing, you agree to Milady's non-monetary in-app reward Terms and Privacy Policy.
        </p>
      </footer>
    </div>
  );
};
