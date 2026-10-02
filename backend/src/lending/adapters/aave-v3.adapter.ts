import { Injectable } from '@nestjs/common';
import { createPublicClient, http, encodeFunctionData, parseAbi } from 'viem';
import { ILendingAdapter, LendingQuoteParams, LendingQuoteResult } from '../interfaces/lending-adapter.interface';

const AAVE_POOL_ABI = parseAbi([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external',
  'function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) external returns (uint256)',
  'function withdraw(address asset, uint256 amount, address to) external returns (uint256)',
  'function getReserveData(address asset) external view returns ((uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))',
]);

export const AAVE_V3_POOLS: Readonly<Record<number, `0x${string}`>> = {
  8453: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',   // Base Mainnet
  31337: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',  // Local Base fork
};

export const AAVE_RPC_URLS: Readonly<Record<number, string | undefined>> = {
  8453: process.env.BASE_RPC_URL,
  31337: process.env.ANVIL_RPC_URL || process.env.RPC_URL || 'http://127.0.0.1:8545',
};

@Injectable()
export class AaveV3LendingAdapter implements ILendingAdapter {
  readonly name = 'AaveV3';
  readonly supportedChainIds = [31337, 8453];

  async getQuote(params: LendingQuoteParams): Promise<LendingQuoteResult> {
    const targetPool = AAVE_V3_POOLS[params.chainId];
    if (!targetPool) {
      throw new Error(`Aave V3 is not configured for chain ${params.chainId}`);
    }
    const amount = BigInt(params.amount);
    let calldata = '0x';

    if (params.action === 'SUPPLY') {
      calldata = encodeFunctionData({
        abi: AAVE_POOL_ABI,
        functionName: 'supply',
        args: [
          params.assetAddress as `0x${string}`,
          amount,
          params.safeAddress as `0x${string}`,
          0,
        ],
      });
    } else if (params.action === 'BORROW') {
      calldata = encodeFunctionData({
        abi: AAVE_POOL_ABI,
        functionName: 'borrow',
        args: [
          params.assetAddress as `0x${string}`,
          amount,
          BigInt(2),
          0,
          params.safeAddress as `0x${string}`,
        ],
      });
    } else if (params.action === 'REPAY') {
      calldata = encodeFunctionData({
        abi: AAVE_POOL_ABI,
        functionName: 'repay',
        args: [
          params.assetAddress as `0x${string}`,
          amount,
          BigInt(2),
          params.safeAddress as `0x${string}`,
        ],
      });
    } else if (params.action === 'WITHDRAW') {
      calldata = encodeFunctionData({
        abi: AAVE_POOL_ABI,
        functionName: 'withdraw',
        args: [
          params.assetAddress as `0x${string}`,
          amount,
          params.safeAddress as `0x${string}`,
        ],
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
      const rpcUrl = AAVE_RPC_URLS[chainId];
      if (!rpcUrl) {
        return { supplyApy: 0, borrowApy: 0, isAvailable: false };
      }
      const client = createPublicClient({ transport: http(rpcUrl) });

      const reserveData: any = await client.readContract({
        address: targetPool as `0x${string}`,
        abi: AAVE_POOL_ABI,
        functionName: 'getReserveData',
        args: [assetAddress as `0x${string}`],
      });

      const liquidityRate = reserveData?.currentLiquidityRate ?? reserveData?.[2];
      const borrowRate = reserveData?.currentVariableBorrowRate ?? reserveData?.[4];

      if (liquidityRate !== undefined && borrowRate !== undefined && (BigInt(liquidityRate) > 0n || BigInt(borrowRate) > 0n)) {
        const supplyApy = Number(BigInt(liquidityRate)) / 1e25;
        const borrowApy = Number(BigInt(borrowRate)) / 1e25;
        return {
          supplyApy: Number(supplyApy.toFixed(2)),
          borrowApy: Number(borrowApy.toFixed(2)),
          isAvailable: true,
        };
      }
    } catch (err) {
      console.error('[AaveV3LendingAdapter] getLiveRates error:', err);
    }

    return { supplyApy: 0, borrowApy: 0, isAvailable: false };
  }
}
