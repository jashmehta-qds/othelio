"use client";

import React, { useState } from "react";
import StockLogo from "./StockLogo";

interface RedeemModalProps {
  isOpen: boolean;
  onClose: () => void;
  sharesOwned: number;
  navPerShare: number;
  basketName: string;
}

export default function RedeemModal({
  isOpen,
  onClose,
  sharesOwned,
  navPerShare,
  basketName,
}: RedeemModalProps) {
  const [redeemType, setRedeemType] = useState<"usdc" | "inkind">("usdc");
  const [sharesToRedeem, setSharesToRedeem] = useState<string>(sharesOwned.toString());
  const [step, setStep] = useState<"input" | "confirming" | "success">("input");

  if (!isOpen) return null;

  const numShares = parseFloat(sharesToRedeem) || 0;
  const estValue = numShares * navPerShare;

  const handleRedeem = () => {
    setStep("confirming");
    setTimeout(() => {
      setStep("success");
    }, 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200 font-mono">
      <div className="bg-[#10110f] border border-[#292a27] text-[#eeeee7] w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#292a27] bg-[#161715]">
          <div>
            <span className="text-[10px] uppercase text-[#898b84] tracking-widest block">Basket redemption</span>
            <h2 className="text-base text-[#eeeee7] font-medium">{basketName}</h2>
          </div>
          <button onClick={onClose} className="text-[#898b84] hover:text-[#eeeee7] text-base">
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          {step === "input" && (
            <>
              {/* Type Toggle */}
              <div className="grid grid-cols-2 gap-2 bg-[#161715] p-1 border border-[#292a27]">
                <button
                  onClick={() => setRedeemType("usdc")}
                  className={`py-2 text-xs transition-colors ${
                    redeemType === "usdc"
                      ? "bg-[#eeeee7] text-[#10110f] font-bold"
                      : "text-[#898b84] hover:text-[#eeeee7]"
                  }`}
                >
                  USDC Output
                </button>
                <button
                  onClick={() => setRedeemType("inkind")}
                  className={`py-2 text-xs transition-colors ${
                    redeemType === "inkind"
                      ? "bg-[#eeeee7] text-[#10110f] font-bold"
                      : "text-[#898b84] hover:text-[#eeeee7]"
                  }`}
                >
                  In-Kind Stocks
                </button>
              </div>

              {/* Shares input */}
              <div className="space-y-1">
                <label className="block text-[10px] uppercase tracking-wider text-[#898b84]">
                  Shares to Burn (Balance: {sharesOwned} OTHL)
                </label>
                <div className="flex items-center bg-[#161715] border border-[#292a27] p-3">
                  <input
                    type="number"
                    max={sharesOwned}
                    min={0}
                    value={sharesToRedeem}
                    onChange={(e) => setSharesToRedeem(e.target.value)}
                    className="bg-transparent border-0 text-lg text-[#eeeee7] focus:outline-none w-full"
                  />
                  <button
                    onClick={() => setSharesToRedeem(sharesOwned.toString())}
                    className="text-xs px-2 py-1 bg-[#292a27] text-[#eeeee7] hover:bg-[#393a37]"
                  >
                    MAX
                  </button>
                </div>
              </div>

              {/* Output Preview */}
              <div className="bg-[#161715] p-4 border border-[#292a27] space-y-3">
                <div className="flex justify-between items-baseline text-xs">
                  <span className="text-[#898b84]">Estimated Output Value:</span>
                  <strong className="text-base text-[#eeeee7] font-semibold">${estValue.toFixed(2)} USD</strong>
                </div>

                {redeemType === "usdc" ? (
                  <div className="text-xs space-y-1 border-t border-[#292a27] pt-2 text-[#898b84]">
                    <div className="flex justify-between">
                      <span>USDC Router Fee:</span>
                      <span>0.10%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Minimum Received Output:</span>
                      <span className="text-[#eeeee7]">${(estValue * 0.995).toFixed(2)} USDC</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs space-y-1 border-t border-[#292a27] pt-2 text-[#898b84]">
                    <p className="text-[11px] text-[#eeeee7]">Proportional B20 native stock tokens:</p>
                    <div className="flex justify-between items-center py-1">
                      <span className="flex items-center gap-1.5"><StockLogo symbol="NVDA" size={16} /> NVDAc</span>
                      <span className="text-[#eeeee7]">{(numShares * 0.103).toFixed(4)} shares</span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="flex items-center gap-1.5"><StockLogo symbol="GOOGL" size={16} /> GOOGLc</span>
                      <span className="text-[#eeeee7]">{(numShares * 0.175).toFixed(4)} shares</span>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {step === "confirming" && (
            <div className="py-12 text-center space-y-4">
              <div className="inline-block w-8 h-8 border border-[#eeeee7] border-t-transparent animate-spin" />
              <h3 className="text-sm text-[#eeeee7]">Burning basket shares...</h3>
            </div>
          )}

          {step === "success" && (
            <div className="py-8 text-center space-y-4">
              <h3 className="text-base text-[#eeeee7]">Redemption complete</h3>
              <p className="text-xs text-[#898b84]">
                Burned {numShares} OTHL shares. Received ${estValue.toFixed(2)} {redeemType === "usdc" ? "USDC" : "basket composition assets"}.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#292a27] bg-[#161715] flex justify-end gap-3">
          {step === "input" && (
            <>
              <button onClick={onClose} className="px-4 py-2 text-xs bg-[#292a27] text-[#eeeee7]">
                Cancel
              </button>
              <button
                disabled={numShares <= 0 || numShares > sharesOwned}
                onClick={handleRedeem}
                className="px-6 py-2 text-xs bg-[#eeeee7] text-[#10110f] font-semibold hover:bg-white disabled:opacity-40"
              >
                Burn shares & redeem ↗
              </button>
            </>
          )}

          {step === "success" && (
            <button onClick={onClose} className="px-6 py-2 text-xs bg-[#eeeee7] text-[#10110f] font-semibold">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
