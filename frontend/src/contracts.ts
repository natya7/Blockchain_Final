export const DEFAULT_AUCTION = "0x2891868B312022716695C06EB8563326364dd976";

export const AUCTION_ABI = [
  "function phase() view returns (uint8)",
  "function deadline() view returns (uint256)",
  "function bidCount() view returns (uint256)",
  "function hasBid(address) view returns (bool)",
  "function seller() view returns (address)",
  "function reservePrice() view returns (uint64)",
  "function token() view returns (address)",
  "function nft() view returns (address)",
  "function tokenId() view returns (uint256)",
  "function winner() view returns (address)",
  "function clearingPrice() view returns (uint64)",
  "function claimed() view returns (bool)",
  "function highestBid() view returns (bytes32)",
  "function secondHighestBid() view returns (bytes32)",
  "function highestBidder() view returns (bytes32)",
  "function escrowOf(address) view returns (bytes32)",
  "function bid(bytes32 encryptedAmount, bytes inputProof)",
  "function finalize()",
  "function settle(bytes cleartexts, bytes decryptionProof)",
  "function claim()",
  "function withdraw()",
  "function reclaim()",
];

export const TOKEN_ABI = [
  "function mint()",
  "function confidentialBalanceOf(address) view returns (bytes32)",
  "function setOperator(address operator, uint48 until)",
  "function isOperator(address holder, address spender) view returns (bool)",
];

export const NFT_ABI = ["function ownerOf(uint256) view returns (address)"];
