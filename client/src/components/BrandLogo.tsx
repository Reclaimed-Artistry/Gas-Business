import React from 'react';

export function BrandLogo({
  compact = false,
  inverted = false,
}: {
  compact?: boolean;
  inverted?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      <div
        className={`flex items-center justify-center w-9 h-9 rounded-lg border ${
          inverted
            ? 'bg-white text-[#073B8C] border-white/20'
            : 'bg-[#073B8C] text-white border-[#06265B]'
        }`}
      >
        <svg viewBox="0 0 28 28" className="w-5 h-5" fill="none" aria-hidden="true">
          <path
            d="M14 2.5C14 2.5 7 9.8 7 16.2C7 20.1 10.1 23.5 14 23.5C17.9 23.5 21 20.1 21 16.2C21 9.8 14 2.5 14 2.5Z"
            fill="currentColor"
          />
          <path
            d="M14 11.2C14 11.2 11 14.3 11 16.9C11 18.6 12.3 20 14 20C15.7 20 17 18.6 17 16.9C17 14.3 14 11.2 14 11.2Z"
            fill={inverted ? '#EAF3FF' : '#1769C2'}
          />
          <rect
            x="10.5"
            y="24.5"
            width="7"
            height="1.8"
            rx="0.9"
            fill="currentColor"
            opacity="0.85"
          />
        </svg>
      </div>
      {!compact && (
        <div className="leading-tight">
          <div
            className={`font-bold text-[17px] tracking-tight ${
              inverted ? 'text-white' : 'text-[#06265B]'
            }`}
          >
            BlueFlame
          </div>
          <div
            className={`text-[10.5px] font-medium uppercase tracking-wider ${
              inverted ? 'text-[#EAF3FF]/80' : 'text-[#64748B]'
            }`}
          >
            Gas Marketplace NG
          </div>
        </div>
      )}
    </div>
  );
}
