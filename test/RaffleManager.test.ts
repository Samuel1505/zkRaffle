import { expect } from "chai";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import hre from "hardhat";
import { ethers } from "hardhat";

describe("RaffleManager", function () {
  async function deployRaffleManagerFixture() {
    const [owner, merchant, otherAccount] = await hre.ethers.getSigners();

    const RaffleManager = await hre.ethers.getContractFactory("RaffleManager");
    const raffleManager = await RaffleManager.deploy();

    return { raffleManager, owner, merchant, otherAccount };
  }

  describe("Deployment", function () {
    it("Should set the right roles", async function () {
      const { raffleManager, owner } = await loadFixture(deployRaffleManagerFixture);

      const DEFAULT_ADMIN_ROLE = await raffleManager.DEFAULT_ADMIN_ROLE();
      const OPERATOR_ROLE = await raffleManager.OPERATOR_ROLE();

      expect(await raffleManager.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
      expect(await raffleManager.hasRole(OPERATOR_ROLE, owner.address)).to.be.true;
    });

    it("Should start unpaused", async function () {
      const { raffleManager } = await loadFixture(deployRaffleManagerFixture);
      expect(await raffleManager.paused()).to.be.false;
    });
  });

  describe("createRaffle", function () {
    it("Should create a raffle with valid parameters", async function () {
      const { raffleManager, merchant } = await loadFixture(deployRaffleManagerFixture);

      // Grant merchant role
      const MERCHANT_ROLE = await raffleManager.MERCHANT_ROLE();
      await raffleManager.grantRole(MERCHANT_ROLE, merchant.address);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
      const rewardToken = ethers.ZeroAddress;
      const totalLeaves = 100;
      const expiryTimestamp = (await time.latest()) + 86400; // 1 day
      const metadataURI = "ipfs://QmTest123";

      await expect(
        raffleManager
          .connect(merchant)
          .createRaffle(
            merkleRoot,
            rewardToken,
            totalLeaves,
            expiryTimestamp,
            metadataURI
          )
      )
        .to.emit(raffleManager, "RaffleCreated")
        .withArgs(1, merkleRoot, merchant.address, rewardToken, totalLeaves, expiryTimestamp, metadataURI);

      const raffle = await raffleManager.getRaffle(1);
      expect(raffle.merchant).to.equal(merchant.address);
      expect(raffle.merkleRoot).to.equal(merkleRoot);
      expect(raffle.rewardToken).to.equal(rewardToken);
      expect(raffle.totalLeaves).to.equal(totalLeaves);
      expect(raffle.expiryTimestamp).to.equal(expiryTimestamp);
      expect(raffle.metadataURI).to.equal(metadataURI);
      expect(raffle.isActive).to.be.true;
    });

    it("Should revert if caller doesn't have merchant role", async function () {
      const { raffleManager, otherAccount } = await loadFixture(deployRaffleManagerFixture);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
      const expiryTimestamp = (await time.latest()) + 86400;

      await expect(
        raffleManager
          .connect(otherAccount)
          .createRaffle(merkleRoot, ethers.ZeroAddress, 100, expiryTimestamp, "ipfs://test")
      ).to.be.revertedWith("RaffleManager: must have merchant or admin role");
    });

    it("Should revert if merkleRoot is zero", async function () {
      const { raffleManager, merchant } = await loadFixture(deployRaffleManagerFixture);

      const MERCHANT_ROLE = await raffleManager.MERCHANT_ROLE();
      await raffleManager.grantRole(MERCHANT_ROLE, merchant.address);

      const expiryTimestamp = (await time.latest()) + 86400;

      await expect(
        raffleManager
          .connect(merchant)
          .createRaffle(ethers.ZeroHash, ethers.ZeroAddress, 100, expiryTimestamp, "ipfs://test")
      ).to.be.revertedWith("RaffleManager: merkleRoot cannot be zero");
    });

    it("Should revert if totalLeaves is zero", async function () {
      const { raffleManager, merchant } = await loadFixture(deployRaffleManagerFixture);

      const MERCHANT_ROLE = await raffleManager.MERCHANT_ROLE();
      await raffleManager.grantRole(MERCHANT_ROLE, merchant.address);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
      const expiryTimestamp = (await time.latest()) + 86400;

      await expect(
        raffleManager
          .connect(merchant)
          .createRaffle(merkleRoot, ethers.ZeroAddress, 0, expiryTimestamp, "ipfs://test")
      ).to.be.revertedWith("RaffleManager: totalLeaves must be > 0");
    });

    it("Should revert if expiryTimestamp is in the past", async function () {
      const { raffleManager, merchant } = await loadFixture(deployRaffleManagerFixture);

      const MERCHANT_ROLE = await raffleManager.MERCHANT_ROLE();
      await raffleManager.grantRole(MERCHANT_ROLE, merchant.address);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
      const pastTimestamp = (await time.latest()) - 86400;

      await expect(
        raffleManager
          .connect(merchant)
          .createRaffle(merkleRoot, ethers.ZeroAddress, 100, pastTimestamp, "ipfs://test")
      ).to.be.revertedWith("RaffleManager: expiryTimestamp must be in the future");
    });

    it("Should increment raffle counter", async function () {
      const { raffleManager, merchant } = await loadFixture(deployRaffleManagerFixture);

      const MERCHANT_ROLE = await raffleManager.MERCHANT_ROLE();
      await raffleManager.grantRole(MERCHANT_ROLE, merchant.address);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
      const expiryTimestamp = (await time.latest()) + 86400;

      expect(await raffleManager.getRaffleCounter()).to.equal(0);

      await raffleManager
        .connect(merchant)
        .createRaffle(merkleRoot, ethers.ZeroAddress, 100, expiryTimestamp, "ipfs://test");

      expect(await raffleManager.getRaffleCounter()).to.equal(1);
    });

    it("Should allow admin to create raffle", async function () {
      const { raffleManager, owner } = await loadFixture(deployRaffleManagerFixture);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
      const expiryTimestamp = (await time.latest()) + 86400;

      await expect(
        raffleManager.createRaffle(merkleRoot, ethers.ZeroAddress, 100, expiryTimestamp, "ipfs://test")
      ).to.emit(raffleManager, "RaffleCreated");
    });
  });

  describe("updateMetadata", function () {
    it("Should update metadata URI", async function () {
      const { raffleManager, merchant } = await loadFixture(deployRaffleManagerFixture);

      const MERCHANT_ROLE = await raffleManager.MERCHANT_ROLE();
      await raffleManager.grantRole(MERCHANT_ROLE, merchant.address);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
      const expiryTimestamp = (await time.latest()) + 86400;

      await raffleManager
        .connect(merchant)
        .createRaffle(merkleRoot, ethers.ZeroAddress, 100, expiryTimestamp, "ipfs://old");

      const newURI = "ipfs://new";
      await expect(raffleManager.connect(merchant).updateMetadata(1, newURI))
        .to.emit(raffleManager, "RaffleMetadataUpdated")
        .withArgs(1, newURI);

      const raffle = await raffleManager.getRaffle(1);
      expect(raffle.metadataURI).to.equal(newURI);
    });

    it("Should revert if caller is not merchant or admin", async function () {
      const { raffleManager, merchant, otherAccount } = await loadFixture(deployRaffleManagerFixture);

      const MERCHANT_ROLE = await raffleManager.MERCHANT_ROLE();
      await raffleManager.grantRole(MERCHANT_ROLE, merchant.address);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
      const expiryTimestamp = (await time.latest()) + 86400;

      await raffleManager
        .connect(merchant)
        .createRaffle(merkleRoot, ethers.ZeroAddress, 100, expiryTimestamp, "ipfs://test");

      await expect(
        raffleManager.connect(otherAccount).updateMetadata(1, "ipfs://new")
      ).to.be.revertedWith("RaffleManager: only merchant or admin can update");
    });
  });

  describe("setRaffleStatus", function () {
    it("Should update raffle status", async function () {
      const { raffleManager, merchant } = await loadFixture(deployRaffleManagerFixture);

      const MERCHANT_ROLE = await raffleManager.MERCHANT_ROLE();
      await raffleManager.grantRole(MERCHANT_ROLE, merchant.address);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
      const expiryTimestamp = (await time.latest()) + 86400;

      await raffleManager
        .connect(merchant)
        .createRaffle(merkleRoot, ethers.ZeroAddress, 100, expiryTimestamp, "ipfs://test");

      await expect(raffleManager.connect(merchant).setRaffleStatus(1, false))
        .to.emit(raffleManager, "RaffleStatusChanged")
        .withArgs(1, false);

      const raffle = await raffleManager.getRaffle(1);
      expect(raffle.isActive).to.be.false;
    });

    it("Should revert if trying to change status after expiry", async function () {
      const { raffleManager, merchant } = await loadFixture(deployRaffleManagerFixture);

      const MERCHANT_ROLE = await raffleManager.MERCHANT_ROLE();
      await raffleManager.grantRole(MERCHANT_ROLE, merchant.address);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
      const expiryTimestamp = (await time.latest()) + 86400;

      await raffleManager
        .connect(merchant)
        .createRaffle(merkleRoot, ethers.ZeroAddress, 100, expiryTimestamp, "ipfs://test");

      await time.increaseTo(expiryTimestamp + 1);

      await expect(
        raffleManager.connect(merchant).setRaffleStatus(1, false)
      ).to.be.revertedWith("RaffleManager: cannot change status after expiry");
    });
  });

  describe("Pausable", function () {
    it("Should pause and unpause", async function () {
      const { raffleManager, owner } = await loadFixture(deployRaffleManagerFixture);

      await raffleManager.pause();
      expect(await raffleManager.paused()).to.be.true;

      await raffleManager.unpause();
      expect(await raffleManager.paused()).to.be.false;
    });

    it("Should revert createRaffle when paused", async function () {
      const { raffleManager, merchant, owner } = await loadFixture(deployRaffleManagerFixture);

      const MERCHANT_ROLE = await raffleManager.MERCHANT_ROLE();
      await raffleManager.grantRole(MERCHANT_ROLE, merchant.address);

      await raffleManager.pause();

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test-root"));
      const expiryTimestamp = (await time.latest()) + 86400;

      await expect(
        raffleManager
          .connect(merchant)
          .createRaffle(merkleRoot, ethers.ZeroAddress, 100, expiryTimestamp, "ipfs://test")
      ).to.be.revertedWithCustomError(raffleManager, "EnforcedPause");
    });
  });
});

