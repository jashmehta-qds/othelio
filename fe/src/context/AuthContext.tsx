'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
import { fetchAuthNonce, verifyAuthSignature } from '@/lib/api';

interface AuthContextType {
  token: string | null;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  authError: string | null;
  clearAuthError: () => void;
  login: () => Promise<string | null>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  isAuthenticated: false,
  isAuthenticating: false,
  authError: null,
  clearAuthError: () => {},
  login: async () => null,
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  const [token, setToken] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const authInProgressRef = useRef(false);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const logout = useCallback(() => {
    if (address && typeof window !== 'undefined') {
      sessionStorage.removeItem(`othelio_auth_token_${address.toLowerCase()}`);
    }
    setToken(null);
    setAuthError(null);
    disconnect();
  }, [address, disconnect]);

  const login = useCallback(async (): Promise<string | null> => {
    if (!address) return null;
    const lowerAddr = address.toLowerCase();

    // Check existing valid session
    if (typeof window !== 'undefined') {
      const existing = sessionStorage.getItem(`othelio_auth_token_${lowerAddr}`);
      if (existing) {
        setToken(existing);
        setAuthError(null);
        return existing;
      }
    }

    if (authInProgressRef.current) return null;
    authInProgressRef.current = true;
    setIsAuthenticating(true);
    setAuthError(null);

    try {
      // 1. Get nonce challenge
      const challengeRes = await fetchAuthNonce(lowerAddr);
      const message = challengeRes.data.message;

      // 2. Request wallet signature
      const signature = await signMessageAsync({ message });

      // 3. Verify signature with backend & receive JWT token
      const verifyRes = await verifyAuthSignature(lowerAddr, message, signature);
      const jwtToken = verifyRes.data.token;

      if (typeof window !== 'undefined') {
        sessionStorage.setItem(`othelio_auth_token_${lowerAddr}`, jwtToken);
      }

      setToken(jwtToken);
      setAuthError(null);
      return jwtToken;
    } catch (err: any) {
      console.error('Sign-In with Ethereum error:', err);

      const isUserCancellation =
        err?.code === 4001 ||
        err?.cause?.code === 4001 ||
        err?.message?.toLowerCase().includes('user rejected') ||
        err?.message?.toLowerCase().includes('user denied') ||
        err?.message?.toLowerCase().includes('rejected the request');

      const errorMsg = isUserCancellation
        ? 'Authentication cancelled. Please sign in to log into Othelio.'
        : `Authentication failed: ${err?.message || 'Verification error'}`;

      setAuthError(errorMsg);
      setToken(null);
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(`othelio_auth_token_${lowerAddr}`);
      }

      if (isUserCancellation) {
        disconnect();
      }

      return null;
    } finally {
      setIsAuthenticating(false);
      authInProgressRef.current = false;
    }
  }, [address, disconnect, signMessageAsync]);

  // Automatically trigger authentication on wallet connect
  useEffect(() => {
    if (!isConnected || !address) {
      setToken(null);
      return;
    }

    const lowerAddr = address.toLowerCase();
    if (typeof window !== 'undefined') {
      const existing = sessionStorage.getItem(`othelio_auth_token_${lowerAddr}`);
      if (existing) {
        setToken(existing);
        setAuthError(null);
        return;
      }
    }

    // No existing session token for this connected address -> trigger login
    login();
  }, [address, isConnected, login]);

  return (
    <AuthContext.Provider
      value={{
        token,
        isAuthenticated: Boolean(token && isConnected && address),
        isAuthenticating,
        authError,
        clearAuthError,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
