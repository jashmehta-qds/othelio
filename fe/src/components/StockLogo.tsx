"use client";

import React from "react";

interface StockLogoProps {
  symbol: string;
  size?: number;
  className?: string;
  roundedFull?: boolean;
}

export default function StockLogo({ symbol, size = 28, className = "", roundedFull = false }: StockLogoProps) {
  const cleanSymbol = symbol.replace(/c$/, "").toUpperCase();
  const rx = roundedFull ? "12" : "5";

  const renderSvgContent = () => {
    switch (cleanSymbol) {
      case "NVDA":
        return (
          <svg viewBox="0 0 24 24" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx={rx} fill="#76B900" />
            <path
              d="M6 14.5C6 11.46 8.46 9 11.5 9H17.5V11.25H11.5C9.7 11.25 8.25 12.7 8.25 14.5C8.25 16.3 9.7 17.75 11.5 17.75H17.5V19.5H11.5C8.74 19.5 6.5 17.26 6.5 14.5Z"
              fill="#000000"
            />
            <path
              d="M10 7.5C10 5.57 11.57 4 13.5 4H18.5V5.75H13.5C12.53 5.75 11.75 6.53 11.75 7.5C11.75 8.47 12.53 9.25 13.5 9.25H18.5V11H13.5C11.57 11 10 9.43 10 7.5Z"
              fill="#000000"
              opacity="0.85"
            />
          </svg>
        );

      case "AAPL":
        return (
          <svg viewBox="0 0 24 24" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx={rx} fill="#1C1C1E" />
            <path
              d="M15.5 13.2C15.5 10.9 17.4 9.8 17.5 9.7C16.4 8.2 14.8 8 14.2 7.9C12.8 7.7 11.4 8.7 10.6 8.7C9.9 8.7 8.7 7.8 7.6 7.8C6.1 7.8 4.7 8.7 3.9 10.1C2.3 12.9 3.5 17 5 19.2C5.7 20.2 6.5 21.3 7.6 21.3C8.7 21.3 9.1 20.6 10.4 20.6C11.7 20.6 12.1 21.3 13.2 21.3C14.3 21.3 15.1 20.3 15.8 19.3C16.6 18.2 16.9 17.1 17 17C16.9 16.9 15.5 16.4 15.5 13.2Z"
              fill="#EEEEEE"
            />
            <path
              d="M13.8 6.1C14.4 5.3 14.8 4.2 14.7 3C13.7 3 12.4 3.7 11.8 4.4C11.2 5.1 10.7 6.2 10.9 7.4C12 7.5 13.2 6.8 13.8 6.1Z"
              fill="#EEEEEE"
            />
          </svg>
        );

      case "MSFT":
        return (
          <svg viewBox="0 0 24 24" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx={rx} fill="#1A1A1A" />
            <rect x="4.5" y="4.5" width="7" height="7" fill="#F25022" />
            <rect x="12.5" y="4.5" width="7" height="7" fill="#7FBA00" />
            <rect x="4.5" y="12.5" width="7" height="7" fill="#00A4EF" />
            <rect x="12.5" y="12.5" width="7" height="7" fill="#FFB900" />
          </svg>
        );

      case "GOOGL":
      case "GOOG":
        return (
          <svg viewBox="0 0 24 24" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx={rx} fill="#202124" />
            <path
              d="M17.5 12.2C17.5 11.6 17.4 11 17.3 10.5H12V12.7H15.1C15 13.4 14.5 14.3 13.7 14.9V16.7H15.9C17.2 15.5 17.5 13.6 17.5 12.2Z"
              fill="#4285F4"
            />
            <path
              d="M12 18C13.6 18 15 17.5 16 16.7L13.8 14.9C13.2 15.3 12.6 15.6 12 15.6C10.7 15.6 9.6 14.7 9.2 13.5H6.9V15.3C7.9 17 9.8 18 12 18Z"
              fill="#34A853"
            />
            <path
              d="M9.2 13.5C9 13 8.9 12.5 8.9 12C8.9 11.5 9 11 9.2 10.5V8.7H6.9C6.3 9.8 6 10.9 6 12C6 13.1 6.3 14.2 6.9 15.3L9.2 13.5Z"
              fill="#FBBC05"
            />
            <path
              d="M12 8.4C12.9 8.4 13.7 8.7 14.3 9.3L16 7.6C15 6.6 13.6 6 12 6C9.8 6 7.9 7 6.9 8.7L9.2 10.5C9.6 9.3 10.7 8.4 12 8.4Z"
              fill="#EA4335"
            />
          </svg>
        );

      case "TSLA":
        return (
          <svg viewBox="0 0 24 24" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx={rx} fill="#E82127" />
            <path
              d="M12 5.5C13.5 5.5 16 6 18 7.5L16.5 9C15.2 8 13.5 7.6 12 7.6C10.5 7.6 8.8 8 7.5 9L6 7.5C8 6 10.5 5.5 12 5.5Z"
              fill="#FFFFFF"
            />
            <path
              d="M11.2 9.5H12.8V19H11.2V9.5Z"
              fill="#FFFFFF"
            />
            <path
              d="M12 5C11.8 5 7 5.2 6 7.2L7.3 8.2C8 6.9 11 6.6 12 6.6C13 6.6 16 6.9 16.7 8.2L18 7.2C17 5.2 12.2 5 12 5Z"
              fill="#FFFFFF"
            />
          </svg>
        );

      case "AMD":
        return (
          <svg viewBox="0 0 24 24" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx={rx} fill="#000000" />
            <path d="M5 19H14.5L19 14.5V5H5V19ZM16 7.5V13.2L13.2 16H7.5V7.5H16Z" fill="#ED1C24" />
            <path d="M19 19V16H16L19 19Z" fill="#FFFFFF" />
          </svg>
        );

      case "AMZN":
        return (
          <svg viewBox="0 0 24 24" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx={rx} fill="#141921" />
            <path
              d="M6 14.2C8 16 11 16.8 14.5 16.2C16.2 15.9 17.8 15.2 19 14.2M18 13.5L19.5 14.5L18.8 16.2"
              stroke="#FF9900"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text x="12" y="11.5" fill="#FFFFFF" fontSize="8.5" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle">
              a
            </text>
          </svg>
        );

      case "COIN":
        return (
          <svg viewBox="0 0 24 24" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx={rx} fill="#0052FF" />
            <circle cx="12" cy="12" r="6.5" fill="#FFFFFF" />
            <rect x="9" y="9" width="6" height="6" fill="#0052FF" rx="1" />
          </svg>
        );

      case "META":
        return (
          <svg viewBox="0 0 24 24" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx={rx} fill="#0467DF" />
            <path
              d="M16.8 7.5C15.6 7.5 14.4 8.2 13.5 9.3C12.3 7.8 10.8 7.5 9.4 7.5C6.7 7.5 4.5 9.6 4.5 12.3C4.5 15 6.6 17.1 9.3 17.1C11.1 17.1 12.5 15.9 13.5 14.5C14.4 15.8 15.8 17.1 17.6 17.1C20 17.1 21.8 15.3 21.8 12.3C21.8 9.3 19.6 7.5 16.8 7.5ZM9.3 15.1C7.8 15.1 6.5 13.9 6.5 12.3C6.5 10.7 7.8 9.5 9.3 9.5C10.7 9.5 11.9 10.8 12.7 12.3C11.8 13.9 10.7 15.1 9.3 15.1ZM16.8 15.1C15.4 15.1 14.2 13.9 13.3 12.3C14.2 10.8 15.4 9.5 16.8 9.5C18.3 9.5 10.7 19.6 12.3C19.6 13.9 18.3 15.1 16.8 15.1Z"
              fill="#FFFFFF"
            />
          </svg>
        );

      case "USDC":
        return (
          <svg viewBox="0 0 24 24" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx={rx} fill="#2775CA" />
            <circle cx="12" cy="12" r="7" stroke="#FFFFFF" strokeWidth="1.5" />
            <path
              d="M10.8 14.5C10.8 15.3 11.5 15.8 12.5 15.8C13.6 15.8 14.2 15.1 14.2 14.2C14.2 12.8 12 12.5 12 11.5C12 10.8 12.6 10.4 13.4 10.4C14.3 10.4 14.9 10.9 14.9 11.6M12 9V10.2M12 15.8V17"
              stroke="#FFFFFF"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        );

      default:
        return (
          <div
            style={{ width: size, height: size }}
            className={`flex items-center justify-center bg-[#292a27] text-[#eeeee7] font-mono font-bold text-xs border border-[#393a37] ${
              roundedFull ? "rounded-full" : "rounded"
            }`}
          >
            {cleanSymbol.slice(0, 2)}
          </div>
        );
    }
  };

  return (
    <div
      className={`inline-flex items-center justify-center shrink-0 overflow-hidden ${
        roundedFull ? "rounded-full" : ""
      } ${className}`}
      style={{ width: size, height: size }}
    >
      {renderSvgContent()}
    </div>
  );
}
