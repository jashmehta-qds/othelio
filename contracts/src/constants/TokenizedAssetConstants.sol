// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Tokenized Asset & Price Feed Constants for Base Mainnet
library TokenizedAssetConstants {
    // Coinbase Onchain Registry Address on Base Mainnet
    address public constant COINBASE_ONCHAIN_REGISTRY = 0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD;

    // Coinbase B20 Token Contracts (Base Mainnet)
    address public constant AAPLc  = 0xb200000000000000000000C2e324d24d7eEcd1fb;
    address public constant AMZNc  = 0xb200000000000000000000d9192b6B456483C2E8;
    address public constant COINc  = 0xb200000000000000000000c85a31389D71F3ecfb;
    address public constant CRCLc  = 0xB20000000000000000000019f6E7C675b73C2e4D;
    address public constant GOOGLc = 0xb2000000000000000000002D0BA3164cc74f58B7;
    address public constant INTCc  = 0xB2000000000000000000004AFF16039bA04bdFBc;
    address public constant METAc  = 0xb2000000000000000000008bC8786B856E61707C;
    address public constant MSFTc  = 0xB200000000000000000000Ab99cFa739E253872B;
    address public constant MSTRc  = 0xb2000000000000000000004884b426556b92883d;
    address public constant NVDAc  = 0xb20000000000000000000078ee7ce2fE4908108C;
    address public constant SNDKc  = 0xb200000000000000000000397293Cb8cda9a10c5;
    address public constant SPCXc  = 0xb2000000000000000000007b9fcbd005511aCBd5;
    address public constant TSLAc  = 0xb2000000000000000000001e800a7f5189430cD0;

    // Chainlink Price Feed Contracts (Base Mainnet)
    address public constant FEED_AAPL  = 0x787f13dEa48Db0897CbCDD985de77809D837F988;
    address public constant FEED_AMZN  = 0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295;
    address public constant FEED_COIN  = 0x408e44f504A7371a345F03a73dDC96A4b48e8aa7;
    address public constant FEED_CRCL  = 0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33;
    address public constant FEED_GOOGL = 0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2;
    address public constant FEED_INTC  = 0xAB657C39bac0D5886250D70849e2E3E008F2EECB;
    address public constant FEED_META  = 0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D;
    address public constant FEED_MSFT  = 0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c;
    address public constant FEED_MSTR  = 0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a;
    address public constant FEED_NVDA  = 0x04689a41629776563E6822F76f2e57D148d28513;
    address public constant FEED_SNDK  = 0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA;
    address public constant FEED_SPCX  = 0x6A634B235903C4ad6376892180d6fF8612e3Fa68;
    address public constant FEED_TSLA  = 0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4;
}
