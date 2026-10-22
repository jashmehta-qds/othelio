import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { addressSchema, chainIdSchema } from '@othelio/shared';
import * as crypto from 'crypto';
import { encodeFunctionData, parseUnits } from 'viem';
import { DatabaseService } from '../database/database.service';
import { BasketsService } from '../baskets/baskets.service';
import { AgentSettingsService } from './agent-settings.service';
import {
  AgentSettingsResponse,
  CreateBasketProposalDto,
  DepositProposalDto,
  ProposalRecord,
  ProposalSummary,
  RebalanceProposalDto,
  WithdrawProposalDto,
} from './agent.types';

const FACTORY_ABI = [
  {
    type: 'function',
    name: 'createBasket',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: 'basket', type: 'address' }],
  },
] as const;

export const DEFAULT_FACTORY_ADDRESS = (process.env.FACTORY_ADDRESS || '0xAd21D1aACF2B3c84608e69eAa87B798d27A3915D') as `0x${string}`;
export const DEFAULT_MODULE_ADDRESS = (process.env.MODULE_ADDRESS || '0x245836a679b69e16617e2055d8d809EA5858c81C') as `0x${string}`;
export const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

@Injectable()
export class AgentProposalsService {
  constructor(
    @Inject(DatabaseService)
    private readonly db: DatabaseService,
    @Inject(BasketsService)
    private readonly basketsService: BasketsService,
    @Inject(AgentSettingsService)
    private readonly agentSettings: AgentSettingsService,
  ) {}

  private hashCalldata(calldata: string): string {
    return crypto.createHash('sha256').update(calldata.toLowerCase()).digest('hex');
  }

  private generateProposalId(): string {
    return `prop_${crypto.randomBytes(16).toString('hex')}`;
  }

  private getAppBaseUrl(): string {
    return process.env.APP_URL || process.env.FRONTEND_URL || 'https://app.othelio.fi';
  }

  async createBasketProposal(
    settings: AgentSettingsResponse,
    dto: CreateBasketProposalDto,
  ): Promise<ProposalRecord> {
    const chainId = dto.chainId ?? 8453;
    const cleanName = dto.name.trim();

    // Verify weights total 10,000 bps (100%)
    const totalWeight = dto.targets.reduce((acc, t) => acc + t.targetWeightBps, 0);
    if (totalWeight !== 10000) {
      throw new BadRequestException(
        `Target weights must total 10000 bps (100%). Currently provided: ${totalWeight} bps.`,
      );
    }

    // Guardrail check for allowed assets
    const targetSymbols = dto.targets.map((t) => t.symbol);
    this.agentSettings.assertGuardrails(settings, 0, targetSymbols);

    // Encode factory createBasket call
    const calldata = encodeFunctionData({
      abi: FACTORY_ABI,
      functionName: 'createBasket',
      args: [cleanName],
    });

    const proposalId = this.generateProposalId();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins for basket creation
    const calldataHash = this.hashCalldata(calldata);
    const factoryAddress = (process.env[`FACTORY_ADDRESS_${chainId}`] || DEFAULT_FACTORY_ADDRESS).toLowerCase();

    const summary: ProposalSummary = {
      action: 'CREATE_BASKET',
      title: `Create Basket "${cleanName}"`,
      description: `Create new investment basket with target composition: ${dto.targets
        .map((t) => `${(t.targetWeightBps / 100).toFixed(1)}% ${t.symbol}`)
        .join(', ')}.`,
      accountAddress: settings.accountAddress,
      estimatedUsdValue: 0,
      warnings: [],
      targets: dto.targets,
    };

    const call = {
      to: factoryAddress,
      data: calldata,
      value: '0',
      chainId,
    };

    await this.db.query(
      `INSERT INTO agent_proposals (
        id, account_address, basket_address, action, status,
        proposal_summary, transaction_call, calldata_hash, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7, $8, NOW())`,
      [
        proposalId,
        settings.accountAddress,
        null,
        'CREATE_BASKET',
        JSON.stringify(summary),
        JSON.stringify(call),
        calldataHash,
        expiresAt.toISOString(),
      ],
    );

    return {
      id: proposalId,
      accountAddress: settings.accountAddress,
      basketAddress: null,
      action: 'CREATE_BASKET',
      status: 'PENDING',
      proposalSummary: summary,
      transactionCall: call,
      calldataHash,
      expiresAt: expiresAt.toISOString(),
      signUrl: `${this.getAppBaseUrl()}/sign/${proposalId}`,
      createdAt: new Date().toISOString(),
    };
  }

