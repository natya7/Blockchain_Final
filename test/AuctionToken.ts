import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import { AuctionToken } from "../types";

describe("AuctionToken", function () {
  async function deployFixture() {
    const [alice, bob] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("AuctionToken");
    const token = (await factory.deploy()) as unknown as AuctionToken;
    const address = await token.getAddress();
    return { token, address, alice, bob };
  }

  async function balanceOf(token: AuctionToken, address: string, account: HardhatEthersSigner) {
    const handle = await token.confidentialBalanceOf(account.address);
    if (handle === ethers.ZeroHash) {
      return 0n;
    }
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, address, account);
  }

  it("mints the faucet amount to the caller", async function () {
    const { token, address, alice } = await deployFixture();
    await (await token.connect(alice).mint()).wait();
    expect(await balanceOf(token, address, alice)).to.eq(1000n);
  });

  it("stacks repeated mints", async function () {
    const { token, address, alice } = await deployFixture();
    await (await token.connect(alice).mint()).wait();
    await (await token.connect(alice).mint()).wait();
    expect(await balanceOf(token, address, alice)).to.eq(2000n);
  });

  it("transfers encrypted amounts between accounts", async function () {
    const { token, address, alice, bob } = await deployFixture();
    await (await token.connect(alice).mint()).wait();

    const input = await fhevm.createEncryptedInput(address, alice.address).add64(300).encrypt();
    await (
      await token
        .connect(alice)
        ["confidentialTransfer(address,bytes32,bytes)"](bob.address, input.handles[0], input.inputProof)
    ).wait();

    expect(await balanceOf(token, address, alice)).to.eq(700n);
    expect(await balanceOf(token, address, bob)).to.eq(300n);
  });

  it("transfers nothing when amount exceeds balance", async function () {
    const { token, address, alice, bob } = await deployFixture();
    await (await token.connect(alice).mint()).wait();

    const input = await fhevm.createEncryptedInput(address, alice.address).add64(5000).encrypt();
    await (
      await token
        .connect(alice)
        ["confidentialTransfer(address,bytes32,bytes)"](bob.address, input.handles[0], input.inputProof)
    ).wait();

    expect(await balanceOf(token, address, alice)).to.eq(1000n);
    expect(await balanceOf(token, address, bob)).to.eq(0n);
  });

  it("lets an operator move tokens with confidentialTransferFrom", async function () {
    const { token, address, alice, bob } = await deployFixture();
    await (await token.connect(alice).mint()).wait();

    const block = await ethers.provider.getBlock("latest");
    await (await token.connect(alice).setOperator(bob.address, block!.timestamp + 3600)).wait();

    const input = await fhevm.createEncryptedInput(address, bob.address).add64(400).encrypt();
    await (
      await token
        .connect(bob)
        [
          "confidentialTransferFrom(address,address,bytes32,bytes)"
        ](alice.address, bob.address, input.handles[0], input.inputProof)
    ).wait();

    expect(await balanceOf(token, address, alice)).to.eq(600n);
    expect(await balanceOf(token, address, bob)).to.eq(400n);
  });

  it("reverts transferFrom for non-operators", async function () {
    const { token, address, alice, bob } = await deployFixture();
    await (await token.connect(alice).mint()).wait();

    const input = await fhevm.createEncryptedInput(address, bob.address).add64(400).encrypt();
    await expect(
      token
        .connect(bob)
        [
          "confidentialTransferFrom(address,address,bytes32,bytes)"
        ](alice.address, bob.address, input.handles[0], input.inputProof),
    ).to.be.revertedWithCustomError(token, "ERC7984UnauthorizedSpender");
  });
});
