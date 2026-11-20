import { ServiceUnavailableException } from '@nestjs/common';
import type { AdminCapability } from '@othelio/shared';
import { getAddress, isAddress, zeroAddress } from 'viem';
import { supportedRuntimeChainIds } from '../config/network-runtime';

const targets: Record<AdminCapability, readonly string[]> = {
  assetRegistry: ['ASSET_REGISTRY_ADDRESS', 'OTHELIO_ASSET_REGISTRY'],
  riskSplit: ['RISK_SPLIT_FACTORY_ADDRESS'],
  upside: ['UPSIDE_FACTORY_ADDRESS'],
};

export function assertAdminChain(chainId: number): void {
  if (!supportedRuntimeChainIds().some((id) => id === chainId) || chainId !== Number(process.env.CHAIN_ID ?? 8453)) {
    throw new ServiceUnavailableException(`Admin deployment is not configured for chain ${chainId}.`);
  }
}

export function configuredAddress(...keys: string[]): `0x${string}` | null {
  const raw = keys.map((key) => process.env[key]?.trim()).find(Boolean);
  return raw && isAddress(raw) && raw.toLowerCase() !== zeroAddress ? getAddress(raw) : null;
}

export function settlementAdapterForFeed(feed: string, mappingKey: string, ...fallbackKeys: string[]) {
  const mapping = process.env[mappingKey];
  if (mapping) {
    try {
      const raw: unknown = JSON.parse(mapping);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error();
      for (const [key, value] of Object.entries(raw)) {
        if (!isAddress(key) || typeof value !== 'string' || !isAddress(value) || value.toLowerCase() === zeroAddress) {
          throw new Error();
        }
      }
      const matches = Object.entries(raw).filter(([key]) => key.toLowerCase() === feed.toLowerCase());
      if (matches.length > 1) throw new Error();
      if (matches.length === 1) return getAddress(matches[0][1]);
    } catch {
      throw new ServiceUnavailableException(`Invalid settlement adapter configuration: ${mappingKey}.`);
    }
  }
  return configuredAddress(...fallbackKeys);
}

export function adminContracts(chainId: number): Record<AdminCapability, `0x${string}` | null> {
  assertAdminChain(chainId);
  return {
    assetRegistry: configuredAddress(...targets.assetRegistry),
    riskSplit: configuredAddress(...targets.riskSplit),
    upside: configuredAddress(...targets.upside),
  };
}
