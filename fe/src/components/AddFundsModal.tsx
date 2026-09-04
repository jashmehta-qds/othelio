"use client";

import React, { useState } from "react";

interface AddFundsModalProps {
  isOpen: boolean;
  onClose: () => void;
  navPerShare: number;
  basketName: string;
  onConfirmDeposit?: (amountUsdc: number, sharesMinted: number) => void;
}

export default function AddFundsModal({
  isOpen,
  onClose,
  navPerShare,
  basketName,
  onConfirmDeposit,
}: AddFundsModalProps) {
  const [depositAmountUsdc, setDepositAmountUsdc] = useState<string>("1000");
  const [step, setStep] = useState<"input" | "confirming" | "success">("input");

  if (!isOpen) return null;

  const usdcNum = parseFloat(depositAmountUsdc) || 0;
  const sharesToMint = navPerShare > 0 ? usdcNum / navPerShare : 0;

  const handleDeposit = () => {
    setStep("confirming");
    setTimeout(() => {
      if (onConfirmDeposit) {
        onConfirmDeposit(usdcNum, Number(sharesToMint.toFixed(4)));
      }
      setStep("success");
    }, 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200 font-mono">
      <div className="bg-[#10110f] border border-[#292a27] text-[#eeeee7] w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#292a27] bg-[#161715]">
          <div>
            <span className="text-[10px] uppercase text-[#898b84] tracking-widest block">Add Funds & Mint Shares</span>
            <h2 className="text-base text-[#eeeee7] font-medium">{basketName}</h2>
          </div>
          <button onClick={onClose} className="text-[#898b84] hover:text-[#eeeee7] text-base">
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          {step === "input" && (
            <>
              {/* Deposit Amount USDC Input */}
              <div className="space-y-1">
                <label className="block text-[10px] uppercase tracking-wider text-[#898b84]">
                  Deposit Amount (USDC on Base)
                </label>
                <div className="flex items-center bg-[#161715] border border-[#292a27] p-3">
                  <span className="text-sm font-bold text-[#898b84] mr-2">$</span>
                  <input
                    type="number"
                    min={1}
                    value={depositAmountUsdc}
                    onChange={(e) => setDepositAmountUsdc(e.target.value)}
                    className="bg-transparent border-0 text-lg text-[#eeeee7] focus:outline-none w-full"
                    placeholder="1000"
                  />
                  <span className="text-xs px-2 py-1 bg-[#292a27] text-[#eeeee7]">USDC</span>
                </div>
              </div>

              {/* Mint & Composition Calculation Breakdown */}
              <div className="bg-[#161715] p-4 border border-[#292a27] space-y-3">
                <div className="flex justify-between items-baseline text-xs">
                  <span className="text-[#898b84]">Estimated New Shares Minted:</span>
                  <strong className="text-base text-[#eeeee7] font-semibold">
                    +{sharesToMint.toFixed(4)} OTHL
                  </strong>
                </div>

                <div className="text-xs space-y-1.5 border-t border-[#292a27] pt-2 text-[#898b84]">
                  <div className="flex justify-between">
                    <span>Current Index NAV / Share:</span>
                    <span className="text-[#eeeee7]">${navPerShare.toFixed(2)} USD</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Base Router Gas Fee:</span>
                    <span className="text-[#eeeee7]">~$0.04 (USDC gasless)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Composition Auto-Balancing:</span>
                    <span className="text-[#eeeee7]">Instant 1-tx deployment</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {step === "confirming" && (
            <div className="py-12 text-center space-y-4">
              <div className="inline-block w-8 h-8 border border-[#eeeee7] border-t-transparent animate-spin" />
              <h3 className="text-sm text-[#eeeee7]">Executing batch mint & issuing shares on Base...</h3>
            </div>
          )}

          {step === "success" && (
            <div className="py-8 text-center space-y-4">
              <h3 className="text-base text-[#eeeee7]">Deposit & Share Mint Complete</h3>
              <p className="text-xs text-[#898b84]">
                Deposited ${usdcNum.toFixed(2)} USDC. Issued +{sharesToMint.toFixed(4)} OTHL index shares to your connected wallet.
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
                disabled={usdcNum <= 0}
                onClick={handleDeposit}
                className="px-6 py-2 text-xs bg-[#eeeee7] text-[#10110f] font-semibold hover:bg-white disabled:opacity-40"
              >
                Approve & Add Funds ↗
              </button>
            </>
          )}

          {step === "success" && (
            <button
              onClick={() => {
                setStep("input");
                onClose();
              }}
              className="px-6 py-2 text-xs bg-[#eeeee7] text-[#10110f] font-semibold"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
