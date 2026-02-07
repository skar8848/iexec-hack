#!/usr/bin/env node

/**
 * {HyperSecret} iExec iApp
 *
 * Runs inside an SGX/TDX enclave via iExec.
 * Full anonymous bridge: Arb Sepolia → Hyperliquid Testnet
 *
 * Inputs:
 *   - IEXEC_REQUESTER_SECRET_1: JSON { destination, amount, vaultAddress }
 *   - IEXEC_APP_DEVELOPER_SECRET: TEE wallet private key
 *
 * Output:
 *   - IEXEC_OUT/result.json: execution proof (tx hashes)
 *   - IEXEC_OUT/computed.json: iExec metadata
 */

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// --- Config ---
const ARB_SEPOLIA_RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const USDC2_ADDRESS = "0x1baAbB04529D43a73232B713C0FE471f7c7334d5";
const HL_BRIDGE_ADDRESS = "0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89";
const HL_TESTNET_API = "https://api.hyperliquid-testnet.xyz";

const VAULT_ABI = [
  "function redistribute(address[] recipients, uint256[] amounts) external",
];

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hlUsdSend(wallet, destination, amountUsd) {
  const timestamp = Date.now();

  const domain = {
    name: "HyperliquidSignTransaction",
    version: "1",
    chainId: 421614,
    verifyingContract: "0x0000000000000000000000000000000000000000",
  };

  const types = {
    "HyperliquidTransaction:UsdSend": [
      { name: "hyperliquidChain", type: "string" },
      { name: "destination", type: "string" },
      { name: "amount", type: "string" },
      { name: "time", type: "uint64" },
    ],
  };

  const message = {
    hyperliquidChain: "Testnet",
    destination: destination,
    amount: amountUsd.toString(),
    time: timestamp,
  };

  const signature = await wallet.signTypedData(domain, types, message);
  const { r, s, v } = ethers.Signature.from(signature);

  const payload = {
    action: {
      type: "usdSend",
      hyperliquidChain: "Testnet",
      signatureChainId: "0x66eee",
      destination: destination,
      amount: amountUsd.toString(),
      time: timestamp,
    },
    nonce: timestamp,
    signature: { r, s, v },
  };

  const response = await fetch(`${HL_TESTNET_API}/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return await response.json();
}

async function waitForHLCredit(address, expectedAmount, maxRetries = 30) {
  console.log(`  Waiting for HL credit of $${expectedAmount} to ${address}...`);

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${HL_TESTNET_API}/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "clearinghouseState",
          user: address,
        }),
      });

      const data = await response.json();
      const balance = parseFloat(data?.marginSummary?.accountValue || "0");

      if (balance >= expectedAmount) {
        console.log(`  HL credited! Balance: $${balance}`);
        return true;
      }

      console.log(`  Attempt ${i + 1}/${maxRetries}: balance=$${balance}, waiting...`);
    } catch (e) {
      console.log(`  Attempt ${i + 1}/${maxRetries}: error polling HL`);
    }

    await sleep(5000);
  }

  throw new Error("HL bridge credit timeout after " + maxRetries * 5 + "s");
}

async function main() {
  const iexecOut = process.env.IEXEC_OUT || "/tmp/iexec_out";
  fs.mkdirSync(iexecOut, { recursive: true });

  // Read secrets
  const requesterSecret = process.env.IEXEC_REQUESTER_SECRET_1;
  const teePrivateKey = process.env.IEXEC_APP_DEVELOPER_SECRET;

  if (!requesterSecret) throw new Error("No requester secret (IEXEC_REQUESTER_SECRET_1)");
  if (!teePrivateKey) throw new Error("No app developer secret (IEXEC_APP_DEVELOPER_SECRET)");

  const intent = JSON.parse(requesterSecret);
  const { destination, amount, vaultAddress } = intent;

  if (!destination || !amount || !vaultAddress) {
    throw new Error("Intent must contain destination, amount, vaultAddress");
  }

  const hlDestination = ethers.getAddress(destination);
  console.log(`\n=== {HyperSecret} TEE Execution ===`);
  console.log(`  HL Destination: ${hlDestination}`);
  console.log(`  Amount: ${amount} USDC`);

  const provider = new ethers.JsonRpcProvider(ARB_SEPOLIA_RPC);
  const teeWallet = new ethers.Wallet(teePrivateKey, provider);
  console.log(`  TEE Wallet: ${teeWallet.address}`);

  // Step 1: Generate fresh wallet
  const freshWallet = ethers.Wallet.createRandom().connect(provider);
  console.log(`\n[1/6] Fresh wallet generated: ${freshWallet.address}`);

  // Step 2: Redistribute USDC2 from vault to fresh wallet
  const vault = new ethers.Contract(vaultAddress, VAULT_ABI, teeWallet);
  const amountWei = ethers.parseUnits(amount.toString(), 6);

  console.log(`\n[2/6] Calling redistribute()...`);
  const tx1 = await vault.redistribute([freshWallet.address], [amountWei]);
  const receipt1 = await tx1.wait();
  console.log(`  Redistribute tx: ${tx1.hash} (block ${receipt1.blockNumber})`);

  // Step 3: Fund fresh wallet with ETH for gas
  console.log(`\n[3/6] Funding fresh wallet with ETH for gas...`);
  const tx2 = await teeWallet.sendTransaction({
    to: freshWallet.address,
    value: ethers.parseEther("0.001"),
  });
  await tx2.wait();
  console.log(`  ETH funding tx: ${tx2.hash}`);

  // Verify fresh wallet has USDC2
  const usdc2 = new ethers.Contract(USDC2_ADDRESS, ERC20_ABI, freshWallet);
  const freshBalance = await usdc2.balanceOf(freshWallet.address);
  console.log(`  Fresh wallet USDC2: ${ethers.formatUnits(freshBalance, 6)}`);

  // Step 4: Bridge USDC2 to Hyperliquid (transfer to HL bridge contract)
  console.log(`\n[4/6] Bridging USDC2 to Hyperliquid...`);
  const tx3 = await usdc2.transfer(HL_BRIDGE_ADDRESS, amountWei);
  const receipt3 = await tx3.wait();
  console.log(`  Bridge tx: ${tx3.hash} (block ${receipt3.blockNumber})`);

  // Step 5: Wait for HL to credit the fresh wallet
  console.log(`\n[5/6] Waiting for HL credit...`);
  await waitForHLCredit(freshWallet.address, amount);

  // Step 6: usdSend from fresh wallet to destination on HL
  console.log(`\n[6/6] Sending USDC to ${hlDestination} on Hyperliquid...`);
  const hlResult = await hlUsdSend(freshWallet, hlDestination, amount);
  console.log(`  HL usdSend result:`, JSON.stringify(hlResult));

  if (hlResult.status === "err") {
    throw new Error(`usdSend failed: ${hlResult.response || JSON.stringify(hlResult)}`);
  }

  // Write result
  const result = {
    success: true,
    freshWallet: freshWallet.address,
    redistributeTx: tx1.hash,
    ethFundingTx: tx2.hash,
    bridgeTx: tx3.hash,
    hlTransferResult: hlResult,
    destination: hlDestination,
    amount: amount,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(iexecOut, "result.json"),
    JSON.stringify(result, null, 2)
  );

  fs.writeFileSync(
    path.join(iexecOut, "computed.json"),
    JSON.stringify({
      "deterministic-output-path": path.join(iexecOut, "result.json"),
    })
  );

  console.log("\n=== Execution Complete ===");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("iApp error:", err);
  process.exit(1);
});
