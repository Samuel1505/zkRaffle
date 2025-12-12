import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Deploy RaffleManager
  console.log("\nDeploying RaffleManager...");
  const RaffleManager = await ethers.getContractFactory("RaffleManager");
  const raffleManager = await RaffleManager.deploy();
  await raffleManager.waitForDeployment();
  const raffleManagerAddress = await raffleManager.getAddress();
  console.log("RaffleManager deployed to:", raffleManagerAddress);

  // Deploy RaffleRegistry
  console.log("\nDeploying RaffleRegistry...");
  const RaffleRegistry = await ethers.getContractFactory("RaffleRegistry");
  const raffleRegistry = await RaffleRegistry.deploy(raffleManagerAddress);
  await raffleRegistry.waitForDeployment();
  const raffleRegistryAddress = await raffleRegistry.getAddress();
  console.log("RaffleRegistry deployed to:", raffleRegistryAddress);

  // Deploy RaffleSettlement
  console.log("\nDeploying RaffleSettlement...");
  const RaffleSettlement = await ethers.getContractFactory("RaffleSettlement");
  const raffleSettlement = await RaffleSettlement.deploy(raffleManagerAddress, raffleRegistryAddress);
  await raffleSettlement.waitForDeployment();
  const raffleSettlementAddress = await raffleSettlement.getAddress();
  console.log("RaffleSettlement deployed to:", raffleSettlementAddress);

  // Grant OPERATOR_ROLE to RaffleSettlement in RaffleRegistry
  console.log("\nGranting OPERATOR_ROLE to RaffleSettlement...");
  const OPERATOR_ROLE = await raffleRegistry.OPERATOR_ROLE();
  const grantTx = await raffleRegistry.grantRole(OPERATOR_ROLE, raffleSettlementAddress);
  await grantTx.wait();
  console.log("OPERATOR_ROLE granted to RaffleSettlement");

  console.log("\n=== Deployment Summary ===");
  console.log("RaffleManager:", raffleManagerAddress);
  console.log("RaffleRegistry:", raffleRegistryAddress);
  console.log("RaffleSettlement:", raffleSettlementAddress);
  console.log("\nDeployment completed successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

