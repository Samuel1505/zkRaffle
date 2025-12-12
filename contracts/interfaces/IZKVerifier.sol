// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IZKVerifier
 * @notice Interface for zero-knowledge proof verification
 * @dev This interface can be implemented by various ZK proof systems (zk-SNARKs, zk-STARKs, etc.)
 */
interface IZKVerifier {
    /**
     * @notice Verify a ZK proof for raffle settlement
     * @param raffleId The ID of the raffle
     * @param proof The ZK proof bytes
     * @param publicInputs The public inputs to the proof
     * @return valid Whether the proof is valid
     */
    function verifyProof(
        uint256 raffleId,
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external view returns (bool valid);
}

