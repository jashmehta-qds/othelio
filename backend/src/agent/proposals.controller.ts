import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AgentProposalsService } from './agent-proposals.service';

@ApiTags('Proposals & Execution')
@Controller('v1/proposals')
export class ProposalsController {
  constructor(
    @Inject(AgentProposalsService)
    private readonly agentProposals: AgentProposalsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List staged proposals for an account',
    description:
      'Retrieves recently staged proposals for a given wallet address with status (PENDING, EXECUTED, EXPIRED).',
  })
  @ApiQuery({
    name: 'accountAddress',
    example: '0x1958e5d7477ed777390e7034a9cc9719632838c3',
    description: 'Ethereum wallet address of account',
  })
  @ApiResponse({
    status: 200,
    description: 'List of proposals for account',
    schema: {
      example: {
        success: true,
        data: [
          {
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
            calldataHash: '0x4f8a...b12c',
            signUrl: 'https://app.othelio.fi/app/proposals/prop_e291bc448a07',
            expiresAt: '2026-10-22T19:00:00.000Z',
            createdAt: '2026-10-22T18:00:00.000Z',
          },
        ],
      },
    },
  })
  async getProposals(@Query('accountAddress') accountAddress: string) {
    if (!accountAddress) {
      throw new BadRequestException('accountAddress query parameter is required.');
    }
    const proposals = await this.agentProposals.getProposalsForAccount(accountAddress);
    return {
      success: true,
      data: proposals,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get proposal details for signing',
    description:
      'Retrieves proposal summary, transaction calldata, and expiration for the human-in-the-loop sign UI.',
  })
  @ApiParam({
    name: 'id',
    example: 'prop_e291bc448a07',
    description: 'Unique proposal identifier',
  })
  @ApiResponse({
    status: 200,
    description: 'Proposal details retrieved',
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
          transactionCall: {
            to: '0x245836a679b69e16617e2055d8d809EA5858c81C',
            data: '0x9d4e...',
            value: '0',
            chainId: 8453,
          },
          calldataHash: '0x4f8a...b12c',
          signUrl: 'https://app.othelio.fi/app/proposals/prop_e291bc448a07',
          expiresAt: '2026-10-22T19:00:00.000Z',
          createdAt: '2026-10-22T18:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Proposal not found' })
  async getProposal(@Param('id') id: string) {
    const proposal = await this.agentProposals.getProposal(id);
    return {
      success: true,
      data: proposal,
    };
  }

  @Post(':id/confirm')
  @ApiOperation({
    summary: 'Confirm proposal on-chain execution',
    description:
      'Records the on-chain broadcast transaction hash and transitions proposal status to EXECUTED.',
  })
  @ApiParam({
    name: 'id',
    example: 'prop_e291bc448a07',
    description: 'Proposal ID to confirm',
  })
  @ApiBody({
    description: 'Execution confirmation details',
    schema: {
      type: 'object',
      required: ['accountAddress', 'txHash'],
      properties: {
        accountAddress: { type: 'string', example: '0x1958e5d7477ed777390e7034a9cc9719632838c3' },
        txHash: { type: 'string', example: '0x3a7f8e1c4b9d0a2f5e8c1b3d7a9e2f4c6b8d0a1e3f5c7b9d1a3e5f7c9b1d3a5f' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Proposal execution recorded successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'prop_e291bc448a07',
          status: 'EXECUTED',
          executedTxHash: '0x3a7f8e1c4b9d0a2f5e8c1b3d7a9e2f4c6b8d0a1e3f5c7b9d1a3e5f7c9b1d3a5f',
          executedAt: '2026-10-22T18:05:00.000Z',
        },
      },
    },
  })
  async confirmProposal(
    @Param('id') id: string,
    @Body() body: { accountAddress: string; txHash: string },
  ) {
    if (!body?.txHash || !body?.accountAddress) {
      throw new BadRequestException('txHash and accountAddress are required.');
    }
    const proposal = await this.agentProposals.confirmProposalExecution(
      id,
      body.accountAddress,
      body.txHash,
    );
    return {
      success: true,
      data: proposal,
    };
  }
}
