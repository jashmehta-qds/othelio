"use client";

import React, { useState } from "react";

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  sharesOwned: number;
  basketName: string;
}

export default function TransferModal({
  isOpen,
  onClose,
  sharesOwned,
  basketName,
}: TransferModalProps) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"input" | "confirming" | "success">("input");

  if (!isOpen) return null;

  const numAmount = parseFloat(amount) || 0;

  const handleTransfer = () => {
    setStep("confirming");
    setTimeout(() => {
      setStep("success");
    }, 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[#10110f] border border-[#292a27] text-[#eeeee7] w-full max-w-xl shadow-2xl overflow-hidden flex flex-col font-mono">
        <div className="flex items-center justify-between p-4 border-b border-[#292a27] bg-[#161715]">
          <div>
            <span className="text-[10px] uppercase text-[#898b84] tracking-widest block">Transfer shares</span>
            <h2 className="text-base text-[#eeeee7] font-medium">{basketName}</h2>
          </div>
          <button onClick={onClose} className="text-[#898b84] hover:text-[#eeeee7] text-base">
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4 font-mono">
          {step === "input" && (
            <>
              {/* Recipient Address */}
              <div className="space-y-1">
                <label className="block text-[10px] uppercase tracking-wider text-[#898b84]">
                  Recipient Address
                </label>
                <input
                  type="text"
                  placeholder="0x..."
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  className="w-full bg-[#161715] border border-[#292a27] p-3 text-xs text-[#eeeee7] focus:outline-none focus:border-[#eeeee7]"
                />
              </div>

              {/* Shares Amount */}
              <div className="space-y-1">
                <label className="block text-[10px] uppercase tracking-wider text-[#898b84]">
                  Shares Amount (Available: {sharesOwned} OTHL)
                </label>
                <div className="flex items-center bg-[#161715] border border-[#292a27] p-3">
                  <input
                    type="number"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="bg-transparent border-0 text-lg text-[#eeeee7] focus:outline-none w-full"
                  />
                  <button
                    onClick={() => setAmount(sharesOwned.toString())}
                    className="text-xs px-2 py-1 bg-[#292a27] text-[#eeeee7]"
                  >
                    MAX
                  </button>
                </div>
              </div>

              {/* Controller Notice */}
              <div className="bg-[#161715] p-3 border border-[#292a27] text-xs space-y-1 text-[#898b84]">
                <strong className="text-[#eeeee7] font-normal block uppercase text-[10px] tracking-wider">
                  Controller authority disclosure
                </strong>
                <p className="text-[11px] leading-relaxed">
                  Transferring basket shares grants the recipient proportional economic backing and redemption rights. It does NOT transfer portfolio rebalancing or management authority, which remains with the controller vault key.
                </p>
              </div>
            </>
          )}

          {step === "confirming" && (
            <div className="py-12 text-center space-y-4">
              <div className="inline-block w-8 h-8 border border-[#eeeee7] border-t-transparent animate-spin" />
              <h3 className="text-sm text-[#eeeee7]">Transferring OTHL shares...</h3>
            </div>
          )}

          {step === "success" && (
            <div className="py-8 text-center space-y-4">
              <h3 className="text-base text-[#eeeee7]">Transfer successful</h3>
              <p className="text-xs text-[#898b84]">
                Transferred {numAmount} OTHL shares to <code>{recipient.slice(0, 8)}...{recipient.slice(-6)}</code>
              </p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#292a27] bg-[#161715] flex justify-end gap-3 font-mono">
          {step === "input" && (
            <>
              <button onClick={onClose} className="px-4 py-2 text-xs bg-[#292a27] text-[#eeeee7]">
                Cancel
              </button>
              <button
                disabled={!recipient || numAmount <= 0 || numAmount > sharesOwned}
                onClick={handleTransfer}
                className="px-6 py-2 text-xs bg-[#eeeee7] text-[#10110f] font-semibold hover:bg-white disabled:opacity-40"
              >
                Confirm transfer ↗
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
