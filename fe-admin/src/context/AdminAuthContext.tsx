'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAccount, useSignMessage, useChainId } from 'wagmi';
import { adminApi } from '../lib/api';
import type { AdminOperator } from '@othelio/shared';

interface AdminAuthContextType {
  isAuthenticated: boolean;
  capabilities: AdminOperator['capabilities'];
  contracts: AdminOperator['contracts'] | null;
  token: string | null;
  operatorAddress: string | null;
  factoryAddress: string | null;
  chainId: number;
  login: () => Promise<void>;
  logout: () => void;
  error: string | null;
  isLoggingIn: boolean;
}

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(undefined);

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected, status } = useAccount();
  const currentChainId = useChainId();
  const { signMessageAsync } = useSignMessage();

  const [token, setToken] = useState<string | null>(null);
  const [operator, setOperator] = useState<AdminOperator | null>(null);
  const operatorAddress = operator?.address ?? null;
  const [error, setError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [sessionChainId, setSessionChainId] = useState<number | null>(null);

  // Sync token from localStorage on mount and validate session with backend
  useEffect(() => {
    const existing = adminApi.getToken();
    if (existing) {
      setToken(existing);
      adminApi
        .getMe()
        .then((me) => {
          setOperator(me);
          setSessionChainId(me.chainId);
        })
        .catch((err) => {
          // Only invalidate token if unauthorized (401); ignore transient network / RPC errors
          if (err?.status === 401) {
            adminApi.setToken(null);
            setToken(null);
            setOperator(null);
            setSessionChainId(null);
          }
        });
    }
  }, []);

  // When wallet changes or disconnects, revalidate
  useEffect(() => {
    // If wagmi is still connecting or reconnecting on page load, preserve existing session
    if (status === 'connecting' || status === 'reconnecting') {
      return;
    }

    if (status === 'disconnected' || !isConnected || !address) {
      setToken(null);
      setOperator(null);
      setSessionChainId(null);
      adminApi.setToken(null);
      return;
    }

    if (operatorAddress && operatorAddress.toLowerCase() !== address.toLowerCase()) {
      // Wallet switched accounts
      setToken(null);
      setOperator(null);
      setSessionChainId(null);
      adminApi.setToken(null);
      return;
    }

    if (sessionChainId !== null && currentChainId && sessionChainId !== currentChainId) {
      // Wallet switched networks
      setToken(null);
      setOperator(null);
      setSessionChainId(null);
      adminApi.setToken(null);
    }
  }, [address, isConnected, status, operatorAddress, currentChainId, sessionChainId]);

  const login = useCallback(async () => {
    if (!address) {
      setError('Please connect your wallet first.');
      return;
    }

    const targetChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 31337);
    if (currentChainId !== targetChainId) {
      setError(`Wrong network: wallet is connected to chain ${currentChainId}. Please switch to ${targetChainId === 31337 ? 'Base Fork (31337)' : 'Base Mainnet (8453)'}.`);
      return;
    }

    setIsLoggingIn(true);
    setError(null);

    try {
      const challenge = await adminApi.getChallenge(address, currentChainId);
      const signature = await signMessageAsync({ message: challenge.message });
      const verifyRes = await adminApi.verifySignature(address, challenge.message, signature, currentChainId);

      setToken(verifyRes.token);
      setOperator(verifyRes);
      setSessionChainId(currentChainId);
    } catch (err: any) {
      setError(err?.message || 'Authentication failed. Make sure you are the onchain owner.');
      setToken(null);
      setOperator(null);
      setSessionChainId(null);
      adminApi.setToken(null);
    } finally {
      setIsLoggingIn(false);
    }
  }, [address, currentChainId, signMessageAsync]);

  const logout = useCallback(() => {
    setToken(null);
    setOperator(null);
    setSessionChainId(null);
    adminApi.setToken(null);
  }, []);

  return (
    <AdminAuthContext.Provider
      value={{
        isAuthenticated: Boolean(token && address && address.toLowerCase() === operatorAddress?.toLowerCase() && currentChainId === sessionChainId),
        capabilities: operator?.capabilities ?? { assetRegistry: false, riskSplit: false, upside: false },
        contracts: operator?.contracts ?? null,
        token,
        operatorAddress,
        factoryAddress: operator?.contracts.riskSplit ?? null,
        chainId: currentChainId,
        login,
        logout,
        error,
        isLoggingIn,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error('useAdminAuth must be used within an AdminAuthProvider');
  }
  return ctx;
}
