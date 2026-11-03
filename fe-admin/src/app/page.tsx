'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AdminHeader } from '../components/AdminHeader';
import { OverviewView } from '../components/OverviewView';
import { AssetsView } from '../components/AssetsView';
import { MarketsView } from '../components/MarketsView';
import { OperationsView } from '../components/OperationsView';
import {
  AdminOverviewResponse,
  AdminAssetItem,
  AdminMarketItem,
  AdminOperationsResponse,
} from '@othelio/shared';
import { adminApi } from '../lib/api';
import { useAdminAuth } from '../context/AdminAuthContext';

export default function AdminPage() {
  const [currentTab, setCurrentTab] = useState<'overview' | 'assets' | 'markets' | 'operations'>('overview');

  const { isOwner, isAuthenticated, chainId } = useAdminAuth();

  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [assets, setAssets] = useState<AdminAssetItem[]>([]);
  const [markets, setMarkets] = useState<AdminMarketItem[]>([]);
  const [operations, setOperations] = useState<AdminOperationsResponse | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);

    try {
      if (currentTab === 'overview') {
        const data = await adminApi.getOverview(chainId);
        setOverview(data);
      } else if (currentTab === 'assets') {
        const data = await adminApi.getAssets(chainId);
        setAssets(data.data);
      } else if (currentTab === 'markets') {
        const data = await adminApi.getMarkets(chainId);
        setMarkets(data.data);
      } else if (currentTab === 'operations') {
        const data = await adminApi.getOperations(chainId);
        setOperations(data);
      }
    } catch (err: any) {
      setFetchError(err?.message || 'Failed to fetch admin data. Check backend connection.');
    } finally {
      setIsLoading(false);
    }
  }, [currentTab, chainId]);

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

        {currentTab === 'overview' && (
          <OverviewView overview={overview} isLoading={isLoading} onRefresh={fetchData} />
        )}

        {currentTab === 'assets' && (
          <AssetsView assets={assets} isLoading={isLoading} onRefresh={fetchData} isOwner={isOwner} />
        )}

        {currentTab === 'markets' && (
          <MarketsView markets={markets} isLoading={isLoading} onRefresh={fetchData} isOwner={isOwner} />
        )}

        {currentTab === 'operations' && (
          <OperationsView
            operations={operations}
            isLoading={isLoading}
            onRefresh={fetchData}
            isOwner={isOwner}
          />
        )}
      </main>

      <footer className="border-t border-[#292a27] py-6 px-6 text-center text-xs font-mono text-zinc-600">
        Othelio Risk Split Protocol · Base Mainnet · Deterministic Payoff & Verifiable Fixing Console
      </footer>
    </div>
  );
}
