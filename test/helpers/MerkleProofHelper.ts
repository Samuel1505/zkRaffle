import { keccak256, AbiCoder } from "ethers";

/**
 * Simple Merkle tree implementation that matches OpenZeppelin's MerkleProof.verify format
 */
export class MerkleProofHelper {
  private leaves: string[];
  private tree: string[][];
  public root: string;

  constructor(leaves: string[]) {
    this.leaves = leaves;
    this.tree = [leaves];
    this.buildTree();
    this.root = this.tree[this.tree.length - 1][0];
  }

  private buildTree(): void {
    let currentLevel = this.leaves;

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];

      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          // Hash pair of nodes
          const left = currentLevel[i].slice(2); // Remove 0x
          const right = currentLevel[i + 1].slice(2);
          const combined = "0x" + left + right;
          nextLevel.push(keccak256(combined));
        } else {
          // Odd node, hash with itself
          const node = currentLevel[i].slice(2);
          const combined = "0x" + node + node;
          nextLevel.push(keccak256(combined));
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
        // If sibling doesn't exist (odd tree), use the node itself
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

