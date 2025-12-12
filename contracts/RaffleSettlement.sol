// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./RaffleManager.sol";
import "./RaffleRegistry.sol";
import "./interfaces/IZKVerifier.sol";

/**
 * @title RaffleSettlement
 * @notice Handles reveal and settlement of raffle winners
 * @dev Verifies Merkle proofs and distributes rewards
 */
contract RaffleSettlement is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice Reference to RaffleManager
    RaffleManager public immutable raffleManager;

    /// @notice Reference to RaffleRegistry
    RaffleRegistry public immutable raffleRegistry;

    /// @notice Optional ZK verifier contract
    IZKVerifier public zkVerifier;

    /// @notice Mapping from raffleId => sid => isSettled
    mapping(uint256 => mapping(bytes32 => bool)) public settledClaims;

    /// @notice Mapping from raffleId => totalWinners
    mapping(uint256 => uint256) public totalWinners;

    /// @notice Event emitted when a winner is settled
    event WinnerSettled(
        uint256 indexed raffleId,
        bytes32 indexed sid,
        address indexed winner,
        address rewardToken,
        uint256 rewardAmount,
        uint256 tokenId // For ERC721, 0 for ERC20/ETH
    );

    /// @notice Event emitted when a non-winner is revealed
    event NonWinnerRevealed(
        uint256 indexed raffleId,
        bytes32 indexed sid,
        address indexed claimer
    );

    /// @notice Event emitted when ZK verifier is updated
    event ZKVerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

    constructor(address _raffleManager, address _raffleRegistry) {
        require(_raffleManager != address(0), "RaffleSettlement: invalid manager address");
        require(_raffleRegistry != address(0), "RaffleSettlement: invalid registry address");
        
        raffleManager = RaffleManager(_raffleManager);
        raffleRegistry = RaffleRegistry(_raffleRegistry);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SETTLER_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }

    /**
     * @notice Set the ZK verifier contract address
     * @param _zkVerifier Address of the ZK verifier contract
     */
    function setZKVerifier(address _zkVerifier) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldVerifier = address(zkVerifier);
        zkVerifier = IZKVerifier(_zkVerifier);
        emit ZKVerifierUpdated(oldVerifier, _zkVerifier);
    }

    /**
     * @notice Reveal and settle a single claim
     * @param raffleId The ID of the raffle
     * @param sid The serial ID
     * @param r The random salt
     * @param win Whether this is a winning ticket
     * @param merkleProof The Merkle proof for the leaf
     */
    function revealAndSettle(
        uint256 raffleId,
        bytes32 sid,
        bytes32 r,
        bool win,
        bytes32[] calldata merkleProof
    ) external whenNotPaused nonReentrant {
        // Verify raffle exists
        RaffleManager.Raffle memory raffle = raffleManager.getRaffle(raffleId);
        require(raffle.merchant != address(0), "RaffleSettlement: raffle does not exist");
        require(
            block.timestamp >= raffle.expiryTimestamp,
            "RaffleSettlement: claim period not expired yet"
        );

        // Verify claim exists and not already settled
        RaffleRegistry.Claim memory claim = raffleRegistry.getClaim(raffleId, sid);
        require(claim.claimer != address(0), "RaffleSettlement: claim does not exist");
        require(!settledClaims[raffleId][sid], "RaffleSettlement: claim already settled");

        // Compute leaf: keccak256(sid || r || win)
        bytes32 leaf = keccak256(abi.encodePacked(sid, r, win));

        // Verify Merkle proof
        require(
            MerkleProof.verify(merkleProof, raffle.merkleRoot, leaf),
            "RaffleSettlement: invalid Merkle proof"
        );

        // Mark as settled
        settledClaims[raffleId][sid] = true;
        raffleRegistry.markClaimRevealed(raffleId, sid);

        if (win) {
            totalWinners[raffleId]++;
            _distributeReward(raffleId, sid, claim.claimer, raffle.rewardToken);
            emit WinnerSettled(raffleId, sid, claim.claimer, raffle.rewardToken, 0, 0);
        } else {
            emit NonWinnerRevealed(raffleId, sid, claim.claimer);
        }
    }

    /**
     * @notice Batch reveal and settle multiple claims
     * @param raffleId The ID of the raffle
     * @param sids Array of serial IDs
     * @param rs Array of random salts
     * @param wins Array of win flags
     * @param merkleProofs Array of Merkle proofs
     */
    function batchRevealAndSettle(
        uint256 raffleId,
        bytes32[] calldata sids,
        bytes32[] calldata rs,
        bool[] calldata wins,
        bytes32[][] calldata merkleProofs
    ) external whenNotPaused nonReentrant {
        require(
            sids.length == rs.length &&
                rs.length == wins.length &&
                wins.length == merkleProofs.length,
            "RaffleSettlement: arrays length mismatch"
        );
        require(sids.length > 0, "RaffleSettlement: empty arrays");

        // Verify raffle exists (once for batch)
        RaffleManager.Raffle memory raffle = raffleManager.getRaffle(raffleId);
        require(raffle.merchant != address(0), "RaffleSettlement: raffle does not exist");
        require(
            block.timestamp >= raffle.expiryTimestamp,
            "RaffleSettlement: claim period not expired yet"
        );

        for (uint256 i = 0; i < sids.length; i++) {
            bytes32 sid = sids[i];
            bytes32 r = rs[i];
            bool win = wins[i];
            bytes32[] calldata merkleProof = merkleProofs[i];

            // Skip if already settled
            if (settledClaims[raffleId][sid]) {
                continue;
            }

            // Verify claim exists
            RaffleRegistry.Claim memory claim = raffleRegistry.getClaim(raffleId, sid);
            if (claim.claimer == address(0)) {
                continue;
            }

            // Compute leaf and verify Merkle proof
            bytes32 leaf = keccak256(abi.encodePacked(sid, r, win));
            if (!MerkleProof.verify(merkleProof, raffle.merkleRoot, leaf)) {
                continue; // Skip invalid proofs
            }

            // Mark as settled
            settledClaims[raffleId][sid] = true;
            raffleRegistry.markClaimRevealed(raffleId, sid);

            if (win) {
                totalWinners[raffleId]++;
                _distributeReward(raffleId, sid, claim.claimer, raffle.rewardToken);
                emit WinnerSettled(raffleId, sid, claim.claimer, raffle.rewardToken, 0, 0);
            } else {
                emit NonWinnerRevealed(raffleId, sid, claim.claimer);
            }
        }
    }

    /**
     * @notice Verify a leaf against the Merkle root (view function)
     * @param raffleId The ID of the raffle
     * @param sid The serial ID
     * @param r The random salt
     * @param win Whether this is a winning ticket
     * @param merkleProof The Merkle proof
     * @return valid Whether the proof is valid
     */
    function verifyLeafAndMerkle(
        uint256 raffleId,
        bytes32 sid,
        bytes32 r,
        bool win,
        bytes32[] calldata merkleProof
    ) external view returns (bool valid) {
        RaffleManager.Raffle memory raffle = raffleManager.getRaffle(raffleId);
        if (raffle.merchant == address(0)) {
            return false;
        }

        bytes32 leaf = keccak256(abi.encodePacked(sid, r, win));
        return MerkleProof.verify(merkleProof, raffle.merkleRoot, leaf);
    }

    /**
     * @notice Distribute reward to winner
     * @dev Internal function to handle different reward types
     * @param raffleId The ID of the raffle
     * @param sid The serial ID
     * @param winner The winner address
     * @param rewardToken The reward token address (address(0) for ETH)
     */
    function _distributeReward(
        uint256 raffleId,
        bytes32 sid,
        address winner,
        address rewardToken
    ) internal {
        // For now, this is a placeholder. Actual distribution logic depends on:
        // - ERC20: transfer tokens from contract or merchant
        // - ERC721: mint or transfer NFT
        // - ETH: transfer native currency
        
        // This should be implemented based on specific requirements
        // For example, if rewards are pre-funded in this contract:
        // if (rewardToken == address(0)) {
        //     payable(winner).transfer(rewardAmount);
        // } else {
        //     IERC20(rewardToken).safeTransfer(winner, rewardAmount);
        // }
        
        // Or if using a separate treasury contract, emit event for off-chain fulfillment
    }

    /**
     * @notice Check if a claim has been settled
     * @param raffleId The ID of the raffle
     * @param sid The serial ID
     * @return Whether the claim has been settled
     */
    function isSettled(uint256 raffleId, bytes32 sid) external view returns (bool) {
        return settledClaims[raffleId][sid];
    }

    /**
     * @notice Get total winners for a raffle
     * @param raffleId The ID of the raffle
     * @return The total number of winners
     */
    function getTotalWinners(uint256 raffleId) external view returns (uint256) {
        return totalWinners[raffleId];
    }

    /**
     * @notice Pause contract (admin only)
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause contract (admin only)
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}

