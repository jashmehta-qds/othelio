"use client";

import { useEffect } from "react";
import { useConnect, useAccount } from "wagmi";
import { useAuth } from "@/context/AuthContext";
import { formatAddress } from "@/lib/baskets";
import { Dialog } from "@/components/ui/Dialog";
import { AppIcon } from "@/components/app-shell/AppIcon";

export function WalletConnectModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { connectors, connect, isPending, variables, error, reset } = useConnect();
  const { address, isConnected } = useAccount();
  const { isAuthenticated, isAuthenticating, authError, clearAuthError, login, logout } = useAuth();
  useEffect(() => {
    if (isOpen && isConnected && isAuthenticated) onClose();
  }, [isOpen, isConnected, isAuthenticated, onClose]);

  const close = () => {
    if (isConnected && !isAuthenticated) logout();
    clearAuthError();
    reset();
    onClose();
  };
  const verifying = Boolean(isConnected && address && !isAuthenticated);
  const pendingId = typeof variables?.connector === "object" ? variables.connector.id : undefined;
  return <Dialog open={isOpen} onClose={close} title={verifying ? "Confirm it’s your wallet" : "Connect your wallet"}
    description={verifying ? "Sign the message in your wallet to finish signing in. This does not approve a transaction or cost gas." : "Choose a wallet to view your baskets and manage your portfolio."}>
    {(authError || error) && <div className="ui-notice" data-tone="error" role="alert">{authError || "The connection didn’t complete. Open your wallet, then try again."}</div>}
    {verifying ? <>
      <div className="wallet-address"><div><small>Connected wallet</small><code>{formatAddress(address!)}</code></div><span className="wallet-progress">Signature required</span></div>
      <button className="ui-button" style={{ width: "100%" }} disabled={isAuthenticating} onClick={() => void login()}>{isAuthenticating ? "Check your wallet…" : "Sign in with wallet"}</button>
      <button className="ui-button" data-variant="ghost" style={{ width: "100%", marginTop: 10 }} onClick={close}>Cancel and disconnect</button>
    </> : <>
      <div className="wallet-options">
        {connectors.map((connector) => <button type="button" className="wallet-option" key={connector.uid} disabled={isPending} onClick={() => { clearAuthError(); reset(); connect({ connector }); }}>
          {connector.icon ? <img src={connector.icon} alt="" width={32} height={32} /> : <span className="wallet-option-icon"><AppIcon type="lock" /></span>}
          <strong>{connector.name === "Injected" ? "Browser wallet" : connector.name}</strong>
          <span>{isPending && pendingId === connector.id ? "Check your wallet…" : <AppIcon type="arrow" />}</span>
        </button>)}
        {connectors.length === 0 && <div className="ui-notice">No wallet was detected. Open Othelio in your wallet’s browser or install a browser wallet, then reload.</div>}
      </div>
      <p className="wallet-note">Your assets stay in your wallet. You review and sign transactions before they’re submitted.</p>
    </>}
  </Dialog>;
}
