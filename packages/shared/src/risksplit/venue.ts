// packages/shared/src/risksplit/venue.ts
// Verified 0x v4 Settlement Venue Integration for Risk Split Markets on Base

import { z } from 'zod';

export const ZERO_EX_EXCHANGE_PROXY_BASE = '0xDef1C0ded9bec7F1a1670819833240f027b25EfF' as const;
export const BASE_CHAIN_ID = 8453 as const;

export const ZERO_EX_EIP712_DOMAIN = {
  name: 'ZeroEx',
  version: '1.0.0',
  chainId: BASE_CHAIN_ID,
  verifyingContract: ZERO_EX_EXCHANGE_PROXY_BASE,
} as const;

export enum OrderStatus {
  INVALID = 0,
  FILLABLE = 1,
  FILLED = 2,
  CANCELLED = 3,
  EXPIRED = 4,
}

export interface ZeroExLimitOrder {
  makerToken: `0x${string}`;
  takerToken: `0x${string}`;
  makerAmount: string; // uint128 string
  takerAmount: string; // uint128 string
  takerTokenFeeAmount: string; // uint128 string (0 for standard Risk Split)
  maker: `0x${string}`;
  taker: `0x${string}`; // address(0) for public limit orders
  sender: `0x${string}`; // address(0) for any relayer
  feeRecipient: `0x${string}`;
  pool: `0x${string}`; // bytes32(0)
  expiry: number; // uint64 unix timestamp in seconds
  salt: string; // uint256 string
}

