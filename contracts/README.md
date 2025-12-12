# zkAssetRaffle Smart Contracts

A decentralized, fair, and verifiable raffle protocol for real-world assets (RWA) using encrypted QR codes and zero-knowledge proofs. Built for Base (EVM L2).

## Architecture

The smart contract system consists of three main contracts:

### 1. RaffleManager.sol
Manages raffle creation and lifecycle.

**Key Functions:**
- `createRaffle()` - Create a new raffle with Merkle root and metadata
- `updateMetadata()` - Update raffle metadata URI
- `setRaffleStatus()` - Activate/deactivate raffles

**Roles:**
- `MERCHANT_ROLE` - Can create raffles
- `OPERATOR_ROLE` - Can manage raffle status
- `DEFAULT_ADMIN_ROLE` - Full admin access

### 2. RaffleRegistry.sol
Records user participation claims.

**Key Functions:**
- `claimParticipation()` - Register a claim with serial ID and encrypted payload
- `batchClaimParticipation()` - Batch register multiple claims (gas optimization)
- `markClaimRevealed()` - Mark claim as revealed (called by settlement)

**Features:**
- Prevents duplicate claims per serial ID
- Tracks all claims per user
- Stores encrypted payloads until reveal

### 3. RaffleSettlement.sol
Handles reveal and settlement of raffle winners.

**Key Functions:**
- `revealAndSettle()` - Reveal and settle a single claim with Merkle proof
- `batchRevealAndSettle()` - Batch reveal multiple claims
- `verifyLeafAndMerkle()` - View function to verify Merkle proofs

**Security:**
- Verifies Merkle proofs before settlement
- Prevents double-settlement
- Only allows settlement after claim period expires

## Workflow

1. **Merchant Setup (Off-chain)**
   - Generate random salts `r_i` for each product
   - Compute leaves: `leaf_i = keccak256(sid_i || r_i || win_i)`
   - Build Merkle tree and get `merkleRoot`
   - Encrypt payloads: `C_i = Encrypt_key(r_i || win_i)`
   - Create QR codes with `sid_i` and `C_i`

2. **On-chain Registration**
   - Merchant calls `createRaffle()` with `merkleRoot`
   - Users scan QR codes and call `claimParticipation(raffleId, sid_i, C_i)`

3. **Reveal & Settlement**
   - After claim period expires, reveal decryption key
   - Decrypt `C_i` to get `(r_i, win_i)`
   - Call `revealAndSettle()` with Merkle proof
   - Winners are automatically identified and rewards distributed

## Security Features

- **Access Control**: Role-based access using OpenZeppelin's AccessControl
- **Reentrancy Protection**: ReentrancyGuard on all state-changing functions
- **Pausable**: Emergency pause mechanism
- **Merkle Proof Verification**: Cryptographic verification of winners
- **Duplicate Prevention**: Prevents double claims and double settlements

## Testing

Run tests with:
```bash
npm test
```

Test coverage includes:
- Positive flows (create raffle, claim, settle)
- Negative flows (duplicate claims, invalid proofs, expired periods)
- Access control and role management
- Integration tests for full lifecycle

## Deployment

Deploy to local network:
```bash
npm run deploy:local
```

Deploy to Base Sepolia:
```bash
npm run deploy:baseSepolia
```

Deploy to Base Mainnet:
```bash
npm run deploy:base
```

## Environment Variables

Create a `.env` file:
```
PRIVATE_KEY=your_private_key
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_MAINNET_RPC_URL=https://mainnet.base.org
BASESCAN_API_KEY=your_basescan_api_key
```

## Future Enhancements

- **ZK Verifier Integration**: Implement `IZKVerifier` for on-chain ZK proof verification
- **Reward Distribution**: Implement actual ERC20/ERC721/ETH distribution logic
- **Treasury Contract**: Separate contract for managing rewards
- **Dispute Resolution**: Challenge window for reveals
- **Upgradeability**: Proxy pattern for contract upgrades

## License

MIT

