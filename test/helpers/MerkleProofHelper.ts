import { keccak256, concat } from "ethers";

/**
 * Merkle tree helper that builds trees compatible with OpenZeppelin's MerkleProof.verify
 * Uses commutative keccak256 hashing (sorted pairs)
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

  private commutativeKeccak256(a: string, b: string): string {
    // Sort to make it commutative: hash the smaller one first
    const aNum = BigInt(a);
    const bNum = BigInt(b);
    const sorted = aNum < bNum ? [a, b] : [b, a];
    return keccak256(concat(sorted));
  }

  private buildTree(): void {
    let currentLevel = this.leaves;

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];

      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          // Hash pair using commutative function
          const hash = this.commutativeKeccak256(currentLevel[i], currentLevel[i + 1]);
          nextLevel.push(hash);
        } else {
          // Odd node, hash with itself
          const hash = this.commutativeKeccak256(currentLevel[i], currentLevel[i]);
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

