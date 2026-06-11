# Sealed-Bid Vickrey Auction on Zama fhEVM

A second-price (Vickrey) sealed-bid auction for an NFT where bids are encrypted end to end with fully homomorphic
encryption. Bids are placed, escrowed and compared as ciphertexts — the contract itself never sees a bid value. At
settlement exactly two facts become public: the winner and the clearing price (the second-highest bid). Every losing
bid, and even the winning bid amount, stays encrypted forever.

Course project for Blockchain Technologies (privacy track).

## How it works

Three contracts on Sepolia, built on the Zama fhEVM coprocessor:

- **AuctionToken** — confidential ERC-7984 fungible token (encrypted balances and transfer amounts) with an open faucet
  mint. Bids are paid in this token, so even the escrow transfer leaks nothing.
- **PrizeNFT** — minimal ERC-721, the auctioned item. The auction holds it from `start()` until claim.
- **VickreyAuction** — accepts encrypted bids via `confidentialTransferFrom` (the transferred ciphertext doubles as the
  escrow and the effective bid), maintains a running encrypted highest bid, second-highest bid and leading bidder using
  homomorphic compare-and-select, O(1) per bid.

Settlement: after the deadline anyone calls `finalize()`, which marks exactly two handles publicly decryptable. The
KMS-signed cleartexts are fetched off-chain and submitted to `settle()`, which verifies the threshold signatures
on-chain (`FHE.checkSignatures`) before publishing the result — forged cleartexts are rejected. The winner claims the
NFT and pays the clearing price to the seller; the difference between their bid and the price, and all losing escrows,
return as confidential transfers.

A Vickrey auction needs bid secrecy _during_ bidding to be incentive-compatible; FHE additionally removes the reveal
phase that makes commit-reveal designs griefable (losers refusing to reveal), and keeps losing bids secret _after_ the
auction too.

What stays hidden: all bid values (forever), escrow and refund amounts. What is public: who bid and when, bid count,
reserve price, and after settlement the winner and clearing price. Trusted: Zama's threshold KMS committee and FHE
coprocessor, plus relayer liveness for settlement.

## Repository layout

- `contracts/` — the three Solidity contracts
- `test/` — 35 Hardhat tests on the fhEVM mock: unit, Vickrey correctness (order permutations, ties, reserve), and
  adversarial (late bids, double claims, forged settlement data, ...)
- `deploy/`, `tasks/` — hardhat-deploy script and CLI tasks for the full lifecycle
- `frontend/` — Vite + React dapp: place encrypted bids from the browser, decrypt your own balance/escrow, observer mode
  showing what outsiders see, settlement buttons

## Quickstart

Requires Node 20+.

```bash
npm install
npm run compile
npx hardhat test        # 35 tests on the local fhEVM mock
```

Local end-to-end:

```bash
npm run chain                                  # terminal 1
npx hardhat deploy --network localhost         # terminal 2
npx hardhat token:mint --network localhost
npx hardhat auction:bid --network localhost --value 250
npx hardhat auction:myescrow --network localhost
```

## Sepolia

Set secrets once (`npx hardhat vars set MNEMONIC` and `INFURA_API_KEY`), fund the first account with faucet ETH, then:

```bash
npx hardhat deploy --network sepolia
```

Environment overrides: `BIDDING_TIME` (seconds, default 7 days) and `SEPOLIA_RPC_URL` (alternative RPC endpoint).

CLI lifecycle: `token:mint`, `token:balance`, `auction:bid --value N`, `auction:myescrow`, `auction:status`,
`auction:finalize`, `auction:settle`, `auction:claim`, `auction:withdraw`.

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Connect MetaMask on Sepolia. The default auction address is set in `frontend/src/contracts.ts`; any deployed auction
address can be pasted into the UI.

## Example deployment (Sepolia)

A completed auction with public results, for inspection:

- VickreyAuction `0x7d40b7086660a1aAFDCD15061DE703D5335F754d` (settled: winner public, clearing price 100, bid values
  still encrypted on-chain)
- AuctionToken `0xEe2dc6c04523A34B6B687Da989cbcAb9edd825d7`
- PrizeNFT `0x92e3d074A70CaFe79880FE632aDfC2DEa20943cC`

## Versions

Solidity 0.8.27, `@fhevm/solidity` 0.11.1, `@fhevm/hardhat-plugin` 0.4.2, `@zama-fhe/relayer-sdk` 0.4.1,
`@openzeppelin/confidential-contracts` 0.4.1, Hardhat 2.28.
