import { z } from "zod";

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const chainIdSchema = z.coerce.number().int().positive();
export const basketFactoryAbi = [
  { type: "event", name: "BasketCreated", inputs: [
    { indexed: true, name: "basket", type: "address" },
    { indexed: true, name: "controller", type: "address" },
    { indexed: false, name: "name", type: "string" },
    { indexed: false, name: "symbol", type: "string" }
  ] }
] as const;
export const basketAbi = [
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{name:"shares",type:"uint256"},{name:"recipient",type:"address"}], outputs: [] },
  { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{name:"shares",type:"uint256"},{name:"recipient",type:"address"}], outputs: [] },
  { type: "event", name: "BasketFunded", inputs: [{indexed:true,name:"basket",type:"address"},{indexed:true,name:"funder",type:"address"},{indexed:false,name:"sharesMinted",type:"uint256"},{indexed:false,name:"assets",type:"address[]"},{indexed:false,name:"amounts",type:"uint256[]"}] },
  { type: "event", name: "BasketWithdrawn", inputs: [{indexed:true,name:"basket",type:"address"},{indexed:true,name:"holder",type:"address"},{indexed:true,name:"recipient",type:"address"},{indexed:false,name:"sharesBurned",type:"uint256"},{indexed:false,name:"assets",type:"address[]"},{indexed:false,name:"amounts",type:"uint256[]"}] },
  { type: "event", name: "TargetWeightsUpdated", inputs: [{indexed:true,name:"basket",type:"address"},{indexed:true,name:"controller",type:"address"},{indexed:false,name:"assets",type:"address[]"},{indexed:false,name:"weightsBps",type:"uint16[]"}] },
  { type: "event", name: "ControllerTransferred", inputs: [{indexed:true,name:"basket",type:"address"},{indexed:true,name:"previousController",type:"address"},{indexed:true,name:"newController",type:"address"}] }
] as const;

