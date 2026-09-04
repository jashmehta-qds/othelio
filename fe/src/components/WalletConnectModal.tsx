"use client";

import { useConnect } from "wagmi";

export function WalletConnectModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { connectors, connect, isPending, variables } = useConnect();

  if (!isOpen) return null;

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
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "380px",
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
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--ink)", margin: 0 }}>Connect Wallet</h2>
            <p style={{ fontSize: "12px", color: "var(--muted-ink)", margin: "4px 0 0" }}>
              Choose your preferred Web3 provider
            </p>
          </div>
          <button
            onClick={onClose}
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

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {connectors.map((connector) => {
            const pendingId = typeof variables?.connector === "object" && variables?.connector ? (variables.connector as any).id : undefined;
            const isThisPending = isPending && pendingId === connector.id;
            const info = getConnectorInfo(connector.id, connector.name);

            return (
              <button
                key={connector.id}
                onClick={() => {
                  connect({ connector });
                  onClose();
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
      </div>
    </div>
  );
}
