import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const RESERVE_PRICE = 100;
const BIDDING_TIME = parseInt(process.env.BIDDING_TIME ?? "") || 7 * 24 * 3600;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, execute } = hre.deployments;

  const token = await deploy("AuctionToken", { from: deployer, log: true });
  const nft = await deploy("PrizeNFT", { from: deployer, log: true });
  const auction = await deploy("VickreyAuction", {
    from: deployer,
    args: [token.address, nft.address, 0, RESERVE_PRICE, BIDDING_TIME],
    log: true,
  });

  const phase = await hre.deployments.read("VickreyAuction", "phase");
  if (Number(phase) === 0) {
    await execute("PrizeNFT", { from: deployer, log: true }, "mint");
    await execute("PrizeNFT", { from: deployer, log: true }, "approve", auction.address, 0);
    await execute("VickreyAuction", { from: deployer, log: true }, "start");
  }

  console.log(`AuctionToken: ${token.address}`);
  console.log(`PrizeNFT: ${nft.address}`);
  console.log(`VickreyAuction: ${auction.address}`);
};
export default func;
func.id = "deploy_auction_stack"; // id required to prevent reexecution
func.tags = ["VickreyAuction"];
