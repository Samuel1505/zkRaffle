import { keccak256, toUtf8Bytes, solidityPackedKeccak256 } from "ethers";

export interface Leaf {
  sid: string;
  r: string;
  win: boolean;
}

export class MerkleTree {
  private leaves: string[];
  private tree: string[][];
  public root: string;

  constructor(leaves: Leaf[]) {
    // Compute leaf hashes: keccak256(sid || r || win)
    this.leaves = leaves.map((leaf) =>
      solidityPackedKeccak256(
        ["bytes32", "bytes32", "bool"],
        [leaf.sid, leaf.r, leaf.win]
      )
    );

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
          // Pair of nodes
          const hash = keccak256(
            toUtf8Bytes(currentLevel[i] + currentLevel[i + 1])
          );
          nextLevel.push(hash);
        } else {
          // Odd node, hash with itself
          const hash = keccak256(
            toUtf8Bytes(currentLevel[i] + currentLevel[i])
          );
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