  async createDepositProposal(
    settings: AgentSettingsResponse,
    rawBasketAddress: string,
    dto: DepositProposalDto,
  ): Promise<ProposalRecord> {
    const basketAddress = addressSchema.parse(rawBasketAddress).toLowerCase();
    const chainId = dto.chainId ?? 8453;
    const amountNum = parseFloat(dto.amountUsdc);

    if (isNaN(amountNum) || amountNum <= 0) {
      throw new BadRequestException('Deposit amount must be a positive number.');
    }

    // Verify basket existence & target composition
    const basketRes = await this.basketsService.getBasketDetail(basketAddress, String(chainId), settings.accountAddress);
    const detail = basketRes.data;
    if (!detail) {
      throw new NotFoundException('Basket not found.');
    }

    const holdings = detail.holdings || [];
    const symbols = holdings.map((h: any) => h.symbol || 'USDC');

    // Server-side guardrail assertion
    this.agentSettings.assertGuardrails(settings, amountNum, symbols);

    const slippageBps = dto.maxSlippageBps ?? settings.maxSlippageBps;
    if (slippageBps > settings.maxSlippageBps) {
      throw new ForbiddenException(
        `Requested slippage (${slippageBps} bps) exceeds user-configured max slippage (${settings.maxSlippageBps} bps).`,
      );
    }

    // Input amount in USDC base units (6 decimals)
    const amountRaw = parseUnits(dto.amountUsdc, 6).toString();
    const moduleAddress = (process.env[`MODULE_ADDRESS_${chainId}`] || DEFAULT_MODULE_ADDRESS).toLowerCase();

    // Generate bounded swap quote
    const quoteRes = await this.basketsService.quoteSwaps(basketAddress, {
      action: 'mint',
      chainId,
      moduleAddress,
      callerAddress: settings.accountAddress,
      inputAmount: amountRaw,
      slippageBps,
      holdings: holdings.map((h: any) => ({
        address: h.assetAddress,
        targetWeightBps: Math.round(Number(h.target ?? 0) * 100),
      })),
    });

    const quote = quoteRes?.data;
    const plan = quote?.plan;
    const call = plan?.calls?.[0];

    if (!quoteRes?.executionAllowed || !plan || !call) {
      throw new BadRequestException(
        (quote as any)?.preparationReason || 'The funding route could not be verified for execution.',
      );
    }

    const proposalId = this.generateProposalId();
    const expiresAt = new Date(plan.expiresAt || Date.now() + 5 * 60 * 1000);
    const calldataHash = this.hashCalldata(call.calldata);

    const rawWarnings = quote?.warnings || [];
    const stringWarnings = rawWarnings.map((w: any) => (typeof w === 'string' ? w : w.message || w.code || JSON.stringify(w)));

    const summary: ProposalSummary = {
      action: 'DEPOSIT',
      title: `Deposit $${amountNum.toFixed(2)} USDC into ${detail.summary.name || 'Basket'}`,
      description: `Deposit $${amountNum.toFixed(2)} USDC routed through Aerodrome Slipstream into target basket allocations.`,
      accountAddress: settings.accountAddress,
      basketAddress,
      estimatedUsdValue: amountNum,
      slippageBps,
      warnings: stringWarnings,
    };

    const txCall = {
      to: call.to.toLowerCase(),
      data: call.calldata,
      value: call.valueBaseUnits || '0',
      chainId,
    };

    await this.db.query(
      `INSERT INTO agent_proposals (
        id, account_address, basket_address, action, status,
        proposal_summary, transaction_call, calldata_hash, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7, $8, NOW())`,
      [
        proposalId,
        settings.accountAddress,
        basketAddress,
        'DEPOSIT',
        JSON.stringify(summary),
        JSON.stringify(txCall),
        calldataHash,
        expiresAt.toISOString(),
      ],
    );

    return {
      id: proposalId,
      accountAddress: settings.accountAddress,
      basketAddress,
      action: 'DEPOSIT',
      status: 'PENDING',
      proposalSummary: summary,
      transactionCall: txCall,
      calldataHash,
      expiresAt: expiresAt.toISOString(),
      signUrl: `${this.getAppBaseUrl()}/sign/${proposalId}`,
      createdAt: new Date().toISOString(),
    };
  }

