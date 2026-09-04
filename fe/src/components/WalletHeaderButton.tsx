"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { formatAddress } from "@/lib/baskets";
import { WalletConnectModal } from "./WalletConnectModal";

export function WalletHeaderButton() {
  const { address, isConnected, isConnecting } = useAccount();
  const { isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [showConnectModal, setShowConnectModal] = useState<boolean>(false);

  const handleConnect = () => {
    setShowConnectModal(true);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
      {isConnected && address ? (
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "12px", color: "var(--muted-ink)" }}>
            <code style={{ color: "var(--accent)" }}>{formatAddress(address)}</code>
          </span>
          <button
            onClick={() => disconnect()}
            style={{
              background: "transparent",
              border: "1px solid var(--line)",
              padding: "6px 12px",
              borderRadius: "8px",
              color: "var(--muted-ink)",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          onClick={handleConnect}
          disabled={isConnecting || isPending}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            padding: "6px 14px",
            borderRadius: "8px",
            color: "var(--foreground)",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
            transition: "opacity 0.2s ease",
          }}
        >
          {isConnecting || isPending ? "Connecting..." : "Connect Wallet"}
        </button>
      )}

      <Link
        href="/app"
        style={{
          background: "var(--accent)",
          color: "#0b0c0a",
          padding: "7px 16px",
          borderRadius: "8px",
          fontSize: "13px",
          fontWeight: 700,
          textDecoration: "none",
        }}
      >
        Launch App
      </Link>
      <WalletConnectModal isOpen={showConnectModal} onClose={() => setShowConnectModal(false)} />
    </div>
  );
}
