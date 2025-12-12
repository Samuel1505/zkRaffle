import { expect } from "chai";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import hre from "hardhat";
import { ethers } from "hardhat";
import { MerkleProofHelper } from "./helpers/MerkleProofHelper";

describe("Integration Tests", function () {
  async function deployFullSystemFixture() {
    const [owner, merchant, user1, user2, user3] = await hre.ethers.getSigners();

    // Deploy RaffleManager
    const RaffleManager = await hre.ethers.getContractFactory("RaffleManager");
    const raffleManager = await RaffleManager.deploy();

    // Deploy RaffleRegistry
    const RaffleRegistry = await hre.ethers.getContractFactory("RaffleRegistry");
    const raffleRegistry = await RaffleRegistry.deploy(await raffleManager.getAddress());

    // Deploy RaffleSettlement
    const RaffleSettlement = await hre.ethers.getContractFactory("RaffleSettlement");
    const raffleSettlement = await RaffleSettlement.deploy(
      await raffleManager.getAddress(),
      await raffleRegistry.getAddress()
    );

    // Grant roles
    const MERCHANT_ROLE = await raffleManager.MERCHANT_ROLE();
    await raffleManager.grantRole(MERCHANT_ROLE, merchant.address);

    const OPERATOR_ROLE = await raffleRegistry.OPERATOR_ROLE();
    await raffleRegistry.grantRole(OPERATOR_ROLE, await raffleSettlement.getAddress());

    return {
      raffleManager,
      raffleRegistry,
      raffleSettlement,
      owner,
      merchant,
      user1,
      user2,
      user3,
    };
  }

  it("Should complete full raffle lifecycle", async function () {
    const { raffleManager, raffleRegistry, raffleSettlement, merchant, user1, user2, user3 } =
      await loadFixture(deployFullSystemFixture);

    // Step 1: Merchant creates raffle
    const numProducts = 20;
    const numWinners = 5;
    const expiryTimestamp = (await time.latest()) + 86400; // 1 day

    // Generate leaves for Merkle tree
    const leaves: string[] = [];
    const products: Array<{
      sid: string;
      r: string;
      win: boolean;
      user: any;
      index: number;
    }> = [];

    for (let i = 0; i < numProducts; i++) {
      const sid = ethers.keccak256(ethers.toUtf8Bytes(`product-${i}`));
      const r = ethers.keccak256(ethers.toUtf8Bytes(`salt-${i}`));
      const win = i < numWinners;
      const users = [user1, user2, user3];
      const user = users[i % users.length];

      const leaf = ethers.solidityPackedKeccak256(["bytes32", "bytes32", "bool"], [sid, r, win]);
      leaves.push(leaf);

      products.push({ sid, r, win, user, index: i });
    }

    // Build Merkle tree
    const tree = new MerkleProofHelper(leaves);
    const merkleRoot = tree.root;

    // Create raffle
    const tx = await raffleManager
      .connect(merchant)
      .createRaffle(merkleRoot, ethers.ZeroAddress, numProducts, expiryTimestamp, "ipfs://test");

    const receipt = await tx.wait();
    const event = receipt?.logs.find((log: any) => {
      try {
        const parsed = raffleManager.interface.parseLog(log);
        return parsed?.name === "RaffleCreated";
      } catch {
        return false;
      }
    });

    const raffleId = event ? raffleManager.interface.parseLog(event).args[0] : 1n;

    // Step 2: Users claim participations
    for (const product of products) {
      const encryptedPayload = ethers.toUtf8Bytes(`encrypted-${product.sid}`);
      await raffleRegistry
        .connect(product.user)
        .claimParticipation(raffleId, product.sid, encryptedPayload);
    }

    // Verify claims
    for (const product of products) {
      const claim = await raffleRegistry.getClaim(raffleId, product.sid);
      expect(claim.claimer).to.equal(product.user.address);
      expect(await raffleRegistry.isSidClaimed(raffleId, product.sid)).to.be.true;
    }

    // Step 3: Wait for expiry
    await time.increaseTo(expiryTimestamp + 1);

    // Step 4: Reveal and settle all claims
    let winnersCount = 0;
    for (const product of products) {
      const proof = tree.getProof(product.index);

      if (product.win) {
        await expect(
          raffleSettlement.revealAndSettle(
            raffleId,
            product.sid,
            product.r,
            product.win,
            proof
          )
        )
          .to.emit(raffleSettlement, "WinnerSettled")
          .withArgs(raffleId, product.sid, product.user.address, ethers.ZeroAddress, 0, 0);

        winnersCount++;
      } else {
        await expect(
          raffleSettlement.revealAndSettle(
            raffleId,
            product.sid,
            product.r,
            product.win,
            proof
          )
        ).to.emit(raffleSettlement, "NonWinnerRevealed");
      }

      expect(await raffleSettlement.isSettled(raffleId, product.sid)).to.be.true;
    }

    // Verify total winners
    expect(await raffleSettlement.getTotalWinners(raffleId)).to.equal(BigInt(winnersCount));
    expect(winnersCount).to.equal(numWinners);
  });

  it("Should prevent duplicate claims", async function () {
    const { raffleManager, raffleRegistry, merchant, user1 } = await loadFixture(
      deployFullSystemFixture
    );

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
    const expiryTimestamp = (await time.latest()) + 86400;

    await raffleManager
      .connect(merchant)
      .createRaffle(merkleRoot, ethers.ZeroAddress, 10, expiryTimestamp, "ipfs://test");

    const raffleId = 1n;
    const sid = ethers.keccak256(ethers.toUtf8Bytes("product-1"));
    const encryptedPayload = ethers.toUtf8Bytes("encrypted-data");

    // First claim should succeed
    await raffleRegistry.connect(user1).claimParticipation(raffleId, sid, encryptedPayload);

    // Duplicate claim should fail
    await expect(
      raffleRegistry.connect(user1).claimParticipation(raffleId, sid, encryptedPayload)
    ).to.be.revertedWith("RaffleRegistry: sid already claimed");
  });

  it("Should handle batch operations", async function () {
    const { raffleManager, raffleRegistry, merchant, user1 } = await loadFixture(
      deployFullSystemFixture
    );

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
    const expiryTimestamp = (await time.latest()) + 86400;

    await raffleManager
      .connect(merchant)
      .createRaffle(merkleRoot, ethers.ZeroAddress, 10, expiryTimestamp, "ipfs://test");

    const raffleId = 1n;
    const sids = [
      ethers.keccak256(ethers.toUtf8Bytes("product-1")),
      ethers.keccak256(ethers.toUtf8Bytes("product-2")),
      ethers.keccak256(ethers.toUtf8Bytes("product-3")),
    ];
    const encryptedPayloads = [
      ethers.toUtf8Bytes("encrypted-1"),
      ethers.toUtf8Bytes("encrypted-2"),
      ethers.toUtf8Bytes("encrypted-3"),
    ];

    // Batch claim
    await raffleRegistry
      .connect(user1)
      .batchClaimParticipation(raffleId, sids, encryptedPayloads);

    // Verify all claims
    for (const sid of sids) {
      const claim = await raffleRegistry.getClaim(raffleId, sid);
      expect(claim.claimer).to.equal(user1.address);
    }

    const userClaims = await raffleRegistry.getUserClaims(raffleId, user1.address);
    expect(userClaims.length).to.equal(3);
  });
});

