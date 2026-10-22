#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_BASE_URL = process.env.OTHELIO_API_URL || 'http://localhost:3001';
const AGENT_KEY = process.env.OTHELIO_AGENT_KEY || '';

async function fetchFromApi(endpoint: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (AGENT_KEY) {
    headers['X-Agent-Key'] = AGENT_KEY;
  }

  const url = `${API_BASE_URL.replace(/\/$/, '')}${endpoint}`;
  const response = await fetch(url, { ...options, headers });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || `HTTP error ${response.status}`);
  }

  return data;
}

const server = new McpServer({
  name: 'othelio-agent-mcp',
  version: '1.0.0',
});

// Tool 1: Get Agent Settings (Read-Only)
server.tool(
  'othelio_get_agent_settings',
  'Inspect active agent financial guardrails, max spend per tx, remaining daily budget, and allowed asset whitelist.',
  {},
  async () => {
    try {
      const res = await fetchFromApi('/v1/agent/settings');
      return {
        content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to fetch agent settings: ${err.message}` }],
      };
    }
  },
);

// Tool 2: List Supported Assets & Prices
server.tool(
  'othelio_list_supported_assets',
  'Lists all tradeable tokenized equity assets on Base with live Chainlink prices and NYSE market hours status.',
  {
    chainId: z.number().optional().describe('Chain ID (8453 for Base Mainnet, 31337 for local fork)'),
  },
  async ({ chainId }) => {
    try {
      const q = chainId ? `?chainId=${chainId}` : '';
      const res = await fetchFromApi(`/v1/agent/assets${q}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                isMarketOpen: res.isMarketOpen,
                assetCount: res.data?.length ?? 0,
                assets: res.data?.map((a: any) => ({
                  symbol: a.symbol,
                  name: a.name,
                  priceUsd: a.priceUsdE8 ? (Number(a.priceUsdE8) / 1e8).toFixed(2) : null,
                  tradeable: a.tradeable,
                  status: a.status,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to list assets: ${err.message}` }],
      };
    }
  },
);

// Tool 3: List User Baskets
server.tool(
  'othelio_list_user_baskets',
  'Lists all baskets owned by the user account associated with the agent key, including current NAV, PnL, and allocation drift.',
  {
    chainId: z.number().optional().describe('Chain ID (default: 8453)'),
  },
  async ({ chainId }) => {
    try {
      const q = chainId ? `?chainId=${chainId}` : '';
      const res = await fetchFromApi(`/v1/agent/baskets${q}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to list user baskets: ${err.message}` }],
      };
    }
  },
);

// Tool 4: Get Basket Detail
server.tool(
  'othelio_get_basket_detail',
  'Retrieves granular details of a basket, including current holdings, target weights, valuation, and performance.',
  {
    basketAddress: z.string().describe('The contract address of the basket'),
    chainId: z.number().optional().describe('Chain ID (default: 8453)'),
  },
  async ({ basketAddress, chainId }) => {
    try {
      const q = chainId ? `?chainId=${chainId}` : '';
      const res = await fetchFromApi(`/v1/agent/baskets/${basketAddress}${q}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to fetch basket detail: ${err.message}` }],
      };
    }
  },
);

// Tool 5: Stage Basket Creation Proposal
server.tool(
  'othelio_stage_create_basket',
  'Stages a proposal to create a new investment basket with a defined target asset composition. Returns a human-in-the-loop signing URL.',
  {
    name: z.string().describe('The name of the basket (e.g. "Tech Giants Basket")'),
    symbol: z.string().optional().describe('Optional symbol for the basket'),
    targets: z
      .array(
        z.object({
          symbol: z.string().describe('Asset symbol (e.g. "AAPLc", "NVDAc", "USDC")'),
          targetWeightBps: z.number().int().describe('Target weight in basis points (e.g. 4000 = 40%). Must sum to 10000.'),
        }),
      )
      .describe('Array of target asset allocations totaling 10000 bps (100%)'),
    chainId: z.number().optional().describe('Chain ID (default: 8453)'),
  },
  async ({ name, symbol, targets, chainId }) => {
    try {
      const res = await fetchFromApi('/v1/agent/baskets/create', {
        method: 'POST',
        body: JSON.stringify({ name, symbol, targets, chainId }),
      });
      return {
        content: [
          {
            type: 'text',
            text: `Basket creation proposal successfully staged!\n\n` +
                  `Proposal ID: ${res.data.id}\n` +
                  `Sign URL: ${res.data.signUrl}\n` +
                  `Expires At: ${res.data.expiresAt}\n\n` +
                  `Please ask the user to review and sign the transaction at the link above.`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to stage basket creation: ${err.message}` }],
      };
    }
  },
);

// Tool 6: Stage Deposit Proposal
server.tool(
  'othelio_stage_deposit',
  'Stages adding USDC to an existing basket. Simulates optimal multi-hop swap routes on Aerodrome Slipstream into target allocations and generates a human signing link.',
  {
    basketAddress: z.string().describe('Address of the basket to fund'),
    amountUsdc: z.string().describe('Amount of USDC to deposit (e.g. "250.00")'),
    maxSlippageBps: z.number().optional().describe('Maximum allowed slippage in bps (default: user guardrail setting)'),
    chainId: z.number().optional().describe('Chain ID (default: 8453)'),
  },
  async ({ basketAddress, amountUsdc, maxSlippageBps, chainId }) => {
    try {
      const res = await fetchFromApi(`/v1/agent/baskets/${basketAddress}/deposit`, {
        method: 'POST',
        body: JSON.stringify({ amountUsdc, maxSlippageBps, chainId }),
      });
      return {
        content: [
          {
            type: 'text',
            text: `Deposit proposal successfully staged!\n\n` +
                  `Proposal ID: ${res.data.id}\n` +
                  `Estimated Value: $${res.data.proposalSummary.estimatedUsdValue.toFixed(2)} USDC\n` +
                  `Sign URL: ${res.data.signUrl}\n` +
                  `Expires At: ${res.data.expiresAt}\n\n` +
                  `Please ask the user to review and confirm the deposit at the link above.`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to stage deposit: ${err.message}` }],
      };
    }
  },
);

// Tool 7: Stage Withdraw Proposal
server.tool(
  'othelio_stage_withdraw',
  'Stages withdrawing value from a basket in-kind. Destination is strictly locked to the basket owner wallet.',
  {
    basketAddress: z.string().describe('Address of the basket to withdraw from'),
    withdrawValueUsdE8: z.string().describe('USD value to withdraw in 8-decimal fixed point (e.g. "10000000000" = $100.00)'),
    chainId: z.number().optional().describe('Chain ID (default: 8453)'),
  },
  async ({ basketAddress, withdrawValueUsdE8, chainId }) => {
    try {
      const res = await fetchFromApi(`/v1/agent/baskets/${basketAddress}/withdraw`, {
        method: 'POST',
        body: JSON.stringify({ withdrawValueUsdE8, chainId }),
      });
      return {
        content: [
          {
            type: 'text',
            text: `Withdrawal proposal successfully staged!\n\n` +
                  `Proposal ID: ${res.data.id}\n` +
                  `Sign URL: ${res.data.signUrl}\n` +
                  `Expires At: ${res.data.expiresAt}\n\n` +
                  `Please ask the user to confirm the withdrawal at the link above.`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to stage withdrawal: ${err.message}` }],
      };
    }
  },
);

// Tool 8: Stage Rebalance Proposal
server.tool(
  'othelio_stage_rebalance',
  'Stages rebalancing a basket back to its target weights or updated target allocations via Aerodrome Slipstream.',
  {
    basketAddress: z.string().describe('Address of the basket to rebalance'),
    updatedTargets: z
      .array(
        z.object({
          symbol: z.string().describe('Asset symbol'),
          targetWeightBps: z.number().int().describe('Weight in basis points (must sum to 10000)'),
        }),
      )
      .optional()
      .describe('Optional updated target weights. If omitted, rebalances back to existing targets.'),
    maxSlippageBps: z.number().optional().describe('Max slippage in basis points'),
    force: z.boolean().optional().describe('If true, rebalances even if drift is under min_rebalance_drift_bps'),
    chainId: z.number().optional().describe('Chain ID (default: 8453)'),
  },
  async ({ basketAddress, updatedTargets, maxSlippageBps, force, chainId }) => {
    try {
      const res = await fetchFromApi(`/v1/agent/baskets/${basketAddress}/rebalance`, {
        method: 'POST',
        body: JSON.stringify({ updatedTargets, maxSlippageBps, force, chainId }),
      });
      return {
        content: [
          {
            type: 'text',
            text: `Rebalance proposal successfully staged!\n\n` +
                  `Proposal ID: ${res.data.id}\n` +
                  `Sign URL: ${res.data.signUrl}\n` +
                  `Expires At: ${res.data.expiresAt}\n\n` +
                  `Please ask the user to review and sign the rebalance at the link above.`,
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to stage rebalance: ${err.message}` }],
      };
    }
  },
);

// Tool 9: Get Proposal Status
server.tool(
  'othelio_get_proposal_status',
  'Check the status (PENDING, EXECUTED, EXPIRED) and details of a staged proposal.',
  {
    proposalId: z.string().describe('The ID of the proposal (e.g. "prop_...")'),
  },
  async ({ proposalId }) => {
    try {
      const res = await fetchFromApi(`/v1/proposals/${proposalId}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to get proposal status: ${err.message}` }],
      };
    }
  },
);

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

run().catch((error) => {
  console.error('Fatal MCP Server error:', error);
  process.exit(1);
});
