// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {UpsideSeries} from "../../src/upside/UpsideSeries.sol";
import {UpsideClaimToken} from "../../src/upside/UpsideClaimToken.sol";
import {IUpsideSeries} from "../../src/upside/interfaces/IUpsideSeries.sol";
import {IOthelioAssetRegistry} from "../../src/upside/interfaces/IOthelioAssetRegistry.sol";

contract MockFeeOnTransferToken is ERC20 {
    uint256 public feeBps = 100; // 1%

    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 fee = (amount * feeBps) / 10000;
        uint256 sendAmount = amount - fee;
        _burn(from, fee);
        return super.transferFrom(from, to, sendAmount);
    }
}

contract MockReentrantToken is ERC20 {
    address public targetSeries;
    bool public shouldReenter;
    enum Action { Mint, Combine, Redeem }
    Action public actionToAttempt;

    constructor() ERC20("Reentrant Token", "REENT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setReentrancy(address target, bool enable, Action action) external {
        targetSeries = target;
        shouldReenter = enable;
        actionToAttempt = action;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _reenter();
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        _reenter();
        return super.transferFrom(from, to, amount);
    }

    function _reenter() internal {
        if (shouldReenter && targetSeries != address(0)) {
            shouldReenter = false; // prevent infinite recursion
            if (actionToAttempt == Action.Mint) {
                UpsideSeries(targetSeries).mint(1 ether);
            } else if (actionToAttempt == Action.Combine) {
                UpsideSeries(targetSeries).combineAndWithdraw(1 ether);
            } else if (actionToAttempt == Action.Redeem) {
                UpsideSeries(targetSeries).redeemUpside(1 ether);
            }
        }
    }
}

contract MockRegistryForMalicious is IOthelioAssetRegistry {
    mapping(address => bool) public supportedTokens;

    function setSupported(address token, bool s) external {
        supportedTokens[token] = s;
    }

    function isSupported(uint256, address token) external view override returns (bool) {
        return supportedTokens[token];
    }

    function getAsset(uint256, address token) external view override returns (Asset memory) {
        return Asset({
            supported: supportedTokens[token],
            priceFeed: address(0xBB),
            tokenDecimals: 18,
            feedDecimals: 8,
            isCoinbaseB20: false
        });
    }

    function getSupportedTokens(uint256) external view override returns (address[] memory) {
        return new address[](0);
    }
}

contract UpsideMaliciousTokenTest is Test {
    MockRegistryForMalicious public registry;
    MockFeeOnTransferToken public feeToken;
    MockReentrantToken public reentrantToken;

    address public adapter = address(0xAA);
    address public feed = address(0xBB);
    address public alice = address(0x11);

    uint256 public constant K = 205e8;

    function setUp() public {
        registry = new MockRegistryForMalicious();
        feeToken = new MockFeeOnTransferToken();
        reentrantToken = new MockReentrantToken();

        registry.setSupported(address(feeToken), true);
        registry.setSupported(address(reentrantToken), true);
    }

    function _createSeries(address token) internal returns (UpsideSeries series) {
        series = new UpsideSeries(
            address(this),
            address(registry),
            token,
            adapter,
            K,
            block.timestamp + 7 days,
            feed,
            1,
            K,
            1
        );

        UpsideClaimToken up = new UpsideClaimToken("Upside", "UP", address(series), 18);
        UpsideClaimToken res = new UpsideClaimToken("Residual", "RES", address(series), 18);
        series.initializeTokens(address(up), address(res));
    }

    function test_Malicious_FeeOnTransferRejected() public {
        UpsideSeries series = _createSeries(address(feeToken));

        feeToken.mint(alice, 10 ether);

        vm.startPrank(alice);
        feeToken.approve(address(series), 10 ether);

        // When minting, transferFrom transfers 9.9 ether instead of 10 -> FeeOnTransferNotSupported
        vm.expectRevert(IUpsideSeries.FeeOnTransferNotSupported.selector);
        series.mint(10 ether);
        vm.stopPrank();
    }

    function test_Malicious_ReentrancyBlocked() public {
        UpsideSeries series = _createSeries(address(reentrantToken));

        reentrantToken.mint(alice, 100 ether);

        vm.startPrank(alice);
        reentrantToken.approve(address(series), 100 ether);

        // First deposit without reentrancy
        series.mint(10 ether);

        // Configure token to reenter mint during transferFrom
        reentrantToken.setReentrancy(address(series), true, MockReentrantToken.Action.Mint);

        vm.expectRevert(); // ReentrancyGuardReentrantCall
        series.mint(10 ether);
        vm.stopPrank();
    }
}
