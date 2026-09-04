import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { addressSchema, basketAbi, chainIdSchema } from '@othelio/shared';
import { encodeFunctionData } from 'viem';
import { z } from 'zod';

const bodySchema = z.object({
  chainId: chainIdSchema,
  basket: addressSchema,
  account: addressSchema,
  recipient: addressSchema,
  shares: z.string().regex(/^\d+$/),
  deadline: z.string().datetime(),
});

@Injectable()
export class PrepareService {
  async prepareOperation(operation: string, bodyInput: any) {
    if (operation !== 'deposit' && operation !== 'redeem') {
      throw new NotFoundException({ error: 'UNSUPPORTED_OPERATION' });
    }

    const body = bodySchema.parse(bodyInput);

    if (new Date(body.deadline) <= new Date()) {
      throw new BadRequestException({ error: 'DEADLINE_EXPIRED' });
    }

    const data = encodeFunctionData({
      abi: basketAbi,
      functionName: operation,
      args: [BigInt(body.shares), body.recipient as `0x${string}`],
    });

    return {
      data: {
        chainId: body.chainId,
        from: body.account,
        to: body.basket,
        value: '0',
        data,
        deadline: body.deadline,
        operation,
      },
    };
  }
}
