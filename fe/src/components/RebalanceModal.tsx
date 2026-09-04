"use client";

import React, { useState } from "react";

interface AssetRebalanceItem {
  symbol: string;
  name: string;
  price: string;
  currentWeight: number;
  targetWeight: number;
}

interface RebalanceModalProps {
  assets: AssetRebalanceItem[];
  basketName: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirmRebalance: () => void;
}

export default function RebalanceModal({
  assets,
  basketName,
  isOpen,
  onClose,
  onConfirmRebalance,
}: RebalanceModalProps) {
  const [step, setStep] = useState<"preview" | "executing" | "success">("preview");
  const [maxSlippage, setMaxSlippage] = useState("0.5");

  if (!isOpen) return null;

  const handleExecute = () => {
    setStep("executing");
    setTimeout(() => {
      setStep("success");
      onConfirmRebalance();
    }, 2000);
  };

  const resetAndClose = () => {
    setStep("preview");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[#10110f] border border-[#292a27] text-[#eeeee7] w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#292a27] bg-[#161715]">
          <div>
            <span className="text-[10px] uppercase font-mono text-[#898b84] tracking-widest block">
              Portfolio rebalance
            </span>
            <h2 className="text-lg font-mono text-[#eeeee7] font-medium mt-0.5">{basketName}</h2>
          </div>
          <button
            onClick={resetAndClose}
            className="text-[#898b84] hover:text-[#eeeee7] font-mono text-base transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 space-y-4 font-mono">
          {step === "preview" && (
            <>
              {/* Asset Rebalance Delta Table */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-[#898b84] font-mono px-1">
                  <span>Composition</span>
                  <span>Weight shift</span>
                </div>

                <div className="divide-y divide-[#292a27] bg-[#161715] p-2 border border-[#292a27]">
                  {assets.map((asset) => {
                    const delta = asset.targetWeight - asset.currentWeight;
                    return (
                      <div key={asset.symbol} className="p-2.5 flex items-center justify-between text-xs font-mono">
                        <div>
                          <strong className="text-[#eeeee7] block font-bold">{asset.symbol}</strong>
                          <span className="text-[10px] text-[#898b84]">{asset.price}</span>
                        </div>

                        <div className="text-right">
                          <span className="text-[#eeeee7] font-mono">
                            {asset.currentWeight}% → {asset.targetWeight}%
                          </span>
                          <span
                            className={`text-xs block font-mono ${
                              delta > 0 ? "text-[#eeeee7]" : delta < 0 ? "text-[#898b84]" : "text-[#898b84]"
                            }`}
                          >
                            {delta > 0 ? `+${delta}%` : delta < 0 ? `${delta}%` : "No change"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Slippage & Gas Estimate */}
              <div className="bg-[#161715] p-4 border border-[#292a27] space-y-2 text-xs font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-[#898b84]">Max slippage:</span>
                  <div className="flex items-center gap-1">
                    {["0.1", "0.5", "1.0"].map((s) => (
                      <button
                        key={s}
                        onClick={() => setMaxSlippage(s)}
                        className={`px-2 py-0.5 text-xs font-mono transition-colors ${
                          maxSlippage === s
                            ? "bg-[#eeeee7] text-[#10110f] font-bold"
                            : "bg-[#10110f] border border-[#292a27] text-[#898b84] hover:text-[#eeeee7]"
                        }`}
                      >
                        {s}%
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex justify-between text-[#898b84] pt-2 border-t border-[#292a27] text-[11px]">
                  <span>Estimated gas fee:</span>
                  <span className="text-[#eeeee7] font-mono">$0.04 USD</span>
                </div>
              </div>
            </>
          )}

          {step === "executing" && (
            <div className="py-12 text-center space-y-4">
              <div className="inline-block w-8 h-8 border border-[#eeeee7] border-t-transparent animate-spin" />
              <h3 className="text-sm font-mono text-[#eeeee7]">Submitting rebalance...</h3>
            </div>
          )}

          {step === "success" && (
            <div className="py-8 text-center space-y-4">
              <h3 className="text-base font-mono text-[#eeeee7]">Rebalance completed</h3>
              <p className="text-xs text-[#898b84] font-mono">
                Weights for {basketName} updated on Base.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#292a27] bg-[#161715] flex justify-end gap-3 font-mono">
          {step === "preview" && (
            <>
              <button
                onClick={resetAndClose}
                className="px-4 py-2 text-xs bg-[#10110f] border border-[#292a27] text-[#eeeee7] hover:border-[#898b84] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExecute}
                className="px-6 py-2 text-xs font-bold bg-[#eeeee7] text-[#10110f] hover:bg-white transition-colors"
              >
                Confirm rebalance ↗
              </button>
            </>
          )}

          {step === "success" && (
            <button
              onClick={resetAndClose}
              className="px-6 py-2 text-xs font-bold bg-[#eeeee7] text-[#10110f]"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
