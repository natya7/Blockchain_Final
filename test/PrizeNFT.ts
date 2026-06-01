import { expect } from "chai";
import { ethers } from "hardhat";

describe("PrizeNFT", function () {
  async function deployFixture() {
    const [alice, bob] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("PrizeNFT");
    const nft = await factory.deploy();
    return { nft, alice, bob };
  }

  it("mints sequential ids to callers", async function () {
    const { nft, alice, bob } = await deployFixture();
    await (await nft.connect(alice).mint()).wait();
    await (await nft.connect(bob).mint()).wait();
    expect(await nft.ownerOf(0)).to.eq(alice.address);
    expect(await nft.ownerOf(1)).to.eq(bob.address);
  });

  it("transfers ownership", async function () {
    const { nft, alice, bob } = await deployFixture();
    await (await nft.connect(alice).mint()).wait();
    await (await nft.connect(alice).transferFrom(alice.address, bob.address, 0)).wait();
    expect(await nft.ownerOf(0)).to.eq(bob.address);
  });

  it("reverts transfers by non-owners", async function () {
    const { nft, alice, bob } = await deployFixture();
    await (await nft.connect(alice).mint()).wait();
    await expect(nft.connect(bob).transferFrom(alice.address, bob.address, 0)).to.be.revertedWithCustomError(
      nft,
      "ERC721InsufficientApproval",
    );
  });
});
