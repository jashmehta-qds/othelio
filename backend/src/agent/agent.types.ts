import { z } from 'zod';
import { addressSchema, chainIdSchema } from '@othelio/shared';

export type AutonomyTier = 'staged' | 'advisory';

export interface AgentSettingsDto {
  autonomyTier: AutonomyTier;
  maxSpendPerTxUsd: number;
  dailySpendLimitUsd: number;
  maxSlippageBps: number;
  allowedAssets: string[];
  restrictToMarketHours: boolean;
  minRebalanceDriftBps: number;
}

export interface AgentSettingsResponse extends AgentSettingsDto {
  accountAddress: string;
  spentTodayUsd: number;
  spentTodayResetAt: string;
  hasApiKey: boolean;
  maskedApiKey?: string;
  updatedAt: string;
}

export const targetWeightSchema = z.object({
  symbol: z.string().min(1),
  targetWeightBps: z.number().int().positive().max(10000),
});

export const createBasketProposalSchema = z.object({
  name: z.string().min(1).max(64),
  symbol: z.string().min(1).max(16).optional(),
  chainId: chainIdSchema.optional().default(8453),
  targets: z.array(targetWeightSchema).min(1).max(20),
});
export type CreateBasketProposalDto = z.infer<typeof createBasketProposalSchema>;

export const depositProposalSchema = z.object({
  amountUsdc: z.string().min(1),
  maxSlippageBps: z.number().int().min(1).max(1000).optional(),
  chainId: chainIdSchema.optional().default(8453),
});
export type DepositProposalDto = z.infer<typeof depositProposalSchema>;

export const withdrawProposalSchema = z.object({
  withdrawValueUsdE8: z.string().min(1),
  chainId: chainIdSchema.optional().default(8453),
});
export type WithdrawProposalDto = z.infer<typeof withdrawProposalSchema>;

export const rebalanceProposalSchema = z.object({
  updatedTargets: z.array(targetWeightSchema).optional(),
  maxSlippageBps: z.number().int().min(1).max(1000).optional(),
  force: z.boolean().optional().default(false),
  chainId: chainIdSchema.optional().default(8453),
});
export type RebalanceProposalDto = z.infer<typeof rebalanceProposalSchema>;

export interface ProposalSummary {
  action: 'CREATE_BASKET' | 'DEPOSIT' | 'WITHDRAW' | 'REBALANCE';
  title: string;
  description: string;
  accountAddress: string;
  basketAddress?: string;
  estimatedUsdValue: number;
  slippageBps?: number;
  warnings: string[];
  targets?: Array<{ symbol: string; targetWeightBps: number }>;
}

export interface ProposalRecord {
  id: string;
  accountAddress: string;
  basketAddress: string | null;
  action: 'CREATE_BASKET' | 'DEPOSIT' | 'WITHDRAW' | 'REBALANCE';
  status: 'PENDING' | 'EXECUTED' | 'EXPIRED' | 'REJECTED';
  proposalSummary: ProposalSummary;
  transactionCall: {
    to: string;
    data: string;
    value: string;
    chainId: number;
  };
  calldataHash: string;
  expiresAt: string;
  signUrl: string;
  executedTxHash?: string;
  executedAt?: string;
  createdAt: string;
}
