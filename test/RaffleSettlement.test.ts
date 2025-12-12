import { expect } from "chai";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import hre from "hardhat";
import { ethers } from "hardhat";
import { MerkleTree } from "@openzeppelin/merkle-tree";

describe("RaffleSettlement", function () {
  async function deployContractsFixture() {
    const [owner, merchant, user1, user2, settler] = await hre.ethers.getSigners();

    const RaffleManager = await hre.ethers.getContractFactory("RaffleManager");
    const raffleManager = await RaffleManager.deploy();

    const RaffleRegistry = await hre.ethers.getContractFactory("RaffleRegistry");
    const raffleRegistry = await RaffleRegistry.deploy(await raffleManager.getAddress());

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
      settler,
    };
  }

  async function createRaffleWithClaims(
    raffleManager: any,
    raffleRegistry: any,
    merchant: any,
    users: any[],
    numWinners: number
  ) {
    // Create leaves for Merkle tree
    const leaves: string[][] = [];
    const claims: Array<{ sid: string; r: string; win: boolean; user: any }> = [];

    for (let i = 0; i < 10; i++) {
      const sid = ethers.keccak256(ethers.toUtf8Bytes(`product-${i}`));
      const r = ethers.keccak256(ethers.toUtf8Bytes(`salt-${i}`));
      const win = i < numWinners;
      const user = users[i % users.length];

      // Leaf = keccak256(abi.encodePacked(sid, r, win))
      const leaf = ethers.solidityPackedKeccak256(["bytes32", "bytes32", "bool"], [sid, r, win]);
      leaves.push([leaf]);

      claims.push({ sid, r, win, user });
    }

    // Build Merkle tree
    const tree = new MerkleTree(leaves, ["bytes32"]);
    const merkleRoot = tree.root;

    // Create raffle
    const expiryTimestamp = (await time.latest()) + 86400;
    const tx = await raffleManager
      .connect(merchant)
      .createRaffle(merkleRoot, ethers.ZeroAddress, 10, expiryTimestamp, "ipfs://test");

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

    // Register claims
    for (const claim of claims) {
      const encryptedPayload = ethers.toUtf8Bytes(`encrypted-${claim.sid}`);
      await raffleRegistry
        .connect(claim.user)
        .claimParticipation(raffleId, claim.sid, encryptedPayload);
    }

    return { raffleId, merkleRoot, expiryTimestamp, tree, claims };
  }

  describe("Deployment", function () {
    it("Should set the right manager and registry addresses", async function () {
      const { raffleManager, raffleRegistry, raffleSettlement } = await loadFixture(
        deployContractsFixture
      );

      expect(await raffleSettlement.raffleManager()).to.equal(await raffleManager.getAddress());
      expect(await raffleSettlement.raffleRegistry()).to.equal(await raffleRegistry.getAddress());
    });
  });

  describe("revealAndSettle", function () {
    it("Should settle a winning claim", async function () {
      const { raffleManager, raffleRegistry, raffleSettlement, merchant, user1, user2 } =
        await loadFixture(deployContractsFixture);

      const { raffleId, tree, claims, expiryTimestamp } = await createRaffleWithClaims(
        raffleManager,
        raffleRegistry,
        merchant,
        [user1, user2],
        3
      );

      // Move time past expiry
      await time.increaseTo(expiryTimestamp + 1);

      // Find a winning claim
      const winningClaim = claims.find((c) => c.win);
      if (!winningClaim) throw new Error("No winning claim found");

      const leaf = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "bool"],
        [winningClaim.sid, winningClaim.r, winningClaim.win]
      );

      const proof = tree.getProof([leaf]);

      await expect(
        raffleSettlement.revealAndSettle(
          raffleId,
          winningClaim.sid,
          winningClaim.r,
          winningClaim.win,
          proof
        )
      )
        .to.emit(raffleSettlement, "WinnerSettled")
        .withArgs(
          raffleId,
          winningClaim.sid,
          winningClaim.user.address,
          ethers.ZeroAddress,
          0,
          0
        );

      expect(await raffleSettlement.isSettled(raffleId, winningClaim.sid)).to.be.true;
      expect(await raffleSettlement.getTotalWinners(raffleId)).to.equal(1n);
    });

    it("Should reveal a non-winning claim", async function () {
      const { raffleManager, raffleRegistry, raffleSettlement, merchant, user1, user2 } =
        await loadFixture(deployContractsFixture);

      const { raffleId, tree, claims, expiryTimestamp } = await createRaffleWithClaims(
        raffleManager,
        raffleRegistry,
        merchant,
        [user1, user2],
        3
      );

      await time.increaseTo(expiryTimestamp + 1);

      // Find a non-winning claim
      const nonWinningClaim = claims.find((c) => !c.win);
      if (!nonWinningClaim) throw new Error("No non-winning claim found");

      const leaf = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "bool"],
        [nonWinningClaim.sid, nonWinningClaim.r, nonWinningClaim.win]
      );

      const proof = tree.getProof([leaf]);

      await expect(
        raffleSettlement.revealAndSettle(
          raffleId,
          nonWinningClaim.sid,
          nonWinningClaim.r,
          nonWinningClaim.win,
          proof
        )
      )
        .to.emit(raffleSettlement, "NonWinnerRevealed")
        .withArgs(raffleId, nonWinningClaim.sid, nonWinningClaim.user.address);

      expect(await raffleSettlement.isSettled(raffleId, nonWinningClaim.sid)).to.be.true;
    });

    it("Should revert if claim period not expired", async function () {
      const { raffleManager, raffleRegistry, raffleSettlement, merchant, user1, user2 } =
        await loadFixture(deployContractsFixture);

      const { raffleId, tree, claims } = await createRaffleWithClaims(
        raffleManager,
        raffleRegistry,
        merchant,
        [user1, user2],
        3
      );

      const claim = claims[0];
      const leaf = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "bool"],
        [claim.sid, claim.r, claim.win]
      );
      const proof = tree.getProof([leaf]);

      await expect(
        raffleSettlement.revealAndSettle(raffleId, claim.sid, claim.r, claim.win, proof)
      ).to.be.revertedWith("RaffleSettlement: claim period not expired yet");
    });

    it("Should revert if claim doesn't exist", async function () {
      const { raffleManager, raffleRegistry, raffleSettlement, merchant, user1, user2 } =
        await loadFixture(deployContractsFixture);

      const { raffleId, expiryTimestamp } = await createRaffleWithClaims(
        raffleManager,
        raffleRegistry,
        merchant,
        [user1, user2],
        3
      );

      await time.increaseTo(expiryTimestamp + 1);

      const fakeSid = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      const fakeR = ethers.keccak256(ethers.toUtf8Bytes("fake-r"));

      await expect(
        raffleSettlement.revealAndSettle(raffleId, fakeSid, fakeR, true, [])
      ).to.be.revertedWith("RaffleSettlement: claim does not exist");
    });

    it("Should revert if claim already settled", async function () {
      const { raffleManager, raffleRegistry, raffleSettlement, merchant, user1, user2 } =
        await loadFixture(deployContractsFixture);

      const { raffleId, tree, claims, expiryTimestamp } = await createRaffleWithClaims(
        raffleManager,
        raffleRegistry,
        merchant,
        [user1, user2],
        3
      );

      await time.increaseTo(expiryTimestamp + 1);

      const claim = claims[0];
      const leaf = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "bool"],
        [claim.sid, claim.r, claim.win]
      );
      const proof = tree.getProof([leaf]);

      await raffleSettlement.revealAndSettle(raffleId, claim.sid, claim.r, claim.win, proof);

      await expect(
        raffleSettlement.revealAndSettle(raffleId, claim.sid, claim.r, claim.win, proof)
      ).to.be.revertedWith("RaffleSettlement: claim already settled");
    });

    it("Should revert if Merkle proof is invalid", async function () {
      const { raffleManager, raffleRegistry, raffleSettlement, merchant, user1, user2 } =
        await loadFixture(deployContractsFixture);

      const { raffleId, claims, expiryTimestamp } = await createRaffleWithClaims(
        raffleManager,
        raffleRegistry,
        merchant,
        [user1, user2],
        3
      );

      await time.increaseTo(expiryTimestamp + 1);

      const claim = claims[0];
      const invalidProof = [ethers.keccak256(ethers.toUtf8Bytes("invalid"))];

      await expect(
        raffleSettlement.revealAndSettle(raffleId, claim.sid, claim.r, claim.win, invalidProof)
      ).to.be.revertedWith("RaffleSettlement: invalid Merkle proof");
    });
  });

  describe("verifyLeafAndMerkle", function () {
    it("Should verify valid leaf and Merkle proof", async function () {
      const { raffleManager, raffleRegistry, raffleSettlement, merchant, user1, user2 } =
        await loadFixture(deployContractsFixture);

      const { raffleId, tree, claims } = await createRaffleWithClaims(
        raffleManager,
        raffleRegistry,
        merchant,
        [user1, user2],
        3
      );

      const claim = claims[0];
      const leaf = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "bool"],
        [claim.sid, claim.r, claim.win]
      );
      const proof = tree.getProof([leaf]);

      const isValid = await raffleSettlement.verifyLeafAndMerkle(
        raffleId,
        claim.sid,
        claim.r,
        claim.win,
        proof
      );

      expect(isValid).to.be.true;
    });

    it("Should return false for invalid proof", async function () {
      const { raffleManager, raffleRegistry, raffleSettlement, merchant, user1, user2 } =
        await loadFixture(deployContractsFixture);

      const { raffleId, claims } = await createRaffleWithClaims(
        raffleManager,
        raffleRegistry,
        merchant,
        [user1, user2],
        3
      );

      const claim = claims[0];
      const invalidProof = [ethers.keccak256(ethers.toUtf8Bytes("invalid"))];

      const isValid = await raffleSettlement.verifyLeafAndMerkle(
        raffleId,
        claim.sid,
        claim.r,
        claim.win,
        invalidProof
      );

      expect(isValid).to.be.false;
    });
  });

  describe("setZKVerifier", function () {
    it("Should set ZK verifier address", async function () {
      const { raffleSettlement, owner } = await loadFixture(deployContractsFixture);

      const newVerifier = ethers.Wallet.createRandom().address;

      await expect(raffleSettlement.setZKVerifier(newVerifier))
        .to.emit(raffleSettlement, "ZKVerifierUpdated")
        .withArgs(ethers.ZeroAddress, newVerifier);

      expect(await raffleSettlement.zkVerifier()).to.equal(newVerifier);
    });

    it("Should revert if caller is not admin", async function () {
      const { raffleSettlement, user1 } = await loadFixture(deployContractsFixture);

      const newVerifier = ethers.Wallet.createRandom().address;

      await expect(
        raffleSettlement.connect(user1).setZKVerifier(newVerifier)
      ).to.be.revertedWithCustomError(raffleSettlement, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Pausable", function () {
    it("Should revert revealAndSettle when paused", async function () {
      const { raffleManager, raffleRegistry, raffleSettlement, merchant, user1, user2, owner } =
        await loadFixture(deployContractsFixture);

      const { raffleId, tree, claims, expiryTimestamp } = await createRaffleWithClaims(
        raffleManager,
        raffleRegistry,
        merchant,
        [user1, user2],
        3
      );

      await time.increaseTo(expiryTimestamp + 1);
      await raffleSettlement.pause();

      const claim = claims[0];
      const leaf = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "bool"],
        [claim.sid, claim.r, claim.win]
      );
      const proof = tree.getProof([leaf]);

      await expect(
        raffleSettlement.revealAndSettle(raffleId, claim.sid, claim.r, claim.win, proof)
      ).to.be.revertedWithCustomError(raffleSettlement, "EnforcedPause");
    });
  });
});

