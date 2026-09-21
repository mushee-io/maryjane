import React from 'react';
import { motion } from 'motion/react';

interface MascotProps {
  className?: string;
  size?: number | string;
  animated?: boolean;
}

/**
 * Milady hand-drawn sketch mascot
 * Faithful rendering of the joyful running figure in cozy sweater & boots
 */
export const MiladyMascot: React.FC<MascotProps> = ({
  className = 'w-full h-full',
  size,
  animated = false,
}) => {
  const content = (
    <svg
      viewBox="0 0 200 200"
      width={size || '100%'}
      height={size || '100%'}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        {/* Soft hand-sketched chalk texture filter */}
        <filter id="charcoal-roughness" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="2" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>

      <g
        filter="url(#charcoal-roughness)"
        stroke="currentColor"
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Antenna spiral / playful curl & dots */}
        <path d="M 96 40 C 90 28, 80 24, 85 15 C 89 9, 98 12, 97 18 C 97 22, 93 27, 88 31" />
        <circle cx="123" cy="23" r="3.2" fill="currentColor" />
        <circle cx="117" cy="32" r="2.2" fill="currentColor" />

        {/* Head & Hair */}
        <path d="M 87 49 C 87 40, 95 36, 105 36 C 116 36, 123 42, 123 51 C 123 62, 114 66, 104 66 C 93 66, 87 59, 87 49 Z" />
        {/* Hair bangs / fringe */}
        <path
          d="M 89 44 C 97 40, 112 40, 121 44 C 119 49, 112 48, 105 50 C 98 50, 94 48, 89 44 Z"
          fill="currentColor"
        />
        {/* Eyes & Smile */}
        <circle cx="97" cy="52" r="1.8" fill="currentColor" />
        <circle cx="109" cy="52" r="1.8" fill="currentColor" />
        <path d="M 101 58 Q 104 61 108 58" />

        {/* Left Arm & expressive hand (reaching left / back) */}
        <path d="M 89 67 C 75 69, 63 75, 61 87 C 59 97, 69 98, 77 91" />
        <path d="M 63 73 L 55 67 C 53 65, 51 69, 55 73 L 61 81" />
        <path d="M 55 67 C 57 61, 63 61, 65 65" />
        <path d="M 63 87 C 71 87, 79 83, 87 79" />

        {/* Right Arm & expressive hand (reaching up & right) */}
        <path d="M 117 67 C 131 71, 143 79, 141 93 C 139 101, 131 101, 125 95" />
        <path d="M 137 75 L 147 69 C 151 67, 155 71, 151 77 L 141 85" />
        <path d="M 147 69 C 151 73, 155 77, 157 83 C 157 87, 151 87, 145 85" />
        <path d="M 139 93 C 133 93, 125 89, 119 83" />

        {/* Cozy Oversized Sweater Silhouette */}
        <path d="M 87 65 Q 103 71 119 65" />
        <path d="M 81 85 C 83 97, 85 106, 91 114 C 97 122, 117 126, 133 116 C 137 108, 133 94, 125 85" />
        <path d="M 91 114 C 85 112, 81 106, 79 98" />

        {/* Left Leg & Pointed Boot (Leading step) */}
        <path d="M 93 117 L 87 141" />
        <path d="M 103 121 L 97 143" />
        {/* Chunky angular boot */}
        <path d="M 83 139 L 97 145 L 89 171 L 63 161 L 79 143 Z" />

        {/* Right Leg & Boot (Trailing kick) */}
        <path d="M 111 119 L 125 137" />
        <path d="M 121 115 L 133 133" />
        {/* Trailing boot */}
        <path d="M 123 135 L 137 131 L 151 159 C 145 165, 135 163, 127 151 L 121 139 Z" />
      </g>
    </svg>
  );

  if (animated) {
    return (
      <motion.div
        animate={{ y: [0, -3, 0], rotate: [0, 1.5, 0, -1.5, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="inline-block"
      >
        {content}
      </motion.div>
    );
  }

  return content;
};

/**
 * Milady App Launcher & Icon Badge
 */
export const MiladyIcon: React.FC<{
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  rounded?: string;
}> = ({ size = 'md', className = '', rounded = 'rounded-2xl' }) => {
  const sizeMap = {
    xs: 'w-6 h-6 p-0.5',
    sm: 'w-8 h-8 p-1',
    md: 'w-10 h-10 p-1.5',
    lg: 'w-16 h-16 p-2',
    xl: 'w-24 h-24 p-3',
  };

  return (
    <div
      className={`relative inline-flex items-center justify-center bg-[#FAF8F5] dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] shadow-2xs overflow-hidden text-[#1E1B18] dark:text-[#EDE8E1] ${sizeMap[size]} ${rounded} ${className}`}
    >
      <MiladyMascot className="w-full h-full object-contain" />
    </div>
  );
};

/**
 * Milady Brand Header Logotype (Mascot + Elegant Typography)
 */
export const MiladyLogo: React.FC<{
  className?: string;
  showSubtitle?: boolean;
  size?: 'sm' | 'md' | 'lg';
}> = ({ className = '', showSubtitle = false, size = 'md' }) => {
  const isSmall = size === 'sm';
  const isLarge = size === 'lg';

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <div
        className={`rounded-xl bg-[#FAF8F5] dark:bg-[#201D1A] border border-[#E5E1D8] dark:border-[#38332E] p-1 flex items-center justify-center text-[#1E1B18] dark:text-[#FAF8F5] shadow-2xs ${
          isSmall ? 'w-7 h-7' : isLarge ? 'w-11 h-11' : 'w-8 h-8'
        }`}
      >
        <MiladyMascot className="w-full h-full" />
      </div>
      <div className="flex flex-col">
        <span
          className={`font-serif-display tracking-tight font-normal leading-none text-[#1E1B18] dark:text-[#FAF8F5] ${
            isSmall ? 'text-xl' : isLarge ? 'text-3xl' : 'text-2xl'
          }`}
        >
          Milady
        </span>
        {showSubtitle && (
          <span className="text-[10px] uppercase tracking-wider text-[#A8A29E] dark:text-[#78716C] font-semibold mt-0.5">
            Daily Rewards
          </span>
        )}
      </div>
    </div>
  );
};
