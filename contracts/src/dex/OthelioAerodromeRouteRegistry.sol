// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IAerodromeSlipstreamFactory {
    function getPool(address tokenA, address tokenB, int24 tickSpacing) external view returns (address pool);
}

/// @notice On-chain registry of governance-approved Aerodrome Slipstream pools and factories.
contract OthelioAerodromeRouteRegistry is Ownable2Step {
    struct PoolApproval {
        bool enabled;
        address factory;
    }

    /// @notice The only factory the pinned Slipstream router is allowed to use.
    /// The router packed path does not encode a factory, so approving a second
    /// factory would not constrain where the router actually swaps.
    address public immutable canonicalFactory;

    // keccak256(abi.encode(chainId, tokenMin, tokenMax, tickSpacing)) => PoolApproval
    mapping(bytes32 => PoolApproval) public poolApprovals;

    event AerodromePoolApprovalUpdated(
        uint256 indexed chainId,
        address indexed tokenA,
        address indexed tokenB,
        int24 tickSpacing,
        address factory,
        bool enabled
    );

    constructor(address initialOwner, address canonicalFactory_) Ownable(initialOwner) {
        require(initialOwner != address(0) && canonicalFactory_ != address(0), "INVALID_OWNER");
        require(canonicalFactory_.code.length > 0, "INVALID_FACTORY");
        canonicalFactory = canonicalFactory_;
    }

    function deriveRouteKey(
        uint256 chainId,
        address tokenA,
        address tokenB,
        int24 tickSpacing
    ) public pure returns (bytes32) {
        require(tokenA != address(0) && tokenB != address(0), "ZERO_TOKEN");
        require(tokenA != tokenB, "SAME_TOKEN");
        require(tickSpacing != 0, "ZERO_TICK_SPACING");

        address minToken = tokenA < tokenB ? tokenA : tokenB;
        address maxToken = tokenA < tokenB ? tokenB : tokenA;
        return keccak256(abi.encode(chainId, minToken, maxToken, tickSpacing));
    }

    function setPoolApproval(
        uint256 chainId,
        address tokenA,
        address tokenB,
        int24 tickSpacing,
        address factory,
        bool enabled
    ) external onlyOwner {
        if (enabled) {
            require(factory == canonicalFactory && factory.code.length > 0, "INVALID_FACTORY");
        }
        bytes32 key = deriveRouteKey(chainId, tokenA, tokenB, tickSpacing);
        poolApprovals[key] = PoolApproval({enabled: enabled, factory: factory});
        emit AerodromePoolApprovalUpdated(chainId, tokenA, tokenB, tickSpacing, factory, enabled);
    }

    function requireApprovedPool(
        uint256 chainId,
        address tokenA,
        address tokenB,
        int24 tickSpacing
    ) external view returns (address factory, address pool) {
        bytes32 key = deriveRouteKey(chainId, tokenA, tokenB, tickSpacing);
        PoolApproval memory approval = poolApprovals[key];
        require(approval.enabled, "UNAPPROVED_AERODROME_POOL");
        require(approval.factory == canonicalFactory && approval.factory.code.length > 0, "INVALID_FACTORY");

        pool = IAerodromeSlipstreamFactory(approval.factory).getPool(tokenA, tokenB, tickSpacing);
        require(pool != address(0) && pool.code.length > 0, "POOL_NOT_FOUND");
        factory = approval.factory;
    }
}