  async createWithdrawProposal(
    settings: AgentSettingsResponse,
    rawBasketAddress: string,
    dto: WithdrawProposalDto,
  ): Promise<ProposalRecord> {
    const basketAddress = addressSchema.parse(rawBasketAddress).toLowerCase();
    const chainId = dto.chainId ?? 8453;

    // Recipient is STRICTLY locked to the authenticated user's wallet address (anti-drain defense)
    const recipientAddress = settings.accountAddress;
    const moduleAddress = (process.env[`MODULE_ADDRESS_${chainId}`] || DEFAULT_MODULE_ADDRESS).toLowerCase();

    const quoteRes = await this.basketsService.quoteSwaps(basketAddress, {
      action: 'withdraw',
      chainId,
      moduleAddress,
      callerAddress: settings.accountAddress,
      recipientAddress,
      withdrawValueUsdE8: dto.withdrawValueUsdE8,
    });

    const quote = quoteRes?.data;
    const plan = quote?.plan;
    const call = plan?.calls?.[0];

    if (!quoteRes?.executionAllowed || !plan || !call) {
      throw new BadRequestException(
        (quote as any)?.preparationReason || 'The withdrawal route could not be verified for execution.',
      );
    }

    const proposalId = this.generateProposalId();
    const expiresAt = new Date(plan.expiresAt || Date.now() + 5 * 60 * 1000);
    const calldataHash = this.hashCalldata(call.calldata);
    const estimatedUsd = Number(BigInt(dto.withdrawValueUsdE8) / BigInt(1e8));

    const rawWithdrawWarnings = quote?.warnings || [];
    const stringWithdrawWarnings = rawWithdrawWarnings.map((w: any) => (typeof w === 'string' ? w : w.message || w.code || JSON.stringify(w)));

    const summary: ProposalSummary = {
      action: 'WITHDRAW',
      title: `Withdraw ~$${estimatedUsd.toFixed(2)} from Basket`,
      description: `In-kind withdrawal of ~$${estimatedUsd.toFixed(2)} to wallet ${recipientAddress}.`,
      accountAddress: settings.accountAddress,
      basketAddress,
      estimatedUsdValue: estimatedUsd,
      warnings: stringWithdrawWarnings,
    };

    const txCall = {
      to: call.to.toLowerCase(),
      data: call.calldata,
      value: call.valueBaseUnits || '0',
      chainId,
    };

    await this.db.query(
      `INSERT INTO agent_proposals (
        id, account_address, basket_address, action, status,
        proposal_summary, transaction_call, calldata_hash, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7, $8, NOW())`,
      [
        proposalId,
        settings.accountAddress,
        basketAddress,
        'WITHDRAW',
        JSON.stringify(summary),
        JSON.stringify(txCall),
        calldataHash,
        expiresAt.toISOString(),
      ],
    );

    return {
      id: proposalId,
      accountAddress: settings.accountAddress,
      basketAddress,
      action: 'WITHDRAW',
      status: 'PENDING',
      proposalSummary: summary,
      transactionCall: txCall,
      calldataHash,
      expiresAt: expiresAt.toISOString(),
      signUrl: `${this.getAppBaseUrl()}/sign/${proposalId}`,
      createdAt: new Date().toISOString(),
    };
  }

