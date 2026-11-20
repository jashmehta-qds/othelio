'use client';

import React from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { useAdminAuth } from '../context/AdminAuthContext';

interface AdminHeaderProps {
  currentTab: 'overview' | 'assets' | 'rounds' | 'markets' | 'operations';
  onSelectTab: (tab: 'overview' | 'assets' | 'rounds' | 'markets' | 'operations') => void;
  indexerLag?: number;
  lastIndexedBlock?: number;
}

export function AdminHeader({
  currentTab,
  onSelectTab,
  indexerLag = 0,
  lastIndexedBlock,
}: AdminHeaderProps) {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { isAuthenticated, login, logout, isLoggingIn, error, chainId } = useAdminAuth();
  const targetChainId = process.env.NEXT_PUBLIC_CHAIN_ID ? Number(process.env.NEXT_PUBLIC_CHAIN_ID) : 31337;
  const isWrongNetwork = isConnected && chainId !== targetChainId;
  const hasIndexerStatus = lastIndexedBlock !== undefined;

  const handleConnect = () => {
    const injectedConnector = connectors.find((c) => c.id === 'injected') || connectors[0];
    if (injectedConnector) {
      connect({ connector: injectedConnector });
    }
  };

  return (
    <header className="border-b border-[#292a27] bg-[#10110f] px-6 py-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        {/* Brand & Tabs */}
        <div className="flex items-center space-x-8">
          <div className="flex items-center space-x-3">
            <div className="h-8 w-8 rounded bg-[#ff5729] flex items-center justify-center font-bold text-black text-sm">
              OTH
            </div>
            <div>
              <div className="font-semibold text-white tracking-wide flex items-center gap-2">
                <span>OTHELIO</span>
                <span className="text-xs bg-[#292a27] text-zinc-400 px-2 py-0.5 rounded font-mono">
                  OPERATOR
                </span>
              </div>
              <p className="text-xs text-zinc-500 font-mono">
                {chainId === 31337 ? 'Base Fork' : 'Base'} Risk Split Console
              </p>
            </div>
          </div>

          <nav className="flex space-x-1">
            {(['overview', 'assets', 'rounds', 'markets', 'operations'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => onSelectTab(tab)}
                className={`px-3 py-1.5 rounded text-xs font-mono uppercase tracking-wider transition-colors ${
                  currentTab === tab
                    ? 'bg-[#292a27] text-white font-medium'
                    : 'text-zinc-400 hover:text-white hover:bg-[#161715]'
                }`}
              >
                {tab === 'rounds' ? 'Upside Rounds' : tab}
              </button>
            ))}
          </nav>
        </div>

        {/* Right Status & Actions */}
        <div className="flex items-center space-x-4">
          {/* Indexer Status */}
          <div className="hidden sm:flex items-center space-x-2 text-xs font-mono px-3 py-1.5 rounded bg-[#161715] border border-[#292a27]">
            <span
              className={`h-2 w-2 rounded-full ${
                !hasIndexerStatus
                  ? 'bg-zinc-600'
                  : indexerLag === 0
                    ? 'bg-emerald-500'
                    : indexerLag < 10
                      ? 'bg-amber-500'
                      : 'bg-red-500'
              }`}
            />
            <span className="text-zinc-400">INDEXER:</span>
            <span className="text-zinc-200">
              {hasIndexerStatus ? `#${lastIndexedBlock}` : '—'}
            </span>
            {hasIndexerStatus && indexerLag > 0 && (
              <span className="text-amber-400">(-{indexerLag})</span>
            )}
          </div>

          {/* Wallet & Auth */}
          {!isConnected ? (
            <button
              onClick={handleConnect}
              className="px-4 py-1.5 rounded bg-[#ff5729] text-black font-medium text-xs tracking-wider uppercase hover:bg-[#ff6f47] transition-colors"
            >
              Connect Wallet
            </button>
          ) : (
            <div className="flex items-center space-x-3">
              {/* Role Badge */}
              <div
                className={`text-xs px-2.5 py-1 rounded font-mono border ${
                  isAuthenticated
                    ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800'
                    : 'bg-zinc-900 text-zinc-400 border-[#292a27]'
                }`}
              >
                {isAuthenticated ? 'CONTRACT OWNER' : 'NOT SIGNED IN'}
              </div>

              {/* Wallet Address */}
              <span className="text-xs font-mono text-zinc-300">
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </span>

              {/* Session State */}
              {isWrongNetwork ? (
                <button
                  onClick={() => switchChain?.({ chainId: targetChainId })}
                  className="px-3 py-1.5 rounded bg-amber-500/20 text-amber-300 border border-amber-600/50 hover:bg-amber-500/30 text-xs font-mono transition-colors"
                >
                  Switch to {targetChainId === 31337 ? 'Base Fork' : 'Base'}
                </button>
              ) : isAuthenticated ? (
                <button
                  onClick={logout}
                  className="text-xs font-mono text-zinc-400 hover:text-white px-2 py-1 rounded border border-[#292a27] hover:bg-[#161715]"
                >
                  Sign Out
                </button>
              ) : (
                <button
                  onClick={login}
                  disabled={isLoggingIn}
                  className="px-3 py-1.5 rounded bg-[#292a27] hover:bg-[#3f413c] text-white text-xs font-mono transition-colors disabled:opacity-50"
                >
                  {isLoggingIn ? 'Signing...' : 'Sign In'}
                </button>
              )}

              <button
                onClick={() => disconnect()}
                title="Disconnect Wallet"
                className="text-xs font-mono text-zinc-500 hover:text-zinc-300"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3 text-xs font-mono text-red-400 bg-red-950/40 border border-red-900 px-3 py-1.5 rounded">
          {error}
        </div>
      )}
    </header>
  );
}
