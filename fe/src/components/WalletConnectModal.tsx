"use client";

import { useEffect } from "react";
import { useConnect, useAccount } from "wagmi";
import { useAuth } from "@/context/AuthContext";
import { formatAddress } from "@/lib/baskets";

export function WalletConnectModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { connectors, connect, isPending, variables } = useConnect();
  const { address, isConnected } = useAccount();
  const { isAuthenticated, isAuthenticating, authError, clearAuthError, login, logout } = useAuth();

  // Close automatically once both wallet connection and signature verification succeed
  useEffect(() => {
    if (isOpen && isConnected && isAuthenticated) {
      onClose();
    }
  }, [isOpen, isConnected, isAuthenticated, onClose]);

  if (!isOpen) return null;

  const handleClose = () => {
    // If wallet connected but signature not completed, closing cancels authentication
    if (isConnected && !isAuthenticated) {
      logout();
    }
    clearAuthError();
    onClose();
  };

  const getConnectorInfo = (id: string, name: string) => {
    const isMetaMask = id === "metaMask" || name.toLowerCase().includes("metamask");
    const isCoinbase = id === "coinbaseWallet" || name.toLowerCase().includes("coinbase");

    if (isMetaMask) {
      return {
        title: "MetaMask",
        badge: "Popular",
        iconUrl: "https://raw.githubusercontent.com/MetaMask/brand-resources/master/SVG/metamask-fox.svg",
      };
    }

    if (isCoinbase) {
      return {
        title: "Coinbase Wallet",
        badge: "",
        iconUrl: "https://images.ctfassets.net/q5ulk4bp65r7/3TBS4vWM2jMVio02b04FZV/2122614a55d07b92a3016e45b40606a3/Coinbase_Wallet_Icon_2022.svg",
      };
    }

    return {
      title: name.toLowerCase().includes("injected") ? "Browser Wallet" : name,
      badge: "Injected",
      iconUrl: "https://raw.githubusercontent.com/WalletConnect/walletconnect-assets/master/Icon/Gradient/Icon.svg",
    };
  };

  // Step 2: Wallet is connected, now FORCING signature verification
  const isAwaitingSignature = isConnected && address && !isAuthenticated;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        padding: "20px",
      }}
      onClick={handleClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "400px",
          background: "var(--panel)",
          border: "1px solid var(--panel-border)",
          borderRadius: "20px",
          padding: "24px",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  background: isAwaitingSignature ? "rgba(215, 255, 70, 0.15)" : "var(--panel-2)",
                  color: isAwaitingSignature ? "#d7ff46" : "var(--muted-ink)",
                }}
              >
                {isAwaitingSignature ? "Step 2 of 2: Verify" : "Step 1 of 2: Connect"}
              </span>
            </div>
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--ink)", margin: "4px 0 0" }}>
              {isAwaitingSignature ? "Sign Message to Log In" : "Connect Wallet"}
            </h2>
            <p style={{ fontSize: "12px", color: "var(--muted-ink)", margin: "4px 0 0", lineHeight: 1.4 }}>
              {isAwaitingSignature
                ? "Please sign the verification request in your wallet to verify ownership and log in."
                : "Choose your preferred Web3 provider to get started."}
            </p>
          </div>
          <button
            onClick={handleClose}
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--panel-border)",
              borderRadius: "50%",
              width: "28px",
              height: "28px",
              display: "grid",
              placeItems: "center",
              color: "var(--muted-ink)",
              fontSize: "16px",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </header>

        {/* Step 2: Force Signature Screen */}
        {isAwaitingSignature ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div
              style={{
                padding: "14px 16px",
                borderRadius: "14px",
                background: "var(--panel-2)",
                border: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <span style={{ fontSize: "11px", color: "var(--muted-ink)", textTransform: "uppercase", fontWeight: 600 }}>Connected Wallet</span>
                <strong style={{ display: "block", fontSize: "14px", color: "var(--ink)" }}>{formatAddress(address)}</strong>
              </div>
              <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: "rgba(215, 255, 70, 0.15)", color: "#d7ff46", fontWeight: 700 }}>
                Pending Signature
              </span>
            </div>

            {authError && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "10px",
                  background: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  color: "#ff7770",
                  fontSize: "12px",
                  lineHeight: 1.4,
                }}
              >
                {authError}
              </div>
            )}

            <button
              type="button"
              onClick={() => login()}
              disabled={isAuthenticating}
              style={{
                width: "100%",
                padding: "12px 18px",
                borderRadius: "12px",
                background: "#d7ff46",
                border: "none",
                color: "#10110f",
                fontSize: "14px",
                fontWeight: 700,
                cursor: isAuthenticating ? "not-allowed" : "pointer",
                opacity: isAuthenticating ? 0.7 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
            >
              {isAuthenticating ? "Waiting for Wallet Signature..." : "Sign Message in Wallet"}
            </button>

            <button
              type="button"
              onClick={handleClose}
              style={{
                width: "100%",
                padding: "10px 18px",
                borderRadius: "12px",
                background: "transparent",
                border: "1px solid var(--line)",
                color: "var(--muted-ink)",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel & Disconnect
            </button>
          </div>
        ) : (
          /* Step 1: Connector Selection */
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {authError && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "10px",
                  background: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  color: "#ff7770",
                  fontSize: "12px",
                  lineHeight: 1.4,
                  marginBottom: "4px",
                }}
              >
                {authError}
              </div>
            )}

            {connectors.map((connector) => {
              const pendingId = typeof variables?.connector === "object" && variables?.connector ? (variables.connector as any).id : undefined;
              const isThisPending = isPending && pendingId === connector.id;
              const info = getConnectorInfo(connector.id, connector.name);

              return (
                <button
                  key={connector.id}
                  onClick={() => {
                    clearAuthError();
                    connect({ connector });
                    // Notice: We do NOT call onClose() here! We wait for Step 2 signature!
                  }}
                  disabled={isThisPending}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    borderRadius: "14px",
                    background: "var(--panel-2)",
                    border: "1px solid var(--panel-border)",
                    color: "var(--ink)",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                    <img src={info.iconUrl} alt={info.title} width={32} height={32} style={{ borderRadius: "8px", objectFit: "contain" }} />
                    <div>
                      <strong style={{ display: "block", fontSize: "14px", fontWeight: 600 }}>
                        {info.title}
                      </strong>
                      {info.badge && (
                        <span style={{ fontSize: "10px", color: "var(--accent)", fontWeight: 500 }}>
                          {info.badge}
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: "12px", color: "var(--muted-ink)", fontWeight: 500 }}>
                    {isThisPending ? "Connecting..." : "→"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
