// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, ebool, euint64, eaddress, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

contract VickreyAuction is ZamaEthereumConfig {
    enum Phase {
        Created,
        Open,
        DecryptionPending,
        Settled
    }

    IERC7984 public immutable token;
    IERC721 public immutable nft;
    uint256 public immutable tokenId;
    address public immutable seller;
    uint64 public immutable reservePrice;
    uint256 public immutable biddingTime;

    Phase public phase;
    uint256 public deadline;
    uint256 public bidCount;
    mapping(address bidder => bool placed) public hasBid;

    address public winner;
    uint64 public clearingPrice;
    bool public claimed;

    euint64 public highestBid;
    euint64 public secondHighestBid;
    eaddress public highestBidder;
    mapping(address bidder => euint64 amount) private escrows;

    event AuctionOpened(uint256 deadline);
    event BidPlaced(address indexed bidder);
    event AuctionSettled(address winner, uint64 clearingPrice);
    event PrizeClaimed(address winner);
    event Refunded(address bidder);

    constructor(address token_, address nft_, uint256 tokenId_, uint64 reservePrice_, uint256 biddingTime_) {
        token = IERC7984(token_);
        nft = IERC721(nft_);
        tokenId = tokenId_;
        seller = msg.sender;
        reservePrice = reservePrice_;
        biddingTime = biddingTime_;

        highestBid = FHE.asEuint64(reservePrice_);
        secondHighestBid = FHE.asEuint64(reservePrice_);
        highestBidder = FHE.asEaddress(address(0));
        FHE.allowThis(highestBid);
        FHE.allowThis(secondHighestBid);
        FHE.allowThis(highestBidder);
    }

    function start() external {
        require(msg.sender == seller, "only seller");
        require(phase == Phase.Created, "already started");
        nft.transferFrom(seller, address(this), tokenId);
        phase = Phase.Open;
        deadline = block.timestamp + biddingTime;
        emit AuctionOpened(deadline);
    }

    function bid(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        require(phase == Phase.Open, "not open");
        require(block.timestamp < deadline, "bidding ended");
        require(!hasBid[msg.sender], "already bid");
        hasBid[msg.sender] = true;
        ++bidCount;

        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(amount, address(token));
        euint64 transferred = token.confidentialTransferFrom(msg.sender, address(this), amount);

        escrows[msg.sender] = transferred;
        FHE.allowThis(transferred);
        FHE.allow(transferred, msg.sender);

        ebool isHigher = FHE.gt(transferred, highestBid);
        ebool beatsSecond = FHE.gt(transferred, secondHighestBid);
        secondHighestBid = FHE.select(isHigher, highestBid, FHE.select(beatsSecond, transferred, secondHighestBid));
        highestBid = FHE.select(isHigher, transferred, highestBid);
        highestBidder = FHE.select(isHigher, FHE.asEaddress(msg.sender), highestBidder);
        FHE.allowThis(secondHighestBid);
        FHE.allowThis(highestBid);
        FHE.allowThis(highestBidder);

        emit BidPlaced(msg.sender);
    }

    function finalize() external {
        require(phase == Phase.Open, "not open");
        require(block.timestamp >= deadline, "bidding not over");
        phase = Phase.DecryptionPending;
        FHE.makePubliclyDecryptable(highestBidder);
        FHE.makePubliclyDecryptable(secondHighestBid);
    }

    function settle(bytes calldata cleartexts, bytes calldata decryptionProof) external {
        require(phase == Phase.DecryptionPending, "not finalized");
        bytes32[] memory handles = new bytes32[](2);
        handles[0] = eaddress.unwrap(highestBidder);
        handles[1] = euint64.unwrap(secondHighestBid);
        FHE.checkSignatures(handles, cleartexts, decryptionProof);
        (address decryptedWinner, uint64 decryptedPrice) = abi.decode(cleartexts, (address, uint64));
        winner = decryptedWinner;
        clearingPrice = decryptedPrice;
        phase = Phase.Settled;
        emit AuctionSettled(decryptedWinner, decryptedPrice);
    }

    function claim() external {
        require(phase == Phase.Settled, "not settled");
        require(msg.sender == winner, "not winner");
        require(!claimed, "already claimed");
        claimed = true;

        euint64 price = FHE.asEuint64(clearingPrice);
        FHE.allowTransient(price, address(token));
        token.confidentialTransfer(seller, price);

        euint64 refund = FHE.sub(escrows[winner], price);
        FHE.allowTransient(refund, address(token));
        token.confidentialTransfer(winner, refund);
        escrows[winner] = euint64.wrap(0);

        nft.transferFrom(address(this), winner, tokenId);
        emit PrizeClaimed(winner);
    }

    function withdraw() external {
        require(phase == Phase.Settled, "not settled");
        require(msg.sender != winner, "winner must claim");
        euint64 amount = escrows[msg.sender];
        require(FHE.isInitialized(amount), "nothing to withdraw");
        escrows[msg.sender] = euint64.wrap(0);
        FHE.allowTransient(amount, address(token));
        token.confidentialTransfer(msg.sender, amount);
        emit Refunded(msg.sender);
    }

    function reclaim() external {
        require(phase == Phase.Settled, "not settled");
        require(winner == address(0), "sold");
        require(msg.sender == seller, "only seller");
        nft.transferFrom(address(this), seller, tokenId);
    }

    function escrowOf(address bidder) external view returns (euint64) {
        return escrows[bidder];
    }
}
