import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

describe("AuctionFactory", function () {
  async function deployFixture() {
    const [deployer, carol, alice] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("AuctionToken");
    const token = await tokenFactory.deploy();
    const tokenAddress = await token.getAddress();

    const nftFactory = await ethers.getContractFactory("PrizeNFT");
    const nft = await nftFactory.deploy();
    const nftAddress = await nft.getAddress();

    const factoryFactory = await ethers.getContractFactory("AuctionFactory");
    const factory = await factoryFactory.connect(deployer).deploy(tokenAddress);

    return { token, tokenAddress, nft, nftAddress, factory, deployer, carol, alice };
  }

  async function createAuction(ctx: Awaited<ReturnType<typeof deployFixture>>, seller: typeof ctx.carol) {
    await (await ctx.nft.connect(seller).mint()).wait();
    const tx = await ctx.factory.connect(seller).createAuction(ctx.nftAddress, 0, 100, 3600);
    const receipt = await tx.wait();
    const log = receipt!.logs.find((l) => l.address === ctx.factory.target);
    const parsed = ctx.factory.interface.parseLog(log!);
    return ethers.getContractAt("VickreyAuction", parsed!.args.auction);
  }

  it("creates auctions with the caller as seller", async function () {
    const ctx = await deployFixture();
    const auction = await createAuction(ctx, ctx.carol);

    expect(await auction.seller()).to.eq(ctx.carol.address);
    expect(await ctx.factory.all()).to.have.lengthOf(1);
  });

  it("rejects start from anyone but the creator", async function () {
    const ctx = await deployFixture();
    const auction = await createAuction(ctx, ctx.carol);
    await (await ctx.nft.connect(ctx.carol).approve(auction.target, 0)).wait();

    await expect(auction.connect(ctx.alice).start()).to.be.revertedWith("only seller");
    await (await auction.connect(ctx.carol).start()).wait();
    expect(await auction.phase()).to.eq(1n);
  });

  it("runs the bid flow on a factory-created auction", async function () {
    const ctx = await deployFixture();
    const auction = await createAuction(ctx, ctx.carol);
    const auctionAddress = await auction.getAddress();
    await (await ctx.nft.connect(ctx.carol).approve(auctionAddress, 0)).wait();
    await (await auction.connect(ctx.carol).start()).wait();

    await (await ctx.token.connect(ctx.alice).mint()).wait();
    const until = (await time.latest()) + 7200;
    await (await ctx.token.connect(ctx.alice).setOperator(auctionAddress, until)).wait();
    const input = await fhevm.createEncryptedInput(auctionAddress, ctx.alice.address).add64(300).encrypt();
    await (await auction.connect(ctx.alice).bid(input.handles[0], input.inputProof)).wait();

    const handle = await auction.escrowOf(ctx.alice.address);
    const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, auctionAddress, ctx.alice);
    expect(clear).to.eq(300n);
  });

  it("tracks multiple auctions", async function () {
    const ctx = await deployFixture();
    await (await ctx.nft.connect(ctx.carol).mint()).wait();
    await (await ctx.nft.connect(ctx.alice).mint()).wait();
    await (await ctx.factory.connect(ctx.carol).createAuction(ctx.nftAddress, 0, 100, 3600)).wait();
    await (await ctx.factory.connect(ctx.alice).createAuction(ctx.nftAddress, 1, 50, 600)).wait();

    const auctions = await ctx.factory.all();
    expect(auctions).to.have.lengthOf(2);
    expect(auctions[0]).to.not.eq(auctions[1]);
  });
});
