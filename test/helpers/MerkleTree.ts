import { keccak256, solidityPackedKeccak256, AbiCoder } from "ethers";

export interface Leaf {
  sid: string; // bytes32 as hex string
  r: string; // bytes32 as hex string
  win: boolean;
}

export class MerkleTree {
  private leaves: string[];
  private tree: string[][];
  public root: string;

  constructor(leaves: Leaf[]) {
    // Compute leaf hashes: keccak256(abi.encodePacked(sid, r, win))
    // This matches the contract's keccak256(abi.encodePacked(sid, r, win))
    this.leaves = leaves.map((leaf) => {
      const abiCoder = AbiCoder.defaultAbiCoder();
      const encoded = abiCoder.encode(
        ["bytes32", "bytes32", "bool"],
        [leaf.sid, leaf.r, leaf.win]
      );
      return keccak256(encoded);
    });

    // Build Merkle tree
    this.tree = [this.leaves];
    this.buildTree();
    this.root = this.tree[this.tree.length - 1][0];
  }

  private buildTree(): void {
    let currentLevel = this.leaves;

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];

      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          // Pair of nodes - hash concatenated
          const pair = currentLevel[i] + currentLevel[i + 1].slice(2); // Remove 0x from second
          const hash = keccak256("0x" + pair.replace(/0x/g, ""));
          nextLevel.push(hash);
        } else {
          // Odd node, hash with itself
          const pair = currentLevel[i] + currentLevel[i].slice(2);
          const hash = keccak256("0x" + pair.replace(/0x/g, ""));
          nextLevel.push(hash);
        }
      }

      this.tree.push(nextLevel);
      currentLevel = nextLevel;
    }
  }

  getProof(index: number): string[] {
    const proof: string[] = [];
    let currentIndex = index;

    for (let level = 0; level < this.tree.length - 1; level++) {
      const currentLevel = this.tree[level];
      const isLeftNode = currentIndex % 2 === 0;
      const siblingIndex = isLeftNode ? currentIndex + 1 : currentIndex - 1;

      if (siblingIndex < currentLevel.length) {
        proof.push(currentLevel[siblingIndex]);
      } else {
        // If sibling doesn't exist, use the node itself (for odd trees)
        proof.push(currentLevel[currentIndex]);
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return proof;
  }

  getRoot(): string {
    return this.root;
  }
}

