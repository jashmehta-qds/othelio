import { Injectable } from '@nestjs/common';
import { createPublicClient, http, encodeFunctionData, parseAbi } from 'viem';
import { ILendingAdapter, LendingQuoteParams, LendingQuoteResult } from '../interfaces/lending-adapter.interface';

const MOONWELL_MTOKEN_ABI = parseAbi([
  'function mint(uint256 mintAmount) external returns (uint256)',
  'function redeem(uint256 redeemTokens) external returns (uint256)',
  'function borrow(uint256 borrowAmount) external returns (uint256)',
  'function repayBorrow(uint256 repayAmount) external returns (uint256)',
  'function supplyRatePerTimestamp() external view returns (uint256)',
  'function borrowRatePerTimestamp() external view returns (uint256)',
]);

const MOONWELL_POOLS: Record<number, string> = {
  8453: '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22',   // Base Mainnet mWUSDC
  31337: '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22',  // Local Base fork
};

const RPC_URLS: Record<number, string | undefined> = {
  8453: process.env.BASE_RPC_URL,
  31337: process.env.ANVIL_RPC_URL || process.env.RPC_URL || 'http://127.0.0.1:8545',
};

const SECONDS_PER_YEAR = 31536000;

@Injectable()
export class MoonwellLendingAdapter implements ILendingAdapter {
  readonly name = 'Moonwell';
  readonly supportedChainIds = [31337, 8453];

  async getQuote(params: LendingQuoteParams): Promise<LendingQuoteResult> {
    const targetPool = MOONWELL_POOLS[params.chainId];
    if (!targetPool) throw new Error(`Moonwell is not configured for chain ${params.chainId}`);
    const amount = BigInt(params.amount);
    let calldata = '0x';

    if (params.action === 'SUPPLY') {
      calldata = encodeFunctionData({
        abi: MOONWELL_MTOKEN_ABI,
        functionName: 'mint',
        args: [amount],
      });
    } else if (params.action === 'BORROW') {
      calldata = encodeFunctionData({
        abi: MOONWELL_MTOKEN_ABI,
        functionName: 'borrow',
        args: [amount],
      });
    } else if (params.action === 'REPAY') {
      calldata = encodeFunctionData({
        abi: MOONWELL_MTOKEN_ABI,
        functionName: 'repayBorrow',
        args: [amount],
      });
    } else if (params.action === 'WITHDRAW') {
      calldata = encodeFunctionData({
        abi: MOONWELL_MTOKEN_ABI,
        functionName: 'redeem',
        args: [amount],
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

      const supplyRatePerSec = (await client.readContract({
        address: targetPool as `0x${string}`,
        abi: MOONWELL_MTOKEN_ABI,
        functionName: 'supplyRatePerTimestamp',
      })) as bigint;

      const borrowRatePerSec = (await client.readContract({
        address: targetPool as `0x${string}`,
        abi: MOONWELL_MTOKEN_ABI,
        functionName: 'borrowRatePerTimestamp',
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
