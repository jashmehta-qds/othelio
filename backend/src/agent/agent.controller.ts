import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BasketsService } from '../baskets/baskets.service';
import { AgentProposalsService } from './agent-proposals.service';
import { AgentSettingsService } from './agent-settings.service';
import { AgentGuard } from './agent.guard';
import {
  createBasketProposalSchema,
  depositProposalSchema,
  rebalanceProposalSchema,
  withdrawProposalSchema,
} from './agent.types';

@ApiTags('Agent Interface')
@ApiHeader({
  name: 'X-Agent-Key',
  description: 'Scoped API key configured by the human wallet owner',
  required: true,
})
@UseGuards(AgentGuard)
@Controller('v1/agent')
export class AgentController {
  constructor(
    @Inject(AgentSettingsService)
    private readonly agentSettings: AgentSettingsService,
    @Inject(AgentProposalsService)
    private readonly agentProposals: AgentProposalsService,
    @Inject(BasketsService)
    private readonly basketsService: BasketsService,
  ) {}

  @Get('settings')
  @ApiOperation({
    summary: 'Inspect active agent guardrails & remaining budget',
    description:
      'Returns the deterministic guardrails enforced on this agent key: per-transaction cap, 24h rolling budget, remaining budget, max slippage, market hours gate, and allowed asset whitelist. Agents should inspect this before quoting.',
  })
  @ApiResponse({
    status: 200,
    description: 'Agent settings retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          accountAddress: '0x1958e5d7477ed777390e7034a9cc9719632838c3',
          hasApiKey: true,
          maskedApiKey: 'oth_ag••••••••••••7c4a',
          autonomyTier: 'staged',
          maxSpendPerTxUsd: 500,
          dailySpendLimitUsd: 2000,
          spentTodayUsd: 0,
          remainingDailyBudgetUsd: 2000,
          maxSlippageBps: 50,
          restrictToMarketHours: true,
          minRebalanceDriftBps: 300,
          allowedAssets: [
            'USDC',
            'AAPLc',
            'MSFTc',
            'NVDAc',
            'GOOGLc',
            'AMZNc',
            'METAc',
            'TSLAc',
            'MSTRc',
            'SPCXc',
            'SNDKc',
          ],
          updatedAt: '2026-10-22T16:00:00.000Z',
        },
      },
    },
  })
  async getSettings(@Req() req: any) {
    return {
      success: true,
      data: req.agentSettings,
    };
  }

  @Get('assets')
  @ApiOperation({
    summary: 'List supported tokenized stocks and live Chainlink prices',
    description:
      'Returns all tokenized Coinbase B20 equity assets available on Base with live Chainlink feed prices, contract decimals, and current NYSE market hours open/closed status.',
  })
  @ApiQuery({
    name: 'chainId',
    required: false,
    example: '8453',
    description: 'EVM Chain ID (8453 for Base Mainnet)',
  })
  @ApiResponse({
    status: 200,
    description: 'Asset catalog with live oracle feeds',
    schema: {
      example: {
        success: true,
        isMarketOpen: true,
        data: [
          {
            chainId: 8453,
            assetAddress: '0xb20000000000000000000078ee7ce2fe4908108c',
            symbol: 'NVDAc',
            name: 'NVIDIA Corporation (Tokenized)',
            decimals: 18,
            priceUsdE8: '14620499999',
            isTradeable: true,
          },
          {
            chainId: 8453,
            assetAddress: '0xb200000000000000000000ab99cfa739e253872b',
            symbol: 'MSFTc',
            name: 'Microsoft Corporation (Tokenized)',
            decimals: 18,
            priceUsdE8: '42815000000',
            isTradeable: true,
          },
          {
            chainId: 8453,
            assetAddress: '0xb200000000000000000000c2e324d24d7eecd1fb',
            symbol: 'AAPLc',
            name: 'Apple Inc. (Tokenized)',
            decimals: 18,
            priceUsdE8: '23542000000',
            isTradeable: true,
          },
          {
            chainId: 8453,
            assetAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            priceUsdE8: '100000000',
            isTradeable: true,
          },
        ],
      },
    },
  })
  async getAssets(@Query('chainId') chainId?: string) {
    const assets = await this.basketsService.getAssets(chainId);
    return {
      success: true,
      data: assets.data,
      isMarketOpen: this.agentSettings.isUsMarketOpen(),
    };
  }

  @Get('baskets')
  @ApiOperation({
    summary: 'List user baskets and portfolio overview',
    description:
      'Lists all baskets owned by the user account associated with this agent key, including current valuation in USDC and component counts.',
  })
  @ApiQuery({
    name: 'chainId',
    required: false,
    example: '8453',
    description: 'EVM Chain ID (8453 for Base Mainnet)',
  })
  @ApiResponse({
    status: 200,
    description: 'User basket list',
    schema: {
      example: {
        success: true,
        data: [
          {
            chainId: 8453,
            address: '0x4e2a2098593f0e01051a8de4ae295311d26fb56a',
            controller: '0x1958e5d7477ed777390e7034a9cc9719632838c3',
            name: 'DeltaT',
            symbol: 'OTH-T',
            createdAt: '2026-10-15T18:24:00.000Z',
            totalNavUsdcMicro: '250000000',
            holdingCount: 2,
            targetCount: 2,
            freshness: { status: 'FRESH' },
          },
        ],
      },
    },
  })
  async getBaskets(@Req() req: any, @Query('chainId') chainId?: string) {
    const effectiveChainId = chainId || '8453';
    const baskets = await this.basketsService.getBaskets(effectiveChainId, req.agentAccountAddress);
    return {
      success: true,
      data: baskets,
    };
  }

  @Get('baskets/:address')
  @ApiOperation({
    summary: 'Get detailed basket holdings, target weights, and drift',
    description:
      'Returns real-time basket details, target vs actual component allocations in basis points (100 bps = 1%), current drift, and NAV.',
  })
  @ApiParam({
    name: 'address',
    example: '0x4e2a2098593f0e01051a8de4ae295311d26fb56a',
    description: 'Basket contract address on Base',
  })
  @ApiQuery({
    name: 'chainId',
    required: false,
    example: '8453',
    description: 'EVM Chain ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Detailed basket state and holdings',
    schema: {
      example: {
        success: true,
        data: {
          chainId: 8453,
          address: '0x4e2a2098593f0e01051a8de4ae295311d26fb56a',
          name: 'DeltaT',
          symbol: 'OTH-T',
          controller: '0x1958e5d7477ed777390e7034a9cc9719632838c3',
          navUsd: '250.00',
          components: [
            {
              assetAddress: '0xb20000000000000000000078ee7ce2fe4908108c',
              symbol: 'NVDAc',
              targetWeightBps: 5000,
              currentWeightBps: 5350,
              driftBps: 350,
              priceUsd: '146.20',
            },
            {
              assetAddress: '0xb200000000000000000000ab99cfa739e253872b',
              symbol: 'MSFTc',
              targetWeightBps: 5000,
              currentWeightBps: 4650,
              driftBps: -350,
              priceUsd: '428.15',
            },
          ],
        },
      },
    },
  })
  async getBasketDetail(
    @Param('address') address: string,
    @Query('chainId') chainId?: string,
  ) {
    const effectiveChainId = chainId || '8453';
    const detail = await this.basketsService.getBasketDetail(address, effectiveChainId);
    return {
      success: true,
      data: detail,
    };
  }

  @Post('baskets/create')
  @ApiOperation({
    summary: 'Stage a new basket proposal',
    description:
      'Prepares contract deployment calldata for a new tokenized equity basket. Target weights must sum to exactly 10,000 basis points (100%). Returns a human-in-the-loop review link.',
  })
  @ApiBody({
    description: 'Parameters for creating a tokenized basket',
    schema: {
      type: 'object',
      required: ['name', 'targets'],
      properties: {
        name: { type: 'string', example: 'AI Leaders Basket', description: 'Display name of basket' },
        symbol: { type: 'string', example: 'AILDR', description: 'Optional ticker symbol for basket share token' },
        chainId: { type: 'number', example: 8453, description: 'Target EVM Chain ID (8453 for Base)' },
        targets: {
          type: 'array',
          description: 'Component asset targets summing to 10,000 bps',
          items: {
            type: 'object',
            required: ['symbol', 'targetWeightBps'],
            properties: {
              symbol: { type: 'string', example: 'NVDAc', description: 'Token symbol from tradable asset catalog' },
              targetWeightBps: { type: 'number', example: 5000, description: 'Target allocation in bps (5000 = 50.00%)' },
            },
          },
          example: [
            { symbol: 'NVDAc', targetWeightBps: 5000 },
            { symbol: 'MSFTc', targetWeightBps: 5000 },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Basket creation proposal staged successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'prop_a71b3e89c204',
          accountAddress: '0x1958e5d7477ed777390e7034a9cc9719632838c3',
          basketAddress: null,
          action: 'CREATE_BASKET',
          status: 'PENDING',
          proposalSummary: {
            title: 'Create Basket: AI Leaders Basket (AILDR)',
            description: '2 components: NVDAc (50.00%), MSFTc (50.00%)',
            estimatedUsdValue: 0,
          },
          transactionCall: {
            to: '0xAd21D1aACF2B3c84608e69eAa87B798d27A3915D',
            data: '0x4e29...',
            value: '0',
            chainId: 8453,
          },
          calldataHash: '9b12c7d9a1...',
          signUrl: 'https://app.othelio.fi/app/proposals/prop_a71b3e89c204',
          expiresAt: '2026-10-22T19:00:00.000Z',
          createdAt: '2026-10-22T18:00:00.000Z',
        },
      },
    },
  })
  async createBasketProposal(@Req() req: any, @Body() bodyInput: any) {
    const body = createBasketProposalSchema.parse(bodyInput);
    const proposal = await this.agentProposals.createBasketProposal(req.agentSettings, body);
    return {
      success: true,
      data: proposal,
    };
  }

  @Post('baskets/:address/deposit')
  @ApiOperation({
    summary: 'Stage a basket deposit proposal',
    description:
      'Calculates swap routes through Aerodrome Slipstream V3 to acquire underlying B20 assets according to target allocations using USDC. Validates per-tx spend cap and daily spend budget before staging.',
  })
  @ApiParam({
    name: 'address',
    example: '0x4e2a2098593f0e01051a8de4ae295311d26fb56a',
    description: 'Target basket contract address',
  })
  @ApiBody({
    description: 'Deposit parameters',
    schema: {
      type: 'object',
      required: ['amountUsdc'],
      properties: {
        amountUsdc: { type: 'string', example: '250.00', description: 'Amount of USDC to deposit (formatted in human-readable units)' },
        maxSlippageBps: { type: 'number', example: 50, description: 'Max acceptable slippage in basis points (50 = 0.50%)' },
        chainId: { type: 'number', example: 8453, description: 'Target EVM Chain ID' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Deposit proposal staged successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'prop_e291bc448a07',
          accountAddress: '0x1958e5d7477ed777390e7034a9cc9719632838c3',
          basketAddress: '0x4e2a2098593f0e01051a8de4ae295311d26fb56a',
          action: 'DEPOSIT',
          status: 'PENDING',
          proposalSummary: {
            title: 'Deposit $250.00 USDC into DeltaT',
            description: 'Minting basket shares by acquiring NVDAc and MSFTc according to target allocations with 0.50% max slippage',
            estimatedUsdValue: 250,
          },
          signUrl: 'https://app.othelio.fi/app/proposals/prop_e291bc448a07',
          expiresAt: '2026-10-22T19:00:00.000Z',
          createdAt: '2026-10-22T18:00:00.000Z',
        },
      },
    },
  })
  async createDepositProposal(
    @Req() req: any,
    @Param('address') address: string,
    @Body() bodyInput: any,
  ) {
    const body = depositProposalSchema.parse(bodyInput);
    const proposal = await this.agentProposals.createDepositProposal(req.agentSettings, address, body);
    return {
      success: true,
      data: proposal,
    };
  }

  @Post('baskets/:address/withdraw')
  @ApiOperation({
    summary: 'Stage a basket withdrawal proposal',
    description:
      'Prepares an unwinding transaction redeeming basket shares back to USDC. Beneficiary is strictly locked to the authenticated user wallet address.',
  })
  @ApiParam({
    name: 'address',
    example: '0x4e2a2098593f0e01051a8de4ae295311d26fb56a',
    description: 'Target basket contract address',
  })
  @ApiBody({
    description: 'Withdrawal parameters',
    schema: {
      type: 'object',
      required: ['withdrawValueUsdE8'],
      properties: {
        withdrawValueUsdE8: { type: 'string', example: '10000000000', description: 'USD value to withdraw scaled by 10^8 (10000000000 = $100.00)' },
        chainId: { type: 'number', example: 8453, description: 'Target EVM Chain ID' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Withdrawal proposal staged successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'prop_89fa12b84c31',
          accountAddress: '0x1958e5d7477ed777390e7034a9cc9719632838c3',
          basketAddress: '0x4e2a2098593f0e01051a8de4ae295311d26fb56a',
          action: 'WITHDRAW',
          status: 'PENDING',
          proposalSummary: {
            title: 'Withdraw $100.00 from DeltaT',
            description: 'Redeeming underlying tokens back to USDC for 0x1958...38c3',
            estimatedUsdValue: 100,
          },
          signUrl: 'https://app.othelio.fi/app/proposals/prop_89fa12b84c31',
          expiresAt: '2026-10-22T19:00:00.000Z',
          createdAt: '2026-10-22T18:00:00.000Z',
        },
      },
    },
  })
  async createWithdrawProposal(
    @Req() req: any,
    @Param('address') address: string,
    @Body() bodyInput: any,
  ) {
    const body = withdrawProposalSchema.parse(bodyInput);
    const proposal = await this.agentProposals.createWithdrawProposal(req.agentSettings, address, body);
    return {
      success: true,
      data: proposal,
    };
  }

  @Post('baskets/:address/rebalance')
  @ApiOperation({
    summary: 'Stage a basket rebalance proposal',
    description:
      'Calculates rebalance swaps to bring drifted components back to target weights (or updates target weights). Enforces minimum drift threshold to prevent churn.',
  })
  @ApiParam({
    name: 'address',
    example: '0x4e2a2098593f0e01051a8de4ae295311d26fb56a',
    description: 'Target basket contract address',
  })
  @ApiBody({
    description: 'Rebalance parameters',
    schema: {
      type: 'object',
      properties: {
        maxSlippageBps: { type: 'number', example: 50, description: 'Max acceptable slippage in bps' },
        force: { type: 'boolean', example: false, description: 'Whether to bypass minimum drift threshold' },
        chainId: { type: 'number', example: 8453, description: 'Target EVM Chain ID' },
        updatedTargets: {
          type: 'array',
          description: 'Optional new target weight allocations summing to 10,000 bps',
          items: {
            type: 'object',
            required: ['symbol', 'targetWeightBps'],
            properties: {
              symbol: { type: 'string', example: 'NVDAc' },
              targetWeightBps: { type: 'number', example: 6000 },
            },
          },
          example: [
            { symbol: 'NVDAc', targetWeightBps: 6000 },
            { symbol: 'MSFTc', targetWeightBps: 4000 },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Rebalance proposal staged successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'prop_44bc19a8e02d',
          accountAddress: '0x1958e5d7477ed777390e7034a9cc9719632838c3',
          basketAddress: '0x4e2a2098593f0e01051a8de4ae295311d26fb56a',
          action: 'REBALANCE',
          status: 'PENDING',
          proposalSummary: {
            title: 'Rebalance DeltaT to updated weights',
            description: 'Updating allocations to NVDAc (60.00%), MSFTc (40.00%) with 0.50% max slippage',
            estimatedUsdValue: 0,
          },
          signUrl: 'https://app.othelio.fi/app/proposals/prop_44bc19a8e02d',
          expiresAt: '2026-10-22T19:00:00.000Z',
          createdAt: '2026-10-22T18:00:00.000Z',
        },
      },
    },
  })
  async createRebalanceProposal(
    @Req() req: any,
    @Param('address') address: string,
    @Body() bodyInput: any,
  ) {
    const body = rebalanceProposalSchema.parse(bodyInput);
    const proposal = await this.agentProposals.createRebalanceProposal(req.agentSettings, address, body);
    return {
      success: true,
      data: proposal,
    };
  }
}
