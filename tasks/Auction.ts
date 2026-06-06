import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("token:mint", "Mints the faucet amount to the caller").setAction(async function (_args: TaskArguments, hre) {
  const { ethers, deployments } = hre;
  const deployment = await deployments.get("AuctionToken");
  const [signer] = await ethers.getSigners();
  const token = await ethers.getContractAt("AuctionToken", deployment.address);
  const tx = await token.connect(signer).mint();
  await tx.wait();
  console.log(`minted to ${signer.address}`);
});

task("token:balance", "Decrypts the caller's token balance").setAction(async function (_args: TaskArguments, hre) {
  const { ethers, deployments, fhevm } = hre;
  await fhevm.initializeCLIApi();
  const deployment = await deployments.get("AuctionToken");
  const [signer] = await ethers.getSigners();
  const token = await ethers.getContractAt("AuctionToken", deployment.address);
  const handle = await token.confidentialBalanceOf(signer.address);
  if (handle === ethers.ZeroHash) {
    console.log("balance: 0");
    return;
  }
  const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, deployment.address, signer);
  console.log(`balance: ${clear}`);
});

task("auction:status", "Prints auction state").setAction(async function (_args: TaskArguments, hre) {
  const { ethers, deployments } = hre;
  const deployment = await deployments.get("VickreyAuction");
  const auction = await ethers.getContractAt("VickreyAuction", deployment.address);
  const phase = await auction.phase();
  console.log(`auction: ${deployment.address}`);
  console.log(`phase: ${phase}`);
  console.log(`deadline: ${await auction.deadline()}`);
  console.log(`bids: ${await auction.bidCount()}`);
  if (phase === 3n) {
    console.log(`winner: ${await auction.winner()}`);
    console.log(`clearing price: ${await auction.clearingPrice()}`);
  }
});

task("auction:bid", "Places an encrypted bid")
  .addParam("value", "Bid amount")
  .setAction(async function (args: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;
    const value = parseInt(args.value);
    if (!Number.isInteger(value)) {
      throw new Error("--value is not an integer");
    }

    await fhevm.initializeCLIApi();
    const tokenDeployment = await deployments.get("AuctionToken");
    const auctionDeployment = await deployments.get("VickreyAuction");
    const [signer] = await ethers.getSigners();
    const token = await ethers.getContractAt("AuctionToken", tokenDeployment.address);
    const auction = await ethers.getContractAt("VickreyAuction", auctionDeployment.address);

    const deadline = await auction.deadline();
    const operatorTx = await token.connect(signer).setOperator(auctionDeployment.address, deadline + 3600n);
    await operatorTx.wait();

    const input = await fhevm
      .createEncryptedInput(auctionDeployment.address, signer.address)
      .add64(BigInt(value))
      .encrypt();
    const tx = await auction.connect(signer).bid(input.handles[0], input.inputProof);
    console.log(`tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`status: ${receipt?.status}`);
  });

task("auction:finalize", "Closes bidding and marks results decryptable").setAction(async function (
  _args: TaskArguments,
  hre,
) {
  const { ethers, deployments } = hre;
  const deployment = await deployments.get("VickreyAuction");
  const [signer] = await ethers.getSigners();
  const auction = await ethers.getContractAt("VickreyAuction", deployment.address);
  const tx = await auction.connect(signer).finalize();
  console.log(`tx: ${tx.hash}`);
  await tx.wait();
  console.log("finalized");
});

task("auction:settle", "Fetches public decryption and settles on-chain").setAction(async function (
  _args: TaskArguments,
  hre,
) {
  const { ethers, deployments, fhevm } = hre;
  await fhevm.initializeCLIApi();
  const deployment = await deployments.get("VickreyAuction");
  const [signer] = await ethers.getSigners();
  const auction = await ethers.getContractAt("VickreyAuction", deployment.address);
  const winnerHandle = await auction.highestBidder();
  const priceHandle = await auction.secondHighestBid();
  const result = await fhevm.publicDecrypt([winnerHandle, priceHandle]);
  const tx = await auction.connect(signer).settle(result.abiEncodedClearValues, result.decryptionProof);
  console.log(`tx: ${tx.hash}`);
  await tx.wait();
  console.log(`winner: ${await auction.winner()}`);
  console.log(`clearing price: ${await auction.clearingPrice()}`);
});

task("auction:claim", "Winner claims the nft and pays the clearing price").setAction(async function (
  _args: TaskArguments,
  hre,
) {
  const { ethers, deployments } = hre;
  const deployment = await deployments.get("VickreyAuction");
  const [signer] = await ethers.getSigners();
  const auction = await ethers.getContractAt("VickreyAuction", deployment.address);
  const tx = await auction.connect(signer).claim();
  console.log(`tx: ${tx.hash}`);
  await tx.wait();
  console.log("claimed");
});

task("auction:withdraw", "Loser withdraws escrowed tokens").setAction(async function (_args: TaskArguments, hre) {
  const { ethers, deployments } = hre;
  const deployment = await deployments.get("VickreyAuction");
  const [signer] = await ethers.getSigners();
  const auction = await ethers.getContractAt("VickreyAuction", deployment.address);
  const tx = await auction.connect(signer).withdraw();
  console.log(`tx: ${tx.hash}`);
  await tx.wait();
  console.log("withdrawn");
});

task("auction:myescrow", "Decrypts the caller's escrowed bid").setAction(async function (_args: TaskArguments, hre) {
  const { ethers, deployments, fhevm } = hre;
  await fhevm.initializeCLIApi();
  const deployment = await deployments.get("VickreyAuction");
  const [signer] = await ethers.getSigners();
  const auction = await ethers.getContractAt("VickreyAuction", deployment.address);
  const handle = await auction.escrowOf(signer.address);
  if (handle === ethers.ZeroHash) {
    console.log("no bid");
    return;
  }
  const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, deployment.address, signer);
  console.log(`escrow: ${clear}`);
});
