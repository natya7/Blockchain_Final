import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

describe("VickreyAuction settlement", function () {
  const RESERVE = 100;
  const BIDDING_TIME = 3600;

  async function deployFixture() {
    const [seller, alice, bob, carol] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("AuctionToken");
    const token = await tokenFactory.deploy();
    const tokenAddress = await token.getAddress();

    const nftFactory = await ethers.getContractFactory("PrizeNFT");
    const nft = await nftFactory.connect(seller).deploy();
    await (await nft.connect(seller).mint()).wait();

    const auctionFactory = await ethers.getContractFactory("VickreyAuction");
    const auction = await auctionFactory
      .connect(seller)
      .deploy(tokenAddress, await nft.getAddress(), 0, RESERVE, BIDDING_TIME, seller.address);
    const auctionAddress = await auction.getAddress();

    await (await nft.connect(seller).approve(auctionAddress, 0)).wait();
    await (await auction.connect(seller).start()).wait();

    return { token, tokenAddress, nft, auction, auctionAddress, seller, alice, bob, carol };
  }

  type Ctx = Awaited<ReturnType<typeof deployFixture>>;

  async function fundAndBid(ctx: Ctx, account: HardhatEthersSigner, amount: number) {
    await (await ctx.token.connect(account).mint()).wait();
    const until = (await time.latest()) + BIDDING_TIME + 3600;
    await (await ctx.token.connect(account).setOperator(ctx.auctionAddress, until)).wait();
    const input = await fhevm.createEncryptedInput(ctx.auctionAddress, account.address).add64(amount).encrypt();
    await (await ctx.auction.connect(account).bid(input.handles[0], input.inputProof)).wait();
  }

  async function settle(ctx: Ctx, submitter?: HardhatEthersSigner) {
    await time.increase(BIDDING_TIME + 1);
    await (await ctx.auction.finalize()).wait();
    const winnerHandle = await ctx.auction.highestBidder();
    const priceHandle = await ctx.auction.secondHighestBid();
    const result = await fhevm.publicDecrypt([winnerHandle, priceHandle]);
    const signer = submitter ?? ctx.seller;
    await (await ctx.auction.connect(signer).settle(result.abiEncodedClearValues, result.decryptionProof)).wait();
  }

  async function tokenBalance(ctx: Ctx, account: HardhatEthersSigner) {
    const handle = await ctx.token.confidentialBalanceOf(account.address);
    if (handle === ethers.ZeroHash) {
      return 0n;
    }
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, ctx.tokenAddress, account);
  }

  it("settles to the highest bidder at the second-highest price", async function () {
    const ctx = await deployFixture();
    await fundAndBid(ctx, ctx.alice, 300);
    await fundAndBid(ctx, ctx.bob, 500);
    await fundAndBid(ctx, ctx.carol, 400);
    await settle(ctx);

    expect(await ctx.auction.winner()).to.eq(ctx.bob.address);
    expect(await ctx.auction.clearingPrice()).to.eq(400n);
  });

  it("settles the same regardless of bid order", async function () {
    const ctx = await deployFixture();
    await fundAndBid(ctx, ctx.carol, 400);
    await fundAndBid(ctx, ctx.bob, 500);
    await fundAndBid(ctx, ctx.alice, 300);
    await settle(ctx);

    expect(await ctx.auction.winner()).to.eq(ctx.bob.address);
    expect(await ctx.auction.clearingPrice()).to.eq(400n);
  });

  it("charges a single bidder the reserve price", async function () {
    const ctx = await deployFixture();
    await fundAndBid(ctx, ctx.alice, 500);
    await settle(ctx);

    expect(await ctx.auction.winner()).to.eq(ctx.alice.address);
    expect(await ctx.auction.clearingPrice()).to.eq(BigInt(RESERVE));
  });

  it("resolves ties to the earlier bidder at the tied price", async function () {
    const ctx = await deployFixture();
    await fundAndBid(ctx, ctx.alice, 500);
    await fundAndBid(ctx, ctx.bob, 500);
    await settle(ctx);

    expect(await ctx.auction.winner()).to.eq(ctx.alice.address);
    expect(await ctx.auction.clearingPrice()).to.eq(500n);
  });

  it("ends with no winner when nobody bids", async function () {
    const ctx = await deployFixture();
    await settle(ctx);

    expect(await ctx.auction.winner()).to.eq(ethers.ZeroAddress);
  });

  it("ignores underfunded bids", async function () {
    const ctx = await deployFixture();
    await fundAndBid(ctx, ctx.alice, 5000);
    await fundAndBid(ctx, ctx.bob, 300);
    await settle(ctx);

    expect(await ctx.auction.winner()).to.eq(ctx.bob.address);
    expect(await ctx.auction.clearingPrice()).to.eq(BigInt(RESERVE));
  });

  it("lets the winner claim the nft and pays the seller", async function () {
    const ctx = await deployFixture();
    await fundAndBid(ctx, ctx.alice, 300);
    await fundAndBid(ctx, ctx.bob, 500);
    await fundAndBid(ctx, ctx.carol, 400);
    await settle(ctx);

    await (await ctx.auction.connect(ctx.bob).claim()).wait();

    expect(await ctx.nft.ownerOf(0)).to.eq(ctx.bob.address);
    expect(await tokenBalance(ctx, ctx.bob)).to.eq(600n);
    expect(await tokenBalance(ctx, ctx.seller)).to.eq(400n);
  });

  it("refunds losers in full", async function () {
    const ctx = await deployFixture();
    await fundAndBid(ctx, ctx.alice, 300);
    await fundAndBid(ctx, ctx.bob, 500);
    await settle(ctx);

    await (await ctx.auction.connect(ctx.alice).withdraw()).wait();
    expect(await tokenBalance(ctx, ctx.alice)).to.eq(1000n);
  });

  it("returns the nft to the seller when unsold", async function () {
    const ctx = await deployFixture();
    await settle(ctx);

    await (await ctx.auction.connect(ctx.seller).reclaim()).wait();
    expect(await ctx.nft.ownerOf(0)).to.eq(ctx.seller.address);
  });

  it("rejects finalize before the deadline", async function () {
    const ctx = await deployFixture();
    await expect(ctx.auction.finalize()).to.be.revertedWith("bidding not over");
  });

  it("rejects double finalize", async function () {
    const ctx = await deployFixture();
    await time.increase(BIDDING_TIME + 1);
    await (await ctx.auction.finalize()).wait();
    await expect(ctx.auction.finalize()).to.be.revertedWith("not open");
  });

  it("rejects settle before finalize", async function () {
    const ctx = await deployFixture();
    await expect(ctx.auction.settle("0x", "0x")).to.be.revertedWith("not finalized");
  });

  it("rejects settle with tampered cleartexts", async function () {
    const ctx = await deployFixture();
    await fundAndBid(ctx, ctx.alice, 300);
    await fundAndBid(ctx, ctx.bob, 500);
    await time.increase(BIDDING_TIME + 1);
    await (await ctx.auction.finalize()).wait();

    const winnerHandle = await ctx.auction.highestBidder();
    const priceHandle = await ctx.auction.secondHighestBid();
    const result = await fhevm.publicDecrypt([winnerHandle, priceHandle]);

    const forged = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint64"], [ctx.carol.address, 1n]);
    await expect(ctx.auction.settle(forged, result.decryptionProof)).to.be.reverted;
  });

  it("rejects claims from non-winners and double claims", async function () {
    const ctx = await deployFixture();
    await fundAndBid(ctx, ctx.alice, 300);
    await fundAndBid(ctx, ctx.bob, 500);
    await settle(ctx);

    await expect(ctx.auction.connect(ctx.alice).claim()).to.be.revertedWith("not winner");
    await (await ctx.auction.connect(ctx.bob).claim()).wait();
    await expect(ctx.auction.connect(ctx.bob).claim()).to.be.revertedWith("already claimed");
  });

  it("blocks the winner from withdraw and losers from double withdraw", async function () {
    const ctx = await deployFixture();
    await fundAndBid(ctx, ctx.alice, 300);
    await fundAndBid(ctx, ctx.bob, 500);
    await settle(ctx);

    await expect(ctx.auction.connect(ctx.bob).withdraw()).to.be.revertedWith("winner must claim");
    await (await ctx.auction.connect(ctx.alice).withdraw()).wait();
    await expect(ctx.auction.connect(ctx.alice).withdraw()).to.be.revertedWith("nothing to withdraw");
  });

  it("rejects withdraw before settlement", async function () {
    const ctx = await deployFixture();
    await fundAndBid(ctx, ctx.alice, 300);
    await expect(ctx.auction.connect(ctx.alice).withdraw()).to.be.revertedWith("not settled");
  });

  it("lets a third party finalize and settle", async function () {
    const ctx = await deployFixture();
    await fundAndBid(ctx, ctx.alice, 300);
    await settle(ctx, ctx.carol);
    expect(await ctx.auction.winner()).to.eq(ctx.alice.address);
  });
});
