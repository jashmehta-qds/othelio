// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOthelioEvents} from "../interfaces/IOthelioEvents.sol";
import {OthelioBasketAccount} from "../safe/OthelioBasketAccount.sol";
import {OthelioBasketModule} from "../safe/OthelioBasketModule.sol";

contract OthelioSafeFactory is IOthelioEvents {
    address public immutable module;
    address public immutable registry;

    mapping(address => bool) public isOthelioBasket;
    mapping(address => address[]) private _userBaskets;
    mapping(address => mapping(bytes32 => bool)) public seedSaltUsed;

    struct CreateAndSeedParams {
        bytes32 clientSalt;
        OthelioBasketModule.MintParams mint;
    }

    constructor(address module_, address registry_) {
        require(module_ != address(0) && registry_ != address(0), "ZERO_ADDRESS");
        module = module_;
        registry = registry_;
    }

    function createBasket(string calldata name) external returns (address basket) {
        OthelioBasketAccount account = new OthelioBasketAccount(msg.sender, module, registry);
        basket = address(account);

        isOthelioBasket[basket] = true;
        _userBaskets[msg.sender].push(basket);

        emit BasketCreated(basket, msg.sender, name, block.timestamp);
    }

    function predictBasketAddress(address owner, bytes32 clientSalt) public view returns (address) {
        bytes32 salt = keccak256(abi.encode(owner, clientSalt));
        bytes32 initCodeHash = keccak256(abi.encodePacked(
            type(OthelioBasketAccount).creationCode, abi.encode(owner, module, registry)
        ));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }

    /// @notice Atomically deploys a deterministic basket and funds every quoted target.
    function createAndSeedBasket(string calldata name, CreateAndSeedParams calldata p)
        external
        returns (address basket, uint256[] memory boughtAmounts, uint256 totalNAV)
    {
        require(bytes(name).length > 0 && bytes(name).length <= 128, "INVALID_NAME");
        require(!seedSaltUsed[msg.sender][p.clientSalt], "SEED_SALT_USED");
        require(OthelioBasketModule(payable(module)).moduleVersion() == 3, "UNSUPPORTED_MODULE_VERSION");
        require(OthelioBasketModule(payable(module)).supportsBoundedExecution(), "UNBOUNDED_MODULE");
        require(OthelioBasketModule(payable(module)).factory() == address(this), "FACTORY_WIRING_MISMATCH");
        require(p.mint.inputAsset != address(0) && p.mint.inputAmount > 0, "INVALID_INPUT");
        uint256 totalInput;
        for (uint256 i = 0; i < p.mint.legs.length; i++) totalInput += p.mint.legs[i].inputAmount;
        require(p.mint.legs.length > 0 && totalInput == p.mint.inputAmount, "LEG_INPUT_TOTAL_MISMATCH");

        bytes32 salt = keccak256(abi.encode(msg.sender, p.clientSalt));
        OthelioBasketAccount account = new OthelioBasketAccount{salt: salt}(msg.sender, module, registry);
        basket = address(account);
        require(basket == predictBasketAddress(msg.sender, p.clientSalt), "PREDICTION_MISMATCH");
        seedSaltUsed[msg.sender][p.clientSalt] = true;

        isOthelioBasket[basket] = true;
        _userBaskets[msg.sender].push(basket);

        emit BasketCreated(basket, msg.sender, name, block.timestamp);

        OthelioBasketModule.MintParams memory seedParams = p.mint;
        seedParams.safe = basket;

        (boughtAmounts, totalNAV) =
            OthelioBasketModule(payable(module)).fundWithSwapsFromFactory(msg.sender, seedParams);
    }

    function registerBasket(address safe, address owner, string calldata name) external {
        require(!isOthelioBasket[safe], "ALREADY_REGISTERED");
        require(safe != address(0) && owner != address(0), "ZERO_ADDRESS");
        require(safe.code.length > 0, "SAFE_NOT_CONTRACT");
        require(msg.sender == owner, "OWNER_MUST_REGISTER");
        require(OthelioBasketAccount(payable(safe)).isOwner(owner), "OWNER_MISMATCH");
        require(OthelioBasketAccount(payable(safe)).module() == module, "MODULE_MISMATCH");
        require(OthelioBasketAccount(payable(safe)).registry() == registry, "REGISTRY_MISMATCH");

        isOthelioBasket[safe] = true;
        _userBaskets[owner].push(safe);

        emit BasketCreated(safe, owner, name, block.timestamp);
    }

    function basketsOf(address owner) external view returns (address[] memory) {
        return _userBaskets[owner];
    }
}
