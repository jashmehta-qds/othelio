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
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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
    summary: 'Inspect active agent guardrails (Read-Only)',
    description: 'Returns the active spend limits, remaining daily budget, and allowed asset list configured by the user.',
  })
  @ApiResponse({ status: 200, description: 'Agent settings retrieved successfully' })
  async getSettings(@Req() req: any) {
    return {
      success: true,
      data: req.agentSettings,
    };
  }

  @Get('assets')
  @ApiOperation({
    summary: 'List supported assets and live oracle prices',
    description: 'Returns all tokenized equity assets available on Base with live Chainlink feed prices and tradeable status.',
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
    description: 'Lists all baskets owned by the user account associated with this agent key.',
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
    summary: 'Get basket detail and holdings',
    description: 'Returns full breakdown of holdings, target allocations, current valuation, and performance.',
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
    summary: 'Stage a basket creation proposal',
    description: 'Generates verified factory calldata and an approval deep-link for the user to create a new basket.',
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
    description: 'Simulates Aerodrome Slipstream swap routes and generates bounded calldata for adding USDC to a basket.',
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
    description: 'Simulates unwinding a basket position. Recipient is strictly locked to the authenticated user wallet.',
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
    description: 'Simulates multi-hop rebalance swaps back to target allocations or with updated targets.',
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
