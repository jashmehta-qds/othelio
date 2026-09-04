import type { FastifyInstance } from "fastify";
import { addressSchema, basketAbi, chainIdSchema } from "@othelio/shared";
import { encodeFunctionData } from "viem";
import { z } from "zod";
const bodySchema=z.object({chainId:chainIdSchema,basket:addressSchema,account:addressSchema,recipient:addressSchema,shares:z.string().regex(/^\d+$/),deadline:z.string().datetime()});
export async function prepareRoutes(app:FastifyInstance){
  app.post("/v1/prepare/:operation",async(request,reply)=>{const operation=(request.params as {operation:string}).operation;if(operation!=="deposit"&&operation!=="redeem")return reply.code(404).send({error:"UNSUPPORTED_OPERATION"});const body=bodySchema.parse(request.body);if(new Date(body.deadline)<=new Date())return reply.code(400).send({error:"DEADLINE_EXPIRED"});const data=encodeFunctionData({abi:basketAbi,functionName:operation,args:[BigInt(body.shares),body.recipient as `0x${string}`]});return {data:{chainId:body.chainId,from:body.account,to:body.basket,value:"0",data,deadline:body.deadline,operation}};});
}
