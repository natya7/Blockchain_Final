import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

describe("VickreyAuction", function () {
  const RESERVE = 100;
  const BIDDING_TIME = 3600;

  async function deployFixture() {
    const [seller, alice, bob] = await ethers.getSigners();

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

    return { token, tokenAddress, nft, auction, auctionAddress, seller, alice, bob };
  }

  async function startedFixture() {
    const ctx = await deployFixture();
    await (await ctx.nft.connect(ctx.seller).approve(ctx.auctionAddress, 0)).wait();
    await (await ctx.auction.connect(ctx.seller).start()).wait();
    return ctx;
  }

  async function fundAndApprove(ctx: Awaited<ReturnType<typeof deployFixture>>, account: HardhatEthersSigner) {
    await (await ctx.token.connect(account).mint()).wait();
    const until = (await time.latest()) + BIDDING_TIME + 3600;
    await (await ctx.token.connect(account).setOperator(ctx.auctionAddress, until)).wait();
  }

  async function placeBid(
    ctx: Awaited<ReturnType<typeof deployFixture>>,
    account: HardhatEthersSigner,
    amount: number,
  ) {
    const input = await fhevm.createEncryptedInput(ctx.auctionAddress, account.address).add64(amount).encrypt();
    return ctx.auction.connect(account).bid(input.handles[0], input.inputProof);
  }

  async function decryptEscrow(ctx: Awaited<ReturnType<typeof deployFixture>>, account: HardhatEthersSigner) {
    const handle = await ctx.auction.escrowOf(account.address);
    if (handle === ethers.ZeroHash) {
      return 0n;
    }
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, ctx.auctionAddress, account);
  }

  it("holds the nft and opens bidding on start", async function () {
    const ctx = await startedFixture();
    expect(await ctx.nft.ownerOf(0)).to.eq(ctx.auctionAddress);
    expect(await ctx.auction.phase()).to.eq(1n);
  });

  it("rejects start from non-sellers", async function () {
    const ctx = await deployFixture();
    await expect(ctx.auction.connect(ctx.alice).start()).to.be.revertedWith("only seller");
  });

  it("rejects bids before start", async function () {
    const ctx = await deployFixture();
    await fundAndApprove(ctx, ctx.alice);
    await expect(placeBid(ctx, ctx.alice, 300)).to.be.revertedWith("not open");
  });

  it("escrows the encrypted bid amount", async function () {
    const ctx = await startedFixture();
    await fundAndApprove(ctx, ctx.alice);
    await (await placeBid(ctx, ctx.alice, 300)).wait();

    expect(await ctx.auction.bidCount()).to.eq(1n);
    expect(await decryptEscrow(ctx, ctx.alice)).to.eq(300n);

    const balanceHandle = await ctx.token.confidentialBalanceOf(ctx.alice.address);
    const balance = await fhevm.userDecryptEuint(FhevmType.euint64, balanceHandle, ctx.tokenAddress, ctx.alice);
    expect(balance).to.eq(700n);
  });

  it("escrows zero for an underfunded bid", async function () {
    const ctx = await startedFixture();
    await fundAndApprove(ctx, ctx.bob);
    await (await placeBid(ctx, ctx.bob, 5000)).wait();

    expect(await decryptEscrow(ctx, ctx.bob)).to.eq(0n);

    const balanceHandle = await ctx.token.confidentialBalanceOf(ctx.bob.address);
    const balance = await fhevm.userDecryptEuint(FhevmType.euint64, balanceHandle, ctx.tokenAddress, ctx.bob);
    expect(balance).to.eq(1000n);
  });

  it("keeps bidder escrows independent", async function () {
    const ctx = await startedFixture();
    await fundAndApprove(ctx, ctx.alice);
    await fundAndApprove(ctx, ctx.bob);
    await (await placeBid(ctx, ctx.alice, 300)).wait();
    await (await placeBid(ctx, ctx.bob, 500)).wait();

    expect(await ctx.auction.bidCount()).to.eq(2n);
    expect(await decryptEscrow(ctx, ctx.alice)).to.eq(300n);
    expect(await decryptEscrow(ctx, ctx.bob)).to.eq(500n);
  });

  it("rejects a second bid from the same address", async function () {
    const ctx = await startedFixture();
    await fundAndApprove(ctx, ctx.alice);
    await (await placeBid(ctx, ctx.alice, 300)).wait();
    await expect(placeBid(ctx, ctx.alice, 400)).to.be.revertedWith("already bid");
  });

  it("rejects bids without operator approval", async function () {
    const ctx = await startedFixture();
    await (await ctx.token.connect(ctx.alice).mint()).wait();
    await expect(placeBid(ctx, ctx.alice, 300)).to.be.revertedWithCustomError(ctx.token, "ERC7984UnauthorizedSpender");
  });

  it("rejects bids after the deadline", async function () {
    const ctx = await startedFixture();
    await fundAndApprove(ctx, ctx.alice);
    await time.increase(BIDDING_TIME + 1);
    await expect(placeBid(ctx, ctx.alice, 300)).to.be.revertedWith("bidding ended");
  });
});
