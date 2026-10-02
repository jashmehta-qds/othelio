import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { addressSchema, basketAbi, chainIdSchema } from '@othelio/shared';
import { encodeFunctionData } from 'viem';
import { z } from 'zod';

const bodySchema = z.object({
  chainId: chainIdSchema.optional().default(31337),
  basket: addressSchema,
  account: addressSchema,
  amountUSDC: z.string().optional(),
  shares: z.string().optional(),
  recipient: addressSchema.optional(),
  deadline: z.string().optional(),
});

const ERC20_TRANSFER_ABI = [
  {
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

@Injectable()
export class PrepareService {
  async prepareOperation(operationInput: string, bodyInput: any) {
    const validOperations = ['deposit', 'mint', 'redeem', 'withdraw', 'rebalance'];
    const operation = operationInput;
    if (!validOperations.includes(operation)) {
      throw new NotFoundException({ error: 'UNSUPPORTED_OPERATION' });
    }

    const body = bodySchema.parse(bodyInput);

    if (body.deadline && new Date(body.deadline) <= new Date()) {
      throw new BadRequestException({ error: 'DEADLINE_EXPIRED' });
    }

    let calldata = '0x';
    if (operation === 'deposit' || operation === 'mint') {
      const amountStr = body.amountUSDC || '1000';
      const amountUnits = BigInt(Math.round(Number(amountStr) * 1e6)); // 6 decimals for USDC
      calldata = encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: 'transfer',
        args: [body.basket as `0x${string}`, amountUnits],
      });
    } else {
      const sharesCount = BigInt(body.shares || '1');
      calldata = encodeFunctionData({
        abi: basketAbi,
        functionName: operation === 'withdraw' ? 'redeem' : (operation as any),
        args: [sharesCount, (body.recipient || body.account) as `0x${string}`],
      });
    }

    return {
      data: {
        chainId: body.chainId,
        from: body.account,
        to: body.basket,
        value: '0',
        calldata,
        operation,
      },
    };
  }
}
