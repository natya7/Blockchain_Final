import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

describe("SecretNumber", function () {
  async function deployFixture() {
    const [alice] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("SecretNumber");
    const contract = await factory.deploy();
    const address = await contract.getAddress();
    return { contract, address, alice };
  }

  it("stores an encrypted number the sender can decrypt", async function () {
    const { contract, address, alice } = await deployFixture();

    const input = await fhevm.createEncryptedInput(address, alice.address).add64(42).encrypt();
    await (await contract.connect(alice).set(input.handles[0], input.inputProof)).wait();

    const handle = await contract.get();
    const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, address, alice);
    expect(clear).to.eq(42n);
  });

  it("adds to the stored number homomorphically", async function () {
    const { contract, address, alice } = await deployFixture();

    const first = await fhevm.createEncryptedInput(address, alice.address).add64(40).encrypt();
    await (await contract.connect(alice).set(first.handles[0], first.inputProof)).wait();

    const second = await fhevm.createEncryptedInput(address, alice.address).add64(2).encrypt();
    await (await contract.connect(alice).addTo(second.handles[0], second.inputProof)).wait();

    const handle = await contract.get();
    const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, address, alice);
    expect(clear).to.eq(42n);
  });
});
