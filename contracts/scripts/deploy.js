const hre = require("hardhat");
require("dotenv").config();

async function main() {
  // USDC2 = HL bridge token on Arb Sepolia (Circle USDC on mainnet)
  const USDC_ARB_SEPOLIA = "0x1baAbB04529D43a73232B713C0FE471f7c7334d5";
  const TEE_REDISTRIBUTOR = process.env.TEE_WALLET_ADDRESS;

  if (!TEE_REDISTRIBUTOR) {
    throw new Error("TEE_WALLET_ADDRESS not set in .env");
  }

  console.log("Deploying PrivacyVault...");
  console.log("  USDC:", USDC_ARB_SEPOLIA);
  console.log("  TEE Redistributor:", TEE_REDISTRIBUTOR);

  const PrivacyVault = await hre.ethers.getContractFactory("PrivacyVault");
  const vault = await PrivacyVault.deploy(USDC_ARB_SEPOLIA, TEE_REDISTRIBUTOR);
  await vault.waitForDeployment();

  const address = await vault.getAddress();
  console.log("\nPrivacyVault deployed to:", address);
  console.log("\nUpdate CLAUDE.md and frontend config with this address!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
