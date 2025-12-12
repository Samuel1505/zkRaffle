// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./RaffleManager.sol";

/**
 * @title RaffleRegistry
 * @notice Records user participation claims for raffles
 * @dev Prevents duplicate claims and stores encrypted payloads
 */
contract RaffleRegistry is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice Reference to RaffleManager
    RaffleManager public immutable raffleManager;

    /// @notice Claim structure
    struct Claim {
        address claimer;
        bytes encryptedPayload; // C_i = Encrypt_key(r_i || win_i)
        uint256 claimedAt;
        bool isRevealed;
    }

    /// @notice Mapping from raffleId => sid => Claim
    mapping(uint256 => mapping(bytes32 => Claim)) public claims;

    /// @notice Mapping from raffleId => sid => bool (for duplicate prevention)
    mapping(uint256 => mapping(bytes32 => bool)) public claimedSids;

    /// @notice Mapping from raffleId => claimer => sid[] (track claims per user)
    mapping(uint256 => mapping(address => bytes32[])) public userClaims;

    /// @notice Event emitted when a participation is claimed
    event ParticipationClaimed(
        uint256 indexed raffleId,
        bytes32 indexed sid,
        address indexed claimer,
        bytes encryptedPayload
    );

    /// @notice Event emitted when a claim is marked as revealed
    event ClaimRevealed(uint256 indexed raffleId, bytes32 indexed sid);

    constructor(address _raffleManager) {
        require(_raffleManager != address(0), "RaffleRegistry: invalid manager address");
        raffleManager = RaffleManager(_raffleManager);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }

    /**
     * @notice Claim participation in a raffle
     * @param raffleId The ID of the raffle
     * @param sid The serial ID from the QR code
     * @param encryptedPayload The encrypted payload C_i
     */
    function claimParticipation(
        uint256 raffleId,
        bytes32 sid,
        bytes calldata encryptedPayload
    ) external whenNotPaused nonReentrant {
        // Verify raffle exists and is active
        RaffleManager.Raffle memory raffle = raffleManager.getRaffle(raffleId);
        require(raffle.merchant != address(0), "RaffleRegistry: raffle does not exist");
        require(raffle.isActive, "RaffleRegistry: raffle is not active");
        require(
            block.timestamp < raffle.expiryTimestamp,
            "RaffleRegistry: claim period has expired"
        );

        // Prevent duplicate claims for the same sid (unless raffle allows duplicates)
        require(
            !claimedSids[raffleId][sid],
            "RaffleRegistry: sid already claimed"
        );

        require(encryptedPayload.length > 0, "RaffleRegistry: encryptedPayload cannot be empty");

        // Record the claim
        claims[raffleId][sid] = Claim({
            claimer: msg.sender,
            encryptedPayload: encryptedPayload,
            claimedAt: block.timestamp,
            isRevealed: false
        });

        claimedSids[raffleId][sid] = true;
        userClaims[raffleId][msg.sender].push(sid);

        emit ParticipationClaimed(raffleId, sid, msg.sender, encryptedPayload);
    }

    /**
     * @notice Batch claim participations (gas optimization)
     * @param raffleId The ID of the raffle
     * @param sids Array of serial IDs
     * @param encryptedPayloads Array of encrypted payloads
     */
    function batchClaimParticipation(
        uint256 raffleId,
        bytes32[] calldata sids,
        bytes[] calldata encryptedPayloads
    ) external whenNotPaused nonReentrant {
        require(
            sids.length == encryptedPayloads.length,
            "RaffleRegistry: arrays length mismatch"
        );
        require(sids.length > 0, "RaffleRegistry: empty arrays");

        // Verify raffle exists and is active (once for batch)
        RaffleManager.Raffle memory raffle = raffleManager.getRaffle(raffleId);
        require(raffle.merchant != address(0), "RaffleRegistry: raffle does not exist");
        require(raffle.isActive, "RaffleRegistry: raffle is not active");
        require(
            block.timestamp < raffle.expiryTimestamp,
            "RaffleRegistry: claim period has expired"
        );

        for (uint256 i = 0; i < sids.length; i++) {
            bytes32 sid = sids[i];
            bytes calldata encryptedPayload = encryptedPayloads[i];

            require(
                !claimedSids[raffleId][sid],
                "RaffleRegistry: sid already claimed"
            );
            require(
                encryptedPayload.length > 0,
                "RaffleRegistry: encryptedPayload cannot be empty"
            );

            claims[raffleId][sid] = Claim({
                claimer: msg.sender,
                encryptedPayload: encryptedPayload,
                claimedAt: block.timestamp,
                isRevealed: false
            });

            claimedSids[raffleId][sid] = true;
            userClaims[raffleId][msg.sender].push(sid);

            emit ParticipationClaimed(raffleId, sid, msg.sender, encryptedPayload);
        }
    }

    /**
     * @notice Mark a claim as revealed (called by settlement contract)
     * @param raffleId The ID of the raffle
     * @param sid The serial ID
     */
    function markClaimRevealed(
        uint256 raffleId,
        bytes32 sid
    ) external onlyRole(OPERATOR_ROLE) {
        require(
            claims[raffleId][sid].claimer != address(0),
            "RaffleRegistry: claim does not exist"
        );
        require(
            !claims[raffleId][sid].isRevealed,
            "RaffleRegistry: claim already revealed"
        );

        claims[raffleId][sid].isRevealed = true;
        emit ClaimRevealed(raffleId, sid);
    }

    /**
     * @notice Get claim details
     * @param raffleId The ID of the raffle
     * @param sid The serial ID
     * @return claim The claim structure
     */
    function getClaim(
        uint256 raffleId,
        bytes32 sid
    ) external view returns (Claim memory) {
        return claims[raffleId][sid];
    }

    /**
     * @notice Get all claims for a user in a raffle
     * @param raffleId The ID of the raffle
     * @param user The user address
     * @return sids Array of serial IDs claimed by the user
     */
    function getUserClaims(
        uint256 raffleId,
        address user
    ) external view returns (bytes32[] memory) {
        return userClaims[raffleId][user];
    }

    /**
     * @notice Check if a sid has been claimed
     * @param raffleId The ID of the raffle
     * @param sid The serial ID
     * @return Whether the sid has been claimed
     */
    function isSidClaimed(
        uint256 raffleId,
        bytes32 sid
    ) external view returns (bool) {
        return claimedSids[raffleId][sid];
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

