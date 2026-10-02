import { Injectable } from '@nestjs/common';
import { createPublicClient, http, encodeFunctionData, parseAbi } from 'viem';
import { ILendingAdapter, LendingQuoteParams, LendingQuoteResult } from '../interfaces/lending-adapter.interface';

const COMPOUND_V3_COMET_ABI = parseAbi([
  'function supply(address asset, uint256 amount) external',
  'function withdraw(address asset, uint256 amount) external',
  'function getUtilization() external view returns (uint256)',
  'function getSupplyRate(uint256 utilization) external view returns (uint64)',
  'function getBorrowRate(uint256 utilization) external view returns (uint64)',
]);

const COMPOUND_V3_POOLS: Record<number, string> = {
  8453: '0xb125E6687d4313864e53df431d5425969c15Eb2F',   // Base Mainnet cUSDCv3
  31337: '0xb125E6687d4313864e53df431d5425969c15Eb2F',  // Local Base fork
};

const RPC_URLS: Record<number, string | undefined> = {
  8453: process.env.BASE_RPC_URL,
  31337: process.env.ANVIL_RPC_URL || process.env.RPC_URL || 'http://127.0.0.1:8545',
};

const SECONDS_PER_YEAR = 31536000;

@Injectable()
export class CompoundV3LendingAdapter implements ILendingAdapter {
  readonly name = 'CompoundV3';
  readonly supportedChainIds = [31337, 8453];

  async getQuote(params: LendingQuoteParams): Promise<LendingQuoteResult> {
    const targetPool = COMPOUND_V3_POOLS[params.chainId];
    if (!targetPool) throw new Error(`Compound V3 is not configured for chain ${params.chainId}`);
    const amount = BigInt(params.amount);
    let calldata = '0x';

    if (params.action === 'SUPPLY' || params.action === 'REPAY') {
      calldata = encodeFunctionData({
        abi: COMPOUND_V3_COMET_ABI,
        functionName: 'supply',
        args: [params.assetAddress as `0x${string}`, amount],
      });
    } else {
      calldata = encodeFunctionData({
        abi: COMPOUND_V3_COMET_ABI,
        functionName: 'withdraw',
        args: [params.assetAddress as `0x${string}`, amount],
      });
    }

    const { supplyApy, borrowApy, isAvailable } = await this.getLiveRates(params.chainId, targetPool, params.assetAddress);

    return {
      providerName: this.name,
      targetPool,
      action: params.action,
      calldata,
      assetAddress: params.assetAddress,
      amount: params.amount,
      supplyApy,
      borrowApy,
      isAvailable,
    };
  }

  private async getLiveRates(
    chainId: number,
    targetPool: string,
    assetAddress: string,
  ): Promise<{ supplyApy: number; borrowApy: number; isAvailable: boolean }> {
    try {
      const rpcUrl = RPC_URLS[chainId];
      if (!rpcUrl) throw new Error(`No RPC is configured for chain ${chainId}`);
      const client = createPublicClient({ transport: http(rpcUrl) });

      const utilization = (await client.readContract({
        address: targetPool as `0x${string}`,
        abi: COMPOUND_V3_COMET_ABI,
        functionName: 'getUtilization',
      })) as bigint;

      const supplyRatePerSec = (await client.readContract({
        address: targetPool as `0x${string}`,
        abi: COMPOUND_V3_COMET_ABI,
        functionName: 'getSupplyRate',
        args: [utilization],
      })) as bigint;

      const borrowRatePerSec = (await client.readContract({
        address: targetPool as `0x${string}`,
        abi: COMPOUND_V3_COMET_ABI,
        functionName: 'getBorrowRate',
        args: [utilization],
      })) as bigint;

      if (supplyRatePerSec > 0n) {
        const supplyApy = (Number(supplyRatePerSec) / 1e18) * SECONDS_PER_YEAR * 100;
        const borrowApy = (Number(borrowRatePerSec) / 1e18) * SECONDS_PER_YEAR * 100;

        return {
          supplyApy: Number(supplyApy.toFixed(2)),
          borrowApy: Number(borrowApy.toFixed(2)),
          isAvailable: true,
        };
      }
    } catch {
      // Unlisted asset or pool query error on target chain
    }

    return { supplyApy: 0, borrowApy: 0, isAvailable: false };
  }
}
