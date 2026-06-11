// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VickreyAuction} from "./VickreyAuction.sol";

contract AuctionFactory {
    address public immutable token;
    address[] private auctions;

    event AuctionCreated(address auction, address seller, address nft, uint256 tokenId);

    constructor(address token_) {
        token = token_;
    }

    function createAuction(
        address nft,
        uint256 tokenId,
        uint64 reservePrice,
        uint256 biddingTime
    ) external returns (address) {
        VickreyAuction auction = new VickreyAuction(token, nft, tokenId, reservePrice, biddingTime, msg.sender);
        auctions.push(address(auction));
        emit AuctionCreated(address(auction), msg.sender, nft, tokenId);
        return address(auction);
    }

    function all() external view returns (address[] memory) {
        return auctions;
    }
}
