'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AdminHeader } from '../components/AdminHeader';
import { OverviewView } from '../components/OverviewView';
import { AssetsView } from '../components/AssetsView';
import { MarketsView } from '../components/MarketsView';
import { OperationsView } from '../components/OperationsView';
import { UpsideRoundsView } from '../components/UpsideRoundsView';
import {
  AdminOverviewResponse,
  AdminAssetItem,
  AdminMarketItem,
  AdminOperationsResponse,
  AdminUpsideRoundItem,
} from '@othelio/shared';
import { adminApi } from '../lib/api';
import { useAdminAuth } from '../context/AdminAuthContext';

export default function AdminPage() {
  const [currentTab, setCurrentTab] = useState<'overview' | 'assets' | 'rounds' | 'markets' | 'operations'>('overview');

  const { capabilities, isAuthenticated, chainId } = useAdminAuth();

  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [assets, setAssets] = useState<AdminAssetItem[]>([]);
  const [rounds, setRounds] = useState<AdminUpsideRoundItem[]>([]);
  const [markets, setMarkets] = useState<AdminMarketItem[]>([]);
  const [operations, setOperations] = useState<AdminOperationsResponse | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!isAuthenticated) {
      setFetchError(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setFetchError(null);

    try {
      if (currentTab === 'overview') {
        const data = await adminApi.getOverview(chainId);
        setOverview(data);
      } else if (currentTab === 'assets') {
        const data = await adminApi.getAssets(chainId);
        setAssets(data.data);
      } else if (currentTab === 'rounds') {
        const [roundsData, assetsData] = await Promise.all([
          adminApi.getUpsideRounds(chainId),
          adminApi.getAssets(chainId),
        ]);
        setRounds(roundsData.data);
        setAssets(assetsData.data);
      } else if (currentTab === 'markets') {
        const [data, catalog] = await Promise.all([adminApi.getMarkets(chainId), adminApi.getAssets(chainId)]);
        setMarkets(data.data);
        setAssets(catalog.data);
      } else if (currentTab === 'operations') {
        const data = await adminApi.getOperations(chainId);
        setOperations(data);
      }
    } catch (err: any) {
      setFetchError(err?.message || 'Failed to fetch admin data. Check backend connection.');
    } finally {
      setIsLoading(false);
    }
  }, [currentTab, chainId, isAuthenticated]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="min-h-screen flex flex-col bg-[#10110f]">
      <AdminHeader
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        indexerLag={overview?.indexerHealth.blockLag}
        lastIndexedBlock={overview?.asOfBlock}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {!isAuthenticated && (
          <div className="mb-6 rounded-lg border border-[#292a27] bg-[#161715] p-5 text-sm text-zinc-300">
            Sign in with a wallet that owns a configured admin contract. Available actions depend on which contracts it owns.
          </div>
        )}
        {fetchError && (
          <div className="mb-6 p-4 rounded-lg bg-red-950/40 border border-red-900 text-xs font-mono text-red-300 flex items-center justify-between">
            <span>Error: {fetchError}</span>
            <button
              onClick={fetchData}
              className="px-2 py-1 bg-red-900/60 hover:bg-red-900 text-white rounded text-[10px]"
            >
              Retry
            </button>
          </div>
        )}

        {isAuthenticated && currentTab === 'overview' && (
          <OverviewView overview={overview} isLoading={isLoading} onRefresh={fetchData} />
        )}

        {isAuthenticated && currentTab === 'assets' && (
          <AssetsView assets={assets} isLoading={isLoading} onRefresh={fetchData} isOwner={capabilities.assetRegistry} />
        )}

        {isAuthenticated && currentTab === 'rounds' && (
          <UpsideRoundsView
            rounds={rounds}
            assets={assets}
            isLoading={isLoading}
            onRefresh={fetchData}
            isOwner={capabilities.upside}
            chainId={chainId}
          />
        )}

        {isAuthenticated && currentTab === 'markets' && (
          <MarketsView markets={markets} assets={assets} isLoading={isLoading} onRefresh={fetchData} isOwner={capabilities.riskSplit} />
        )}

        {isAuthenticated && currentTab === 'operations' && (
          <OperationsView
            operations={operations}
            isLoading={isLoading}
            onRefresh={fetchData}
          />
        )}
      </main>

      <footer className="border-t border-[#292a27] py-6 px-6 text-center text-xs font-mono text-zinc-600">
        Othelio Risk Split Protocol · {chainId === 31337 ? 'Base Fork' : 'Base Mainnet'} ·
        Deterministic Payoff & Verifiable Fixing Console
      </footer>
    </div>
  );
}