  async createRebalanceProposal(
    settings: AgentSettingsResponse,
    rawBasketAddress: string,
    dto: RebalanceProposalDto,
  ): Promise<ProposalRecord> {
    const basketAddress = addressSchema.parse(rawBasketAddress).toLowerCase();
    const chainId = dto.chainId ?? 8453;
    const moduleAddress = (process.env[`MODULE_ADDRESS_${chainId}`] || DEFAULT_MODULE_ADDRESS).toLowerCase();

    const quoteRes = await this.basketsService.quoteSwaps(basketAddress, {
      action: 'rebalance',
      chainId,
      moduleAddress,
      callerAddress: settings.accountAddress,
      targetWeights: dto.updatedTargets?.map((t) => ({
        symbol: t.symbol,
        targetWeightBps: t.targetWeightBps,
      })),
      slippageBps: dto.maxSlippageBps ?? settings.maxSlippageBps,
    });

    const quote = quoteRes?.data;
    const plan = quote?.plan;
    const call = plan?.calls?.[0];

    if (!quoteRes?.executionAllowed || !plan || !call) {
      throw new BadRequestException(
        (quote as any)?.preparationReason || 'The rebalance plan could not be verified for execution.',
      );
    }

    const proposalId = this.generateProposalId();
    const expiresAt = new Date(plan.expiresAt || Date.now() + 5 * 60 * 1000);
    const calldataHash = this.hashCalldata(call.calldata);

    const rawRebalWarnings = quote?.warnings || [];
    const stringRebalWarnings = rawRebalWarnings.map((w: any) => (typeof w === 'string' ? w : w.message || w.code || JSON.stringify(w)));

    const summary: ProposalSummary = {
      action: 'REBALANCE',
      title: `Rebalance Basket Portfolio`,
      description: `Rebalance holdings back to target allocations via Aerodrome Slipstream.`,
      accountAddress: settings.accountAddress,
      basketAddress,
      estimatedUsdValue: 0,
      slippageBps: dto.maxSlippageBps ?? settings.maxSlippageBps,
      warnings: stringRebalWarnings,
    };

    const txCall = {
      to: call.to.toLowerCase(),
      data: call.calldata,
      value: call.valueBaseUnits || '0',
      chainId,
    };

    await this.db.query(
      `INSERT INTO agent_proposals (
        id, account_address, basket_address, action, status,
        proposal_summary, transaction_call, calldata_hash, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7, $8, NOW())`,
      [
        proposalId,
        settings.accountAddress,
        basketAddress,
        'REBALANCE',
        JSON.stringify(summary),
        JSON.stringify(txCall),
        calldataHash,
        expiresAt.toISOString(),
      ],
    );

    return {
      id: proposalId,
      accountAddress: settings.accountAddress,
      basketAddress,
      action: 'REBALANCE',
      status: 'PENDING',
      proposalSummary: summary,
      transactionCall: txCall,
      calldataHash,
      expiresAt: expiresAt.toISOString(),
      signUrl: `${this.getAppBaseUrl()}/sign/${proposalId}`,
      createdAt: new Date().toISOString(),
    };
  }

  async getProposal(proposalId: string): Promise<ProposalRecord> {
    const result = await this.db.query(
      `SELECT id, account_address, basket_address, action, status, proposal_summary,
              transaction_call, calldata_hash, expires_at, executed_tx_hash, executed_at, created_at
       FROM agent_proposals
       WHERE id = $1`,
      [proposalId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException('Proposal not found.');
    }

    const row = result.rows[0];
    const now = new Date();
    const expiresAt = new Date(row.expires_at);

    let status = row.status;
    if (status === 'PENDING' && now > expiresAt) {
      status = 'EXPIRED';
      await this.db.query(
        `UPDATE agent_proposals SET status = 'EXPIRED' WHERE id = $1`,
        [proposalId],
      );
    }

    return {
      id: row.id,
      accountAddress: row.account_address.trim().toLowerCase(),
      basketAddress: row.basket_address ? row.basket_address.trim().toLowerCase() : null,
      action: row.action,
      status,
      proposalSummary: typeof row.proposal_summary === 'string' ? JSON.parse(row.proposal_summary) : row.proposal_summary,
      transactionCall: typeof row.transaction_call === 'string' ? JSON.parse(row.transaction_call) : row.transaction_call,
      calldataHash: row.calldata_hash,
      expiresAt: expiresAt.toISOString(),
      signUrl: `${this.getAppBaseUrl()}/sign/${row.id}`,
      executedTxHash: row.executed_tx_hash ?? undefined,
      executedAt: row.executed_at ? new Date(row.executed_at).toISOString() : undefined,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async confirmProposalExecution(
    proposalId: string,
    rawAccountAddress: string,
    txHash: string,
  ): Promise<ProposalRecord> {
    const accountAddress = addressSchema.parse(rawAccountAddress).toLowerCase();
    const proposal = await this.getProposal(proposalId);

    if (proposal.accountAddress.toLowerCase() !== accountAddress) {
      throw new ForbiddenException('Cannot confirm a proposal for a different wallet.');
    }

    if (proposal.status !== 'PENDING') {
      throw new BadRequestException(`Cannot confirm proposal in status: ${proposal.status}.`);
    }

    await this.db.query(
      `UPDATE agent_proposals
       SET status = 'EXECUTED', executed_tx_hash = $1, executed_at = NOW()
       WHERE id = $2`,
      [txHash, proposalId],
    );

    // Record spend against daily limit if it was a deposit
    if (proposal.action === 'DEPOSIT' && proposal.proposalSummary.estimatedUsdValue > 0) {
      await this.agentSettings.recordSpend(accountAddress, proposal.proposalSummary.estimatedUsdValue);
    }

    return this.getProposal(proposalId);
  }
}
