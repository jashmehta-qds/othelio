import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AgentProposalsService } from './agent-proposals.service';
import { DEFAULT_AGENT_SETTINGS } from './agent-settings.service';
import { AgentSettingsResponse } from './agent.types';

describe('AgentProposalsService', () => {
  let service: AgentProposalsService;
  let mockDb: { query: ReturnType<typeof vi.fn> };
  let mockBasketsService: {
    getBasketDetail: ReturnType<typeof vi.fn>;
    quoteSwaps: ReturnType<typeof vi.fn>;
    getAssets: ReturnType<typeof vi.fn>;
  };
  let mockAgentSettingsService: {
    assertGuardrails: ReturnType<typeof vi.fn>;
    recordSpend: ReturnType<typeof vi.fn>;
  };

  const testAddress = '0x1111111111111111111111111111111111111111';

  const testSettings: AgentSettingsResponse = {
    accountAddress: testAddress.toLowerCase(),
    ...DEFAULT_AGENT_SETTINGS,
    spentTodayUsd: 0,
    spentTodayResetAt: new Date().toISOString(),
    hasApiKey: true,
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    mockBasketsService = {
      getBasketDetail: vi.fn(),
      quoteSwaps: vi.fn(),
      getAssets: vi.fn(),
    };
    mockAgentSettingsService = {
      assertGuardrails: vi.fn(),
      recordSpend: vi.fn(),
    };

    service = new AgentProposalsService(
      mockDb as never,
      mockBasketsService as never,
      mockAgentSettingsService as never,
    );
  });

  describe('createBasketProposal', () => {
    it('creates a staged basket proposal when weights sum to 10000 bps', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      const proposal = await service.createBasketProposal(testSettings, {
        name: 'Tech Duo',
        targets: [
          { symbol: 'AAPLc', targetWeightBps: 6000 },
          { symbol: 'MSFTc', targetWeightBps: 4000 },
        ],
      });

      expect(proposal.id.startsWith('prop_')).toBe(true);
      expect(proposal.action).toBe('CREATE_BASKET');
      expect(proposal.status).toBe('PENDING');
      expect(proposal.signUrl).toContain(`/sign/${proposal.id}`);
      expect(proposal.transactionCall.data.startsWith('0x')).toBe(true);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO agent_proposals'),
        expect.any(Array),
      );
    });

    it('rejects basket proposal if target weights do not sum to 10000 bps', async () => {
      await expect(
        service.createBasketProposal(testSettings, {
          name: 'Invalid Sum',
          targets: [
            { symbol: 'AAPLc', targetWeightBps: 5000 },
            { symbol: 'MSFTc', targetWeightBps: 4000 },
          ], // Total 9000
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getProposal', () => {
    it('returns proposal from database', async () => {
      const futureDate = new Date(Date.now() + 60000).toISOString();
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'prop_test123',
            account_address: testAddress,
            basket_address: null,
            action: 'CREATE_BASKET',
            status: 'PENDING',
            proposal_summary: { title: 'Test Proposal', warnings: [] },
            transaction_call: { to: '0x123', data: '0xabc', value: '0', chainId: 8453 },
            calldata_hash: 'hash123',
            expires_at: futureDate,
            created_at: new Date().toISOString(),
          },
        ],
      });

      const proposal = await service.getProposal('prop_test123');
      expect(proposal.id).toBe('prop_test123');
      expect(proposal.status).toBe('PENDING');
    });

    it('marks proposal as EXPIRED if current time is past expires_at', async () => {
      const pastDate = new Date(Date.now() - 60000).toISOString();
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'prop_expired123',
            account_address: testAddress,
            basket_address: null,
            action: 'DEPOSIT',
            status: 'PENDING',
            proposal_summary: { title: 'Expired Deposit', warnings: [] },
            transaction_call: { to: '0x123', data: '0xabc', value: '0', chainId: 8453 },
            calldata_hash: 'hash123',
            expires_at: pastDate,
            created_at: new Date().toISOString(),
          },
        ],
      });
      mockDb.query.mockResolvedValueOnce({ rows: [] }); // For UPDATE

      const proposal = await service.getProposal('prop_expired123');
      expect(proposal.status).toBe('EXPIRED');
    });
  });
});
