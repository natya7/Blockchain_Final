// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

contract AuctionToken is ZamaEthereumConfig, ERC7984 {
    uint64 public constant FAUCET_AMOUNT = 1000;

    constructor() ERC7984("Auction Token", "AUCT", "") {}

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function mint() external {
        _mint(msg.sender, FHE.asEuint64(FAUCET_AMOUNT));
    }
}
