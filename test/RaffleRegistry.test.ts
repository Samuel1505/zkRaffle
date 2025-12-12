import { expect } from "chai";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import hre from "hardhat";
import { ethers } from "hardhat";

describe("RaffleRegistry", function () {
  async function deployContractsFixture() {
    const [owner, merchant, user1, user2, operator] = await hre.ethers.getSigners();

    const RaffleManager = await hre.ethers.getContractFactory("RaffleManager");
    const raffleManager = await RaffleManager.deploy();

    const RaffleRegistry = await hre.ethers.getContractFactory("RaffleRegistry");
    const raffleRegistry = await RaffleRegistry.deploy(await raffleManager.getAddress());

    // Grant merchant role
    const MERCHANT_ROLE = await raffleManager.MERCHANT_ROLE();
    await raffleManager.grantRole(MERCHANT_ROLE, merchant.address);

    return { raffleManager, raffleRegistry, owner, merchant, user1, user2, operator };
  }

  async function createRaffle(raffleManager: any, merchant: any) {
    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
    const expiryTimestamp = (await time.latest()) + 86400; // 1 day

    const tx = await raffleManager
      .connect(merchant)
      .createRaffle(merkleRoot, ethers.ZeroAddress, 100, expiryTimestamp, "ipfs://test");

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
    return { raffleId, merkleRoot, expiryTimestamp };
  }

  describe("Deployment", function () {
    it("Should set the right manager address", async function () {
      const { raffleManager, raffleRegistry } = await loadFixture(deployContractsFixture);
      expect(await raffleRegistry.raffleManager()).to.equal(await raffleManager.getAddress());
    });
  });

  describe("claimParticipation", function () {
    it("Should allow user to claim participation", async function () {
      const { raffleManager, raffleRegistry, merchant, user1 } = await loadFixture(
        deployContractsFixture
      );

      const { raffleId } = await createRaffle(raffleManager, merchant);

      const sid = ethers.keccak256(ethers.toUtf8Bytes("product-123"));
      const encryptedPayload = ethers.toUtf8Bytes("encrypted-data");

      await expect(
        raffleRegistry.connect(user1).claimParticipation(raffleId, sid, encryptedPayload)
      )
        .to.emit(raffleRegistry, "ParticipationClaimed")
        .withArgs(raffleId, sid, user1.address, encryptedPayload);

      const claim = await raffleRegistry.getClaim(raffleId, sid);
      expect(claim.claimer).to.equal(user1.address);
      expect(claim.encryptedPayload).to.equal(ethers.hexlify(encryptedPayload));
      expect(claim.isRevealed).to.be.false;
    });

    it("Should prevent duplicate claims for same sid", async function () {
      const { raffleManager, raffleRegistry, merchant, user1 } = await loadFixture(
        deployContractsFixture
      );

      const { raffleId } = await createRaffle(raffleManager, merchant);

      const sid = ethers.keccak256(ethers.toUtf8Bytes("product-123"));
      const encryptedPayload = ethers.toUtf8Bytes("encrypted-data");

      await raffleRegistry.connect(user1).claimParticipation(raffleId, sid, encryptedPayload);

      await expect(
        raffleRegistry.connect(user1).claimParticipation(raffleId, sid, encryptedPayload)
      ).to.be.revertedWith("RaffleRegistry: sid already claimed");
    });

    it("Should revert if raffle doesn't exist", async function () {
      const { raffleRegistry, user1 } = await loadFixture(deployContractsFixture);

      const sid = ethers.keccak256(ethers.toUtf8Bytes("product-123"));
      const encryptedPayload = ethers.toUtf8Bytes("encrypted-data");

      await expect(
        raffleRegistry.connect(user1).claimParticipation(999, sid, encryptedPayload)
      ).to.be.revertedWith("RaffleRegistry: raffle does not exist");
    });

    it("Should revert if raffle is not active", async function () {
      const { raffleManager, raffleRegistry, merchant, user1 } = await loadFixture(
        deployContractsFixture
      );

      const { raffleId } = await createRaffle(raffleManager, merchant);

      // Deactivate raffle
      await raffleManager.connect(merchant).setRaffleStatus(raffleId, false);

      const sid = ethers.keccak256(ethers.toUtf8Bytes("product-123"));
      const encryptedPayload = ethers.toUtf8Bytes("encrypted-data");

      await expect(
        raffleRegistry.connect(user1).claimParticipation(raffleId, sid, encryptedPayload)
      ).to.be.revertedWith("RaffleRegistry: raffle is not active");
    });

    it("Should revert if claim period has expired", async function () {
      const { raffleManager, raffleRegistry, merchant, user1 } = await loadFixture(
        deployContractsFixture
      );

      const { raffleId, expiryTimestamp } = await createRaffle(raffleManager, merchant);

      // Move time past expiry
      await time.increaseTo(expiryTimestamp + 1);

      const sid = ethers.keccak256(ethers.toUtf8Bytes("product-123"));
      const encryptedPayload = ethers.toUtf8Bytes("encrypted-data");

      await expect(
        raffleRegistry.connect(user1).claimParticipation(raffleId, sid, encryptedPayload)
      ).to.be.revertedWith("RaffleRegistry: claim period has expired");
    });

    it("Should revert if encryptedPayload is empty", async function () {
      const { raffleManager, raffleRegistry, merchant, user1 } = await loadFixture(
        deployContractsFixture
      );

      const { raffleId } = await createRaffle(raffleManager, merchant);

      const sid = ethers.keccak256(ethers.toUtf8Bytes("product-123"));

      await expect(
        raffleRegistry.connect(user1).claimParticipation(raffleId, sid, "0x")
      ).to.be.revertedWith("RaffleRegistry: encryptedPayload cannot be empty");
    });

    it("Should track user claims", async function () {
      const { raffleManager, raffleRegistry, merchant, user1 } = await loadFixture(
        deployContractsFixture
      );

      const { raffleId } = await createRaffle(raffleManager, merchant);

      const sid1 = ethers.keccak256(ethers.toUtf8Bytes("product-1"));
      const sid2 = ethers.keccak256(ethers.toUtf8Bytes("product-2"));
      const encryptedPayload = ethers.toUtf8Bytes("encrypted-data");

      await raffleRegistry.connect(user1).claimParticipation(raffleId, sid1, encryptedPayload);
      await raffleRegistry.connect(user1).claimParticipation(raffleId, sid2, encryptedPayload);

      const userClaims = await raffleRegistry.getUserClaims(raffleId, user1.address);
      expect(userClaims.length).to.equal(2);
      expect(userClaims[0]).to.equal(sid1);
      expect(userClaims[1]).to.equal(sid2);
    });
  });

  describe("batchClaimParticipation", function () {
    it("Should allow batch claims", async function () {
      const { raffleManager, raffleRegistry, merchant, user1 } = await loadFixture(
        deployContractsFixture
      );

      const { raffleId } = await createRaffle(raffleManager, merchant);

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

      await raffleRegistry
        .connect(user1)
        .batchClaimParticipation(raffleId, sids, encryptedPayloads);

      for (let i = 0; i < sids.length; i++) {
        const claim = await raffleRegistry.getClaim(raffleId, sids[i]);
        expect(claim.claimer).to.equal(user1.address);
        expect(await raffleRegistry.isSidClaimed(raffleId, sids[i])).to.be.true;
      }
    });

    it("Should revert if arrays length mismatch", async function () {
      const { raffleManager, raffleRegistry, merchant, user1 } = await loadFixture(
        deployContractsFixture
      );

      const { raffleId } = await createRaffle(raffleManager, merchant);

      const sids = [ethers.keccak256(ethers.toUtf8Bytes("product-1"))];
      const encryptedPayloads = [
        ethers.toUtf8Bytes("encrypted-1"),
        ethers.toUtf8Bytes("encrypted-2"),
      ];

      await expect(
        raffleRegistry
          .connect(user1)
          .batchClaimParticipation(raffleId, sids, encryptedPayloads)
      ).to.be.revertedWith("RaffleRegistry: arrays length mismatch");
    });
  });

  describe("markClaimRevealed", function () {
    it("Should mark claim as revealed", async function () {
      const { raffleManager, raffleRegistry, merchant, user1, operator } = await loadFixture(
        deployContractsFixture
      );

      const { raffleId } = await createRaffle(raffleManager, merchant);

      const sid = ethers.keccak256(ethers.toUtf8Bytes("product-123"));
      const encryptedPayload = ethers.toUtf8Bytes("encrypted-data");

      await raffleRegistry.connect(user1).claimParticipation(raffleId, sid, encryptedPayload);

      const OPERATOR_ROLE = await raffleRegistry.OPERATOR_ROLE();
      await raffleRegistry.grantRole(OPERATOR_ROLE, operator.address);

      await expect(raffleRegistry.connect(operator).markClaimRevealed(raffleId, sid))
        .to.emit(raffleRegistry, "ClaimRevealed")
        .withArgs(raffleId, sid);

      const claim = await raffleRegistry.getClaim(raffleId, sid);
      expect(claim.isRevealed).to.be.true;
    });

    it("Should revert if caller doesn't have operator role", async function () {
      const { raffleManager, raffleRegistry, merchant, user1 } = await loadFixture(
        deployContractsFixture
      );

      const { raffleId } = await createRaffle(raffleManager, merchant);

      const sid = ethers.keccak256(ethers.toUtf8Bytes("product-123"));
      const encryptedPayload = ethers.toUtf8Bytes("encrypted-data");

      await raffleRegistry.connect(user1).claimParticipation(raffleId, sid, encryptedPayload);

      await expect(
        raffleRegistry.connect(user1).markClaimRevealed(raffleId, sid)
      ).to.be.revertedWithCustomError(raffleRegistry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Pausable", function () {
    it("Should revert claimParticipation when paused", async function () {
      const { raffleManager, raffleRegistry, merchant, user1, owner } = await loadFixture(
        deployContractsFixture
      );

      const { raffleId } = await createRaffle(raffleManager, merchant);

      await raffleRegistry.pause();

      const sid = ethers.keccak256(ethers.toUtf8Bytes("product-123"));
      const encryptedPayload = ethers.toUtf8Bytes("encrypted-data");

      await expect(
        raffleRegistry.connect(user1).claimParticipation(raffleId, sid, encryptedPayload)
      ).to.be.revertedWithCustomError(raffleRegistry, "EnforcedPause");
    });
  });
});

