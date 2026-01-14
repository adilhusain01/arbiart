/**
 * Zero-Knowledge Proof Utilities
 * Generate and verify ZK proofs for photo ownership
 */

import { keccak256, toHex, concat } from 'viem';

/**
 * Generate a random secret for ZK commitment
 */
export function generateSecret(): bigint {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return BigInt('0x' + Array.from(array).map(b => b.toString(16).padStart(2, '0')).join(''));
}

/**
 * Compute ZK commitment
 * commitment = hash(photoHash || secret)
 * 
 * This is a simplified commitment scheme.
 * For production, use proper ZK-SNARKs with Circom/SnarkJS
 */
export function computeCommitment(photoHash: string, secret: bigint): string {
  const secretHex = toHex(secret, { size: 32 });
  const combined = concat([photoHash as `0x${string}`, secretHex as `0x${string}`]);
  return keccak256(combined);
}

/**
 * Generate ZK proof data
 * Returns commitment and secret (user must store secret securely!)
 */
export function generateZKProof(photoHash: string): {
  commitment: string;
  secret: string;
  secretBigInt: bigint;
} {
  const secretBigInt = generateSecret();
  const secretHex = '0x' + secretBigInt.toString(16).padStart(64, '0');
  const commitment = computeCommitment(photoHash, secretBigInt);
  
  return {
    commitment,
    secret: secretHex,
    secretBigInt,
  };
}

/**
 * Verify ZK proof locally (before sending to contract)
 */
export function verifyZKProofLocally(
  photoHash: string,
  commitment: string,
  secret: bigint
): boolean {
  const computed = computeCommitment(photoHash, secret);
  return computed.toLowerCase() === commitment.toLowerCase();
}

/**
 * Advanced: Generate Circom/SnarkJS proof (placeholder)
 * 
 * For real implementation:
 * 1. Install: npm install snarkjs circomlib
 * 2. Create circuit in Circom
 * 3. Compile circuit to WASM
 * 4. Generate witness
 * 5. Create proof
 * 6. Verify on-chain
 */
export async function generateSNARKProof(
  photoHash: string,
  secret: bigint
): Promise<{
  proof: any;
  publicSignals: any;
}> {
  // This would use actual snarkjs library
  console.warn('SNARK proof generation not implemented. Use circom + snarkjs for production.');
  
  // Placeholder return
  return {
    proof: {
      pi_a: [],
      pi_b: [],
      pi_c: [],
    },
    publicSignals: [],
  };
}

/**
 * Store secret securely in browser
 * WARNING: This is not truly secure - use hardware wallet or secure enclave in production
 */
export function storeSecretSecurely(photoHash: string, secret: string): void {
  const key = `zk_secret_${photoHash}`;
  
  // Option 1: localStorage (not secure, but simple)
  localStorage.setItem(key, secret);
  
  // Option 2: IndexedDB (better)
  // Option 3: Browser crypto API with password encryption
  // Option 4: Hardware wallet signing
}

/**
 * Retrieve stored secret
 */
export function retrieveSecret(photoHash: string): string | null {
  const key = `zk_secret_${photoHash}`;
  return localStorage.getItem(key);
}

/**
 * Delete secret (for privacy)
 */
export function deleteSecret(photoHash: string): void {
  const key = `zk_secret_${photoHash}`;
  localStorage.removeItem(key);
}

/**
 * Encrypt image data (for private storage)
 */
export async function encryptImage(
  imageData: ArrayBuffer,
  password: string
): Promise<{ encrypted: ArrayBuffer; iv: Uint8Array }> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('arbipic-salt'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    imageData
  );
  
  return { encrypted, iv };
}

/**
 * Decrypt image data
 */
export async function decryptImage(
  encryptedData: ArrayBuffer,
  password: string,
  iv: Uint8Array
): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('arbipic-salt'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  
  // Create a copy of the IV to avoid TypedArray issues
  const ivCopy = new Uint8Array(iv);
  
  return await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivCopy },
    key,
    encryptedData
  );
}
