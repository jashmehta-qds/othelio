'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAccount, useSignMessage, useChainId } from 'wagmi';
import { adminApi } from '../lib/api';

interface AdminAuthContextType {
  isAuthenticated: boolean;
  isOwner: boolean;
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
  const [isOwner, setIsOwner] = useState(false);
  const [factoryAddress, setFactoryAddress] = useState<string | null>(null);
  const [operatorAddress, setOperatorAddress] = useState<string | null>(null);
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
          setIsOwner(me.isOwner);
          setOperatorAddress(me.address);
          setFactoryAddress(me.factoryAddress);
          setSessionChainId(me.chainId);
        })
        .catch((err) => {
          // Only invalidate token if unauthorized (401); ignore transient network / RPC errors
          if (err?.status === 401) {
            adminApi.setToken(null);
            setToken(null);
            setIsOwner(false);
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
      setIsOwner(false);
      setOperatorAddress(null);
      setFactoryAddress(null);
      setSessionChainId(null);
      adminApi.setToken(null);
      return;
    }

    if (operatorAddress && operatorAddress.toLowerCase() !== address.toLowerCase()) {
      // Wallet switched accounts
      setToken(null);
      setIsOwner(false);
      setOperatorAddress(null);
      setFactoryAddress(null);
      setSessionChainId(null);
      adminApi.setToken(null);
      return;
    }

    if (sessionChainId !== null && currentChainId && sessionChainId !== currentChainId) {
      // Wallet switched networks
      setToken(null);
      setIsOwner(false);
      setOperatorAddress(null);
      setFactoryAddress(null);
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
      setIsOwner(verifyRes.isOwner);
      setOperatorAddress(verifyRes.address);
      setFactoryAddress(verifyRes.factoryAddress);
      setSessionChainId(currentChainId);
    } catch (err: any) {
      setError(err?.message || 'Authentication failed. Make sure you are the onchain owner.');
      setToken(null);
      setIsOwner(false);
      setSessionChainId(null);
      adminApi.setToken(null);
    } finally {
      setIsLoggingIn(false);
    }
  }, [address, currentChainId, signMessageAsync]);

  const logout = useCallback(() => {
    setToken(null);
    setIsOwner(false);
    setOperatorAddress(null);
    setFactoryAddress(null);
    setSessionChainId(null);
    adminApi.setToken(null);
  }, []);

  return (
    <AdminAuthContext.Provider
      value={{
        isAuthenticated: Boolean(token && isOwner),
        isOwner,
        token,
        operatorAddress,
        factoryAddress,
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
