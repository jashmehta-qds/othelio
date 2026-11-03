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
  const { address, isConnected } = useAccount();
  const currentChainId = useChainId();
  const { signMessageAsync } = useSignMessage();

  const [token, setToken] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [factoryAddress, setFactoryAddress] = useState<string | null>(null);
  const [operatorAddress, setOperatorAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Sync token from localStorage on mount
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
        })
        .catch(() => {
          // Token expired or invalid
          adminApi.setToken(null);
          setToken(null);
          setIsOwner(false);
        });
    }
  }, []);

  // When wallet changes or disconnects, revalidate
  useEffect(() => {
    if (!isConnected || !address) {
      setToken(null);
      setIsOwner(false);
      setOperatorAddress(null);
      adminApi.setToken(null);
      return;
    }

    if (operatorAddress && operatorAddress.toLowerCase() !== address.toLowerCase()) {
      // Wallet switched
      setToken(null);
      setIsOwner(false);
      setOperatorAddress(null);
      adminApi.setToken(null);
    }
  }, [address, isConnected, operatorAddress]);

  const login = useCallback(async () => {
    if (!address) {
      setError('Please connect your wallet first.');
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
    } catch (err: any) {
      setError(err?.message || 'Authentication failed. Make sure you are the onchain owner.');
      setToken(null);
      setIsOwner(false);
      adminApi.setToken(null);
    } finally {
      setIsLoggingIn(false);
    }
  }, [address, currentChainId, signMessageAsync]);

  const logout = useCallback(() => {
    setToken(null);
    setIsOwner(false);
    setOperatorAddress(null);
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
