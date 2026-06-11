import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const RESERVE_PRICE = 100;
const BIDDING_TIME = parseInt(process.env.BIDDING_TIME ?? "") || 7 * 24 * 3600;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { ethers } = hre;
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, save, getOrNull } = hre.deployments;

  const token = await deploy("AuctionToken", { from: deployer, log: true });
  const nft = await deploy("PrizeNFT", { from: deployer, log: true });
  const factory = await deploy("AuctionFactory", {
    from: deployer,
    args: [token.address],
    log: true,
  });

  const existing = await getOrNull("VickreyAuction");
  if (!existing) {
    const signer = await ethers.getSigner(deployer);
    const nftContract = await ethers.getContractAt("PrizeNFT", nft.address, signer);
    const mintTx = await nftContract.mint();
    const mintReceipt = await mintTx.wait();
    const tokenId = mintReceipt!.logs.length;

    const factoryContract = await ethers.getContractAt("AuctionFactory", factory.address, signer);
    const createTx = await factoryContract.createAuction(nft.address, tokenId - 1, RESERVE_PRICE, BIDDING_TIME);
    const createReceipt = await createTx.wait();
    const log = createReceipt!.logs.find((l) => l.address === factory.address);
    const parsed = factoryContract.interface.parseLog(log!);
    const auctionAddress = parsed!.args.auction;

    const artifact = await hre.deployments.getArtifact("VickreyAuction");
    await save("VickreyAuction", { address: auctionAddress, abi: artifact.abi });

    await (await nftContract.approve(auctionAddress, tokenId - 1)).wait();
    const auctionContract = await ethers.getContractAt("VickreyAuction", auctionAddress, signer);
    await (await auctionContract.start()).wait();

    console.log(`VickreyAuction: ${auctionAddress}`);
  } else {
    console.log(`VickreyAuction: ${existing.address}`);
  }

  console.log(`AuctionToken: ${token.address}`);
  console.log(`PrizeNFT: ${nft.address}`);
  console.log(`AuctionFactory: ${factory.address}`);
};
export default func;
func.id = "deploy_auction_stack"; // id required to prevent reexecution
func.tags = ["VickreyAuction"];
