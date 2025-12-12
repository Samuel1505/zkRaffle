// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title RaffleManager
 * @notice Manages raffle creation and lifecycle
 * @dev Handles raffle creation, metadata storage, and access control
 */
contract RaffleManager is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant MERCHANT_ROLE = keccak256("MERCHANT_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice Counter for raffle IDs
    uint256 private _raffleCounter;

    /// @notice Raffle structure
    struct Raffle {
        address merchant;
        bytes32 merkleRoot;
        address rewardToken; // address(0) for native ETH, or ERC20/ERC721 address
        uint256 totalLeaves;
        uint256 expiryTimestamp;
        string metadataURI;
        bool isActive;
        uint256 createdAt;
    }

    /// @notice Mapping from raffleId to Raffle
    mapping(uint256 => Raffle) public raffles;

    /// @notice Event emitted when a new raffle is created
    event RaffleCreated(
        uint256 indexed raffleId,
        bytes32 indexed merkleRoot,
        address indexed merchant,
        address rewardToken,
        uint256 totalLeaves,
        uint256 expiryTimestamp,
        string metadataURI
    );

    /// @notice Event emitted when raffle metadata is updated
    event RaffleMetadataUpdated(uint256 indexed raffleId, string metadataURI);

    /// @notice Event emitted when raffle status changes
    event RaffleStatusChanged(uint256 indexed raffleId, bool isActive);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }

    /**
     * @notice Create a new raffle
     * @param merkleRoot The Merkle root of all product leaves
     * @param rewardToken Address of reward token (address(0) for native ETH)
     * @param totalLeaves Total number of leaves in the Merkle tree
     * @param expiryTimestamp Timestamp when claim period expires
     * @param metadataURI URI pointing to raffle metadata (JSON)
     * @return raffleId The ID of the newly created raffle
     */
    function createRaffle(
        bytes32 merkleRoot,
        address rewardToken,
        uint256 totalLeaves,
        uint256 expiryTimestamp,
        string calldata metadataURI
    ) external whenNotPaused nonReentrant returns (uint256 raffleId) {
        require(
            hasRole(MERCHANT_ROLE, msg.sender) || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "RaffleManager: must have merchant or admin role"
        );
        require(merkleRoot != bytes32(0), "RaffleManager: merkleRoot cannot be zero");
        require(totalLeaves > 0, "RaffleManager: totalLeaves must be > 0");
        require(
            expiryTimestamp > block.timestamp,
            "RaffleManager: expiryTimestamp must be in the future"
        );

        raffleId = ++_raffleCounter;

        raffles[raffleId] = Raffle({
            merchant: msg.sender,
            merkleRoot: merkleRoot,
            rewardToken: rewardToken,
            totalLeaves: totalLeaves,
            expiryTimestamp: expiryTimestamp,
            metadataURI: metadataURI,
            isActive: true,
            createdAt: block.timestamp
        });

        emit RaffleCreated(
            raffleId,
            merkleRoot,
            msg.sender,
            rewardToken,
            totalLeaves,
            expiryTimestamp,
            metadataURI
        );

        return raffleId;
    }

    /**
     * @notice Update raffle metadata URI
     * @param raffleId The ID of the raffle
     * @param metadataURI New metadata URI
     */
    function updateMetadata(
        uint256 raffleId,
        string calldata metadataURI
    ) external {
        Raffle storage raffle = raffles[raffleId];
        require(raffle.merchant != address(0), "RaffleManager: raffle does not exist");
        require(
            raffle.merchant == msg.sender || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "RaffleManager: only merchant or admin can update"
        );

        raffle.metadataURI = metadataURI;
        emit RaffleMetadataUpdated(raffleId, metadataURI);
    }

    /**
     * @notice Set raffle active status (only before expiry)
     * @param raffleId The ID of the raffle
     * @param isActive New active status
     */
    function setRaffleStatus(uint256 raffleId, bool isActive) external {
        Raffle storage raffle = raffles[raffleId];
        require(raffle.merchant != address(0), "RaffleManager: raffle does not exist");
        require(
            raffle.merchant == msg.sender ||
                hasRole(OPERATOR_ROLE, msg.sender) ||
                hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "RaffleManager: unauthorized"
        );
        require(
            block.timestamp < raffle.expiryTimestamp,
            "RaffleManager: cannot change status after expiry"
        );

        raffle.isActive = isActive;
        emit RaffleStatusChanged(raffleId, isActive);
    }

    /**
     * @notice Get raffle details
     * @param raffleId The ID of the raffle
     * @return raffle The raffle structure
     */
    function getRaffle(uint256 raffleId) external view returns (Raffle memory) {
        return raffles[raffleId];
    }

    /**
     * @notice Get the current raffle counter
     * @return The current raffle counter
     */
    function getRaffleCounter() external view returns (uint256) {
        return _raffleCounter;
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