export interface ZeroExSignature {
  signatureType: number; // 2 for EIP-712
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

export interface SignedOrder {
  order: ZeroExLimitOrder;
  signature: ZeroExSignature;
  orderHash: `0x${string}`;
  createdAt: number;
}

export interface OrderInfo {
  orderHash: `0x${string}`;
  status: OrderStatus;
  takerTokenFilledAmount: string;
}

export const LIMIT_ORDER_EIP712_TYPES = {
  LimitOrder: [
    { name: 'makerToken', type: 'address' },
    { name: 'takerToken', type: 'address' },
    { name: 'makerAmount', type: 'uint128' },
    { name: 'takerAmount', type: 'uint128' },
    { name: 'takerTokenFeeAmount', type: 'uint128' },
    { name: 'maker', type: 'address' },
    { name: 'taker', type: 'address' },
    { name: 'sender', type: 'address' },
    { name: 'feeRecipient', type: 'address' },
    { name: 'pool', type: 'bytes32' },
    { name: 'expiry', type: 'uint64' },
    { name: 'salt', type: 'uint256' },
  ],
} as const;

export const ZERO_EX_LIMIT_ORDER_ABI = [
  {
    type: 'function',
    name: 'fillLimitOrder',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'makerToken', type: 'address' },
          { name: 'takerToken', type: 'address' },
          { name: 'makerAmount', type: 'uint128' },
          { name: 'takerAmount', type: 'uint128' },
          { name: 'takerTokenFeeAmount', type: 'uint128' },
          { name: 'maker', type: 'address' },
          { name: 'taker', type: 'address' },
          { name: 'sender', type: 'address' },
          { name: 'feeRecipient', type: 'address' },
          { name: 'pool', type: 'bytes32' },
          { name: 'expiry', type: 'uint64' },
          { name: 'salt', type: 'uint256' },
        ],
      },
      {
        name: 'signature',
        type: 'tuple',
        components: [
          { name: 'signatureType', type: 'uint8' },
          { name: 'v', type: 'uint8' },
          { name: 'r', type: 'bytes32' },
          { name: 's', type: 'bytes32' },
        ],
      },
      { name: 'takerTokenFillAmount', type: 'uint128' },
    ],
    outputs: [
      { name: 'takerTokenFilledAmount', type: 'uint128' },
      { name: 'makerTokenFilledAmount', type: 'uint128' },
    ],
  },
  {
    type: 'function',
    name: 'cancelLimitOrder',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'makerToken', type: 'address' },
          { name: 'takerToken', type: 'address' },
          { name: 'makerAmount', type: 'uint128' },
          { name: 'takerAmount', type: 'uint128' },
          { name: 'takerTokenFeeAmount', type: 'uint128' },
          { name: 'maker', type: 'address' },
          { name: 'taker', type: 'address' },
          { name: 'sender', type: 'address' },
          { name: 'feeRecipient', type: 'address' },
          { name: 'pool', type: 'bytes32' },
          { name: 'expiry', type: 'uint64' },
          { name: 'salt', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getLimitOrderInfo',
    stateMutability: 'view',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'makerToken', type: 'address' },
          { name: 'takerToken', type: 'address' },
          { name: 'makerAmount', type: 'uint128' },
          { name: 'takerAmount', type: 'uint128' },
          { name: 'takerTokenFeeAmount', type: 'uint128' },
          { name: 'maker', type: 'address' },
          { name: 'taker', type: 'address' },
          { name: 'sender', type: 'address' },
          { name: 'feeRecipient', type: 'address' },
          { name: 'pool', type: 'bytes32' },
          { name: 'expiry', type: 'uint64' },
          { name: 'salt', type: 'uint256' },
        ],
      },
    ],
    outputs: [
      {
        name: 'orderInfo',
        type: 'tuple',
        components: [
          { name: 'orderHash', type: 'bytes32' },
          { name: 'status', type: 'uint8' },
          { name: 'takerTokenFilledAmount', type: 'uint128' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getLimitOrderHash',
    stateMutability: 'view',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        components: [
          { name: 'makerToken', type: 'address' },
          { name: 'takerToken', type: 'address' },
          { name: 'makerAmount', type: 'uint128' },
          { name: 'takerAmount', type: 'uint128' },
          { name: 'takerTokenFeeAmount', type: 'uint128' },
          { name: 'maker', type: 'address' },
          { name: 'taker', type: 'address' },
          { name: 'sender', type: 'address' },
          { name: 'feeRecipient', type: 'address' },
          { name: 'pool', type: 'bytes32' },
          { name: 'expiry', type: 'uint64' },
          { name: 'salt', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'orderHash', type: 'bytes32' }],
  },
  {
    type: 'event',
    name: 'LimitOrderFilled',
    inputs: [
      { indexed: false, name: 'orderHash', type: 'bytes32' },
      { indexed: false, name: 'maker', type: 'address' },
      { indexed: false, name: 'taker', type: 'address' },
      { indexed: false, name: 'feeRecipient', type: 'address' },
      { indexed: false, name: 'makerToken', type: 'address' },
      { indexed: false, name: 'takerToken', type: 'address' },
      { indexed: false, name: 'takerTokenFilledAmount', type: 'uint128' },
      { indexed: false, name: 'makerTokenFilledAmount', type: 'uint128' },
      { indexed: false, name: 'pool', type: 'bytes32' },
    ],
  },
  {
    type: 'event',
    name: 'OrderCancelled',
    inputs: [{ indexed: false, name: 'orderHash', type: 'bytes32' }],
  },
] as const;

export const limitOrderSchema = z.object({
  makerToken: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  takerToken: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  makerAmount: z.string().regex(/^\d+$/),
  takerAmount: z.string().regex(/^\d+$/),
  takerTokenFeeAmount: z.string().regex(/^\d+$/).default('0'),
  maker: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  taker: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default('0x0000000000000000000000000000000000000000'),
  sender: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default('0x0000000000000000000000000000000000000000'),
  feeRecipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default('0x0000000000000000000000000000000000000000'),
  pool: z.string().regex(/^0x[a-fA-F0-9]{64}$/).default('0x0000000000000000000000000000000000000000000000000000000000000000'),
  expiry: z.number().int().positive(),
  salt: z.string().regex(/^\d+$/),
});

export const signatureSchema = z.object({
  signatureType: z.number().int().min(0).max(6).default(2),
  v: z.number().int().min(27).max(28),
  r: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  s: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export const signedOrderSchema = z.object({
  order: limitOrderSchema,
  signature: signatureSchema,
  orderHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  createdAt: z.number().int().positive(),
});

export function buildFillLimitOrderTx(
  order: ZeroExLimitOrder,
  signature: ZeroExSignature,
  takerTokenFillAmount: bigint
) {
  return {
    to: ZERO_EX_EXCHANGE_PROXY_BASE,
    data: {
      abi: ZERO_EX_LIMIT_ORDER_ABI,
      functionName: 'fillLimitOrder',
      args: [order, signature, takerTokenFillAmount],
    },
  };
}

export function buildCancelLimitOrderTx(order: ZeroExLimitOrder) {
  return {
    to: ZERO_EX_EXCHANGE_PROXY_BASE,
    data: {
      abi: ZERO_EX_LIMIT_ORDER_ABI,
      functionName: 'cancelLimitOrder',
      args: [order],
    },
  };
}
