import React from 'react';
import { Wifi, Battery, Signal, Moon, Sun, Smartphone, Monitor } from 'lucide-react';
import { MiladyIcon } from './MiladyLogo';

interface AndroidFrameProps {
  children: React.ReactNode;
  isDark: boolean;
  toggleDark: () => void;
  isDeviceView: boolean;
  toggleDeviceView: () => void;
  onOpenAdmin: () => void;
}

export const AndroidFrame: React.FC<AndroidFrameProps> = ({
  children,
  isDark,
  toggleDark,
  isDeviceView,
  toggleDeviceView,
  onOpenAdmin,
}) => {
  const [timeString, setTimeString] = React.useState('9:41');

  React.useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = now.getHours().toString().padStart(2, '0');
      const minutes = now.getMinutes().toString().padStart(2, '0');
      setTimeString(`${hours}:${minutes}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      id="app-root-container"
      className={`min-h-screen transition-colors duration-300 flex flex-col items-center justify-center p-0 md:p-6 ${
        isDark ? 'bg-[#121110] text-[#EDE8E1]' : 'bg-[#F2EFE9] text-[#1E1B18]'
      }`}
    >
      {/* Top Floating Controls for Desktop View */}
      <header
        id="desktop-top-toolbar"
        className="w-full max-w-md hidden md:flex items-center justify-between py-2 px-3 mb-2 text-xs font-medium text-[#78716C] dark:text-[#A8A29E]"
      >
        <div className="flex items-center gap-2">
          <MiladyIcon size="xs" rounded="rounded-md" />
          <span className="font-semibold text-[#292524] dark:text-[#E7E5E4] tracking-wide uppercase text-[11px]">
            Milady App
          </span>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[11px] opacity-80">Online</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="btn-admin-config"
            onClick={onOpenAdmin}
            className="px-2.5 py-1 rounded-full bg-white dark:bg-[#262320] border border-[#E7E5E4] dark:border-[#38332E] hover:border-[#D6D3D1] transition-all text-[11px] text-[#44403C] dark:text-[#D6D3D1] flex items-center gap-1.5 cursor-pointer shadow-xs"
            title="Remote Config & Analytics"
          >
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            Admin / Config
          </button>

          <button
            id="btn-toggle-device-view"
            onClick={toggleDeviceView}
            className="p-1.5 rounded-full bg-white dark:bg-[#262320] border border-[#E7E5E4] dark:border-[#38332E] hover:bg-[#F5F5F4] dark:hover:bg-[#2F2B27] transition-all cursor-pointer shadow-xs"
            title={isDeviceView ? 'Switch to Full Width' : 'Switch to Android Frame'}
          >
            {isDeviceView ? <Monitor className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}
          </button>

          <button
            id="btn-toggle-theme"
            onClick={toggleDark}
            className="p-1.5 rounded-full bg-white dark:bg-[#262320] border border-[#E7E5E4] dark:border-[#38332E] hover:bg-[#F5F5F4] dark:hover:bg-[#2F2B27] transition-all cursor-pointer shadow-xs"
            title="Toggle Light / Dark Mode"
          >
            {isDark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-stone-600" />}
          </button>
        </div>
      </header>

      {/* Main Container / Android Shell */}
      <main
        id="android-device-shell"
        className={`w-full transition-all duration-300 relative flex flex-col overflow-hidden ${
          isDeviceView
            ? 'max-w-[420px] h-[100dvh] md:h-[844px] md:max-h-[92vh] md:rounded-[44px] md:shadow-[0_25px_60px_-15px_rgba(0,0,0,0.18)] md:border-[8px] md:border-[#1E1B18] dark:md:border-[#2C2825]'
            : 'max-w-md min-h-[100dvh] md:rounded-3xl shadow-sm border border-[#E7E5E4] dark:border-[#2C2825]'
        } ${isDark ? 'bg-[#181614]' : 'bg-[#FAF8F5]'}`}
      >
        {/* Android Status Bar */}
        <div
          id="android-status-bar"
          className="w-full px-6 pt-3 pb-1 flex items-center justify-between text-xs select-none z-30 shrink-0 font-medium text-[#57534E] dark:text-[#A8A29E]"
        >
          <span className="font-semibold text-xs tracking-tight">{timeString}</span>

          {/* Camera Pinhole for Realistic Android Look */}
          <div className="w-3.5 h-3.5 rounded-full bg-[#11100F] dark:bg-black border border-stone-800/40 hidden md:block" />

          <div className="flex items-center gap-1.5 text-[11px]">
            <Signal className="w-3.5 h-3.5" />
            <Wifi className="w-3.5 h-3.5" />
            <div className="flex items-center gap-0.5">
              <span className="text-[10px]">98%</span>
              <Battery className="w-3.5 h-3.5 fill-current" />
            </div>
          </div>
        </div>

        {/* Content Viewport */}
        <div className="flex-1 flex flex-col overflow-y-auto relative overscroll-contain">
          {children}
        </div>

        {/* Android Bottom Navigation Pill Indicator */}
        <div className="w-full py-1.5 flex justify-center items-center shrink-0 z-30">
          <div className="w-28 h-1 rounded-full bg-stone-300 dark:bg-stone-700" />
        </div>
      </main>
    </div>
  );
};
