import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AgentProposalsService } from './agent-proposals.service';

@ApiTags('Proposals & Execution')
@Controller('v1/proposals')
export class ProposalsController {
  constructor(
    @Inject(AgentProposalsService)
    private readonly agentProposals: AgentProposalsService,
  ) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Get proposal details for signing',
    description: 'Retrieves proposal summary, transaction calldata, and expiration for the human-in-the-loop sign UI.',
  })
  @ApiResponse({ status: 200, description: 'Proposal details retrieved' })
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
    description: 'Records the transaction hash and updates proposal status to EXECUTED once the user signs and broadcasts.',
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
