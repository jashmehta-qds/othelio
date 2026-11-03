'use client';

import React, { useState } from 'react';
import { AdminAssetItem, AdminTransactionPreview } from '@othelio/shared';
import { adminApi } from '../lib/api';
import { useSendTransaction } from 'wagmi';

interface AssetsViewProps {
  assets: AdminAssetItem[];
  isLoading: boolean;
  onRefresh: () => void;
  isOwner: boolean;
}

export function AssetsView({ assets, isLoading, onRefresh, isOwner }: AssetsViewProps) {
  const [selectedAsset, setSelectedAsset] = useState<AdminAssetItem | null>(null);
  const [previews, setPreviews] = useState<AdminTransactionPreview[] | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const { sendTransactionAsync, isPending } = useSendTransaction();

  const handlePreviewEnable = async (asset: AdminAssetItem) => {
    setSelectedAsset(asset);
    setIsPreviewLoading(true);
    setPreviewError(null);
    setPreviews(null);

    try {
      const txs = await adminApi.previewEnableAsset(asset.address);
      setPreviews(txs);
    } catch (err: any) {
      setPreviewError(err?.message || 'Failed to preview asset enablement');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleExecuteTx = async (tx: AdminTransactionPreview) => {
    try {
      // Direct wallet execution
      const hash = await sendTransactionAsync({
        to: tx.target,
        data: '0x', // Target method calldata or placeholder
      });
      alert(`Transaction submitted! Hash: ${hash}`);
      setSelectedAsset(null);
      setPreviews(null);
      onRefresh();
    } catch (err: any) {
      alert(`Transaction failed: ${err?.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#292a27] pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Asset Readiness & Registry</h1>
          <p className="text-xs text-zinc-400 font-mono mt-1">
            Coinbase B20 token identities, Chainlink equity feeds, and Aerodrome route verification.
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="self-start sm:self-auto px-3 py-1.5 rounded bg-[#161715] hover:bg-[#292a27] border border-[#292a27] text-xs font-mono text-zinc-300 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Asset Table */}
      <div className="bg-[#161715] border border-[#292a27] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-[#292a27] bg-[#10110f] text-zinc-500 uppercase tracking-wider">
                <th className="py-3 px-4">Asset</th>
                <th className="py-3 px-4">Address</th>
                <th className="py-3 px-4">Chainlink Feed</th>
                <th className="py-3 px-4">Spot Price</th>
                <th className="py-3 px-4">Registry</th>
                <th className="py-3 px-4">Route</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#292a27] text-zinc-300">
              {assets.map((asset) => {
                const isFresh = asset.priceFeed.isFresh;
                const spotDisplay = asset.priceFeed.priceUsdE8
                  ? `$${(Number(asset.priceFeed.priceUsdE8) / 1e8).toFixed(2)}`
                  : '—';

                return (
                  <tr key={asset.address} className="hover:bg-[#1c1d1a] transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white">{asset.symbol}</div>
                      <div className="text-[10px] text-zinc-500 truncate max-w-[120px]">{asset.name}</div>
                    </td>
                    <td className="py-3 px-4 text-zinc-400">
                      {asset.address.slice(0, 6)}...{asset.address.slice(-4)}
                    </td>
                    <td className="py-3 px-4 text-zinc-400">
                      <div>{asset.priceFeed.address.slice(0, 6)}...{asset.priceFeed.address.slice(-4)}</div>
                      <div className="text-[10px] text-zinc-500">{asset.priceFeed.decimals} decimals</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-zinc-200">{spotDisplay}</div>
                      <div className={`text-[10px] ${isFresh ? 'text-emerald-500' : 'text-amber-500'}`}>
                        {isFresh ? 'Live (<24h)' : 'Stale/Offline'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] border ${
                          asset.registryStatus.isSupported
                            ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800'
                            : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                        }`}
                      >
                        {asset.registryStatus.isSupported ? 'SUPPORTED' : 'UNREGISTERED'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] border ${
                          asset.routeStatus.hasRoute
                            ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800'
                            : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                        }`}
                      >
                        {asset.routeStatus.hasRoute ? 'AERODROME V3' : 'NONE'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          asset.tradeable
                            ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800'
                            : 'bg-amber-950/60 text-amber-400 border-amber-800'
                        }`}
                      >
                        {asset.tradeable ? 'TRADEABLE' : 'STAGED'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {!asset.registryStatus.isSupported && (
                        <button
                          onClick={() => handlePreviewEnable(asset)}
                          className="px-3 py-1 rounded bg-[#292a27] hover:bg-[#3f413c] text-white text-xs font-mono transition-colors"
                        >
                          Enable Asset
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Enablement Preview Modal */}
      {selectedAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#161715] border border-[#292a27] rounded-xl max-w-lg w-full p-6 space-y-6">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-bold text-white">Enable Asset in Registry</h3>
                <p className="text-xs text-zinc-400 font-mono mt-1">
                  Preview transaction for {selectedAsset.symbol} ({selectedAsset.name})
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedAsset(null);
                  setPreviews(null);
                }}
                className="text-zinc-500 hover:text-white font-mono"
              >
                ✕
              </button>
            </div>

            {isPreviewLoading && (
              <div className="py-8 text-center text-xs font-mono text-zinc-400">
                Generating preview and verifying parameters...
              </div>
            )}

            {previewError && (
              <div className="p-3 bg-red-950/40 border border-red-900 rounded text-xs font-mono text-red-400">
                {previewError}
              </div>
            )}

            {previews && previews.length > 0 && (
              <div className="space-y-4">
                {previews.map((tx, idx) => (
                  <div key={idx} className="p-4 bg-[#10110f] border border-[#292a27] rounded-lg space-y-2 text-xs font-mono">
                    <div className="text-zinc-300 font-semibold">{tx.description}</div>
                    <div className="text-zinc-500">Target: <span className="text-zinc-400">{tx.target}</span></div>
                    <div className="text-zinc-500">Method: <span className="text-zinc-400">{tx.method}</span></div>
                    <div className="text-zinc-500">Expected State: <span className="text-emerald-400">{tx.expectedState}</span></div>

                    <div className="pt-2">
                      <button
                        onClick={() => handleExecuteTx(tx)}
                        disabled={isPending || !isOwner}
                        className="w-full py-2 rounded bg-[#ff5729] hover:bg-[#ff6f47] disabled:opacity-50 text-black font-semibold text-xs tracking-wider uppercase transition-colors"
                      >
                        {isPending ? 'Confirming...' : isOwner ? 'Sign & Execute with Connected Wallet' : 'Requires Registry Owner'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
