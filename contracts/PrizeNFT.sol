// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract PrizeNFT is ERC721 {
    uint256 private nextId;

    constructor() ERC721("Prize NFT", "PRIZE") {}

    function mint() external returns (uint256) {
        uint256 id = nextId;
        nextId = id + 1;
        _safeMint(msg.sender, id);
        return id;
    }
}
