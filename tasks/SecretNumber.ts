import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("secret:set", "Encrypts a value and stores it in SecretNumber")
  .addOptionalParam("address", "Optionally specify the SecretNumber contract address")
  .addParam("value", "The value to encrypt and store")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    const value = parseInt(taskArguments.value);
    if (!Number.isInteger(value)) {
      throw new Error("--value is not an integer");
    }

    await fhevm.initializeCLIApi();

    const deployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("SecretNumber");
    console.log(`SecretNumber: ${deployment.address}`);

    const [signer] = await ethers.getSigners();
    const secret = await ethers.getContractAt("SecretNumber", deployment.address);

    const input = await fhevm.createEncryptedInput(deployment.address, signer.address).add64(value).encrypt();

    const tx = await secret.connect(signer).set(input.handles[0], input.inputProof);
    console.log(`tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`status: ${receipt?.status}`);
  });

task("secret:decrypt", "Decrypts the stored value as the caller")
  .addOptionalParam("address", "Optionally specify the SecretNumber contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    await fhevm.initializeCLIApi();

    const deployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("SecretNumber");
    console.log(`SecretNumber: ${deployment.address}`);

    const [signer] = await ethers.getSigners();
    const secret = await ethers.getContractAt("SecretNumber", deployment.address);

    const handle = await secret.get();
    if (handle === ethers.ZeroHash) {
      console.log("stored value: not set yet");
      return;
    }

    const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, deployment.address, signer);
    console.log(`encrypted handle: ${handle}`);
    console.log(`stored value: ${clear}`);
  });
