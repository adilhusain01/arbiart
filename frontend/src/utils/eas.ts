/**
 * Ethereum Attestation Service (EAS) Integration
 * Creates on-chain attestations for verified photos
 * 
 * EAS on Arbitrum Sepolia: 0xaEF4103A04090071165F78D45D83A0C0782c2B2a
 * Schema Registry: 0x55D26f9ae0203EF95494AE4C170eD35f4Cf77797
 */

import { EAS, SchemaEncoder, SchemaRegistry, NO_EXPIRATION } from '@ethereum-attestation-service/eas-sdk'
import { ethers, keccak256, toUtf8Bytes, AbiCoder, Interface } from 'ethers'

// EAS Contract addresses on Arbitrum Sepolia
export const EAS_CONTRACT_ADDRESS = '0xaEF4103A04090071165F78D45D83A0C0782c2B2a'
export const SCHEMA_REGISTRY_ADDRESS = '0x55D26f9ae0203EF95494AE4C170eD35f4Cf77797'

// EAS ABI for the attest function
const EAS_ABI = [
  'function attest((bytes32 schema, (address recipient, uint64 expirationTime, bool revocable, bytes32 refUID, bytes data, uint256 value) data)) external payable returns (bytes32)'
]

// Our photo verification schema
export const PHOTO_VERIFICATION_SCHEMA = 'bytes32 photoHash, uint256 timestamp, address photographer, string ipfsCid, bytes32 zkCommitment'

// Storage key for schema UID
const SCHEMA_UID_KEY = 'arbipic_eas_schema_uid'

export interface PhotoAttestationData {
  photoHash: string
  timestamp: number
  photographer: string
  ipfsCid: string
  zkCommitment: string
}

/**
 * Get or register the schema UID
 * Schema UID is deterministically computed as keccak256(abi.encode(schema, resolver, revocable))
 */
async function getOrRegisterSchemaUID(signer: ethers.Signer): Promise<string> {
  // Compute the correct schema UID deterministically
  const abiCoder = AbiCoder.defaultAbiCoder()
  const encoded = abiCoder.encode(
    ['string', 'address', 'bool'],
    [PHOTO_VERIFICATION_SCHEMA, '0x0000000000000000000000000000000000000000', true]
  )
  const computedUID = keccak256(encoded)
  console.log('📋 Computed schema UID:', computedUID)
  
  // Check localStorage - if different, update it
  const storedUID = localStorage.getItem(SCHEMA_UID_KEY)
  if (storedUID !== computedUID) {
    console.log('📝 Updating stored schema UID from', storedUID, 'to', computedUID)
    localStorage.setItem(SCHEMA_UID_KEY, computedUID)
  }
  
  // Try to register the schema if not already registered
  // This is idempotent - if already registered, it will fail silently
  try {
    const schemaRegistry = new SchemaRegistry(SCHEMA_REGISTRY_ADDRESS)
    schemaRegistry.connect(signer)
    
    const transaction = await schemaRegistry.register({
      schema: PHOTO_VERIFICATION_SCHEMA,
      resolverAddress: '0x0000000000000000000000000000000000000000',
      revocable: true
    })
    
    await transaction.wait()
    console.log('✅ Schema registered successfully')
  } catch (error: any) {
    // Schema likely already exists - this is fine
    console.log('ℹ️ Schema registration skipped (likely already exists):', error.message?.slice(0, 100))
  }
  
  return computedUID
}

/**
 * Generate EAS explorer link for attestation
 */
export function getEASExplorerUrl(attestationUID: string): string {
  return `https://arbitrum-sepolia.easscan.org/attestation/view/${attestationUID}`
}

/**
 * Create on-chain EAS attestation for a verified photo
 */
export async function createSimpleAttestation(
  photoHash: string,
  timestamp: number,
  photographer: string,
  ipfsCid: string,
  zkCommitment: string
): Promise<{ success: boolean; attestationId?: string; explorerUrl?: string; error?: string }> {
  try {
    const ethereum = (window as any).ethereum
    if (!ethereum) {
      return { success: false, error: 'MetaMask not found' }
    }

    console.log('📜 Creating on-chain EAS attestation...')
    
    // Create ethers provider and signer
    const provider = new ethers.BrowserProvider(ethereum)
    const signer = await provider.getSigner()
    const signerAddress = await signer.getAddress()
    
    // Get or register schema
    const schemaUID = await getOrRegisterSchemaUID(signer)
    console.log('📋 Using schema UID:', schemaUID)
    
    // Ensure photoHash and zkCommitment are proper bytes32
    let formattedPhotoHash = photoHash.startsWith('0x') ? photoHash : `0x${photoHash}`
    let formattedZkCommitment = zkCommitment.startsWith('0x') ? zkCommitment : `0x${zkCommitment}`
    
    // Pad to 64 hex chars (32 bytes) after 0x
    formattedPhotoHash = formattedPhotoHash.slice(0, 2) + formattedPhotoHash.slice(2).padEnd(64, '0')
    formattedZkCommitment = formattedZkCommitment.slice(0, 2) + formattedZkCommitment.slice(2).padEnd(64, '0')
    
    // Encode attestation data using SchemaEncoder
    const schemaEncoder = new SchemaEncoder(PHOTO_VERIFICATION_SCHEMA)
    const encodedData = schemaEncoder.encodeData([
      { name: 'photoHash', value: formattedPhotoHash, type: 'bytes32' },
      { name: 'timestamp', value: BigInt(timestamp), type: 'uint256' },
      { name: 'photographer', value: photographer, type: 'address' },
      { name: 'ipfsCid', value: ipfsCid || '', type: 'string' },
      { name: 'zkCommitment', value: formattedZkCommitment, type: 'bytes32' }
    ])

    console.log('📤 Sending attestation transaction via raw method (bypassing simulation)...')
    
    // Build the calldata using ethers Interface for proper ABI encoding
    const easInterface = new Interface(EAS_ABI)
    
    // Create the attestation request struct
    const attestationRequest = {
      schema: schemaUID,
      data: {
        recipient: photographer,
        expirationTime: 0n, // NO_EXPIRATION
        revocable: true,
        refUID: '0x0000000000000000000000000000000000000000000000000000000000000000',
        data: encodedData,
        value: 0n
      }
    }
    
    // Encode the function call using the Interface
    const fullCalldata = easInterface.encodeFunctionData('attest', [attestationRequest])
    
    console.log('📋 EAS calldata:', fullCalldata.slice(0, 66) + '...')
    
    // Get current gas price for reliability
    const gasPrice = await ethereum.request({ method: 'eth_gasPrice' })
    
    // Send raw transaction to bypass MetaMask simulation
    const txHash = await ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: signerAddress,
        to: EAS_CONTRACT_ADDRESS,
        data: fullCalldata,
        gas: '0xB71B0', // 750000 gas for buffer
        gasPrice: gasPrice
      }]
    })
    
    console.log('📨 Transaction sent:', txHash)
    console.log('⏳ Waiting for confirmation...')
    
    // Wait for receipt
    const receipt = await provider.waitForTransaction(txHash)
    
    // Parse the Attested event to get UID
    let attestationUID: string = ''
    const attestedEventTopic = keccak256(toUtf8Bytes('Attested(address,address,bytes32,bytes32)'))
    
    if (receipt && receipt.logs) {
      for (const log of receipt.logs) {
        if (log.topics[0] === attestedEventTopic) {
          // UID is the 3rd indexed topic (topics[2])
          attestationUID = log.topics[2]
          console.log('📋 Parsed attestation UID:', attestationUID)
          break
        }
      }
    }
    
    if (!attestationUID) {
      // Fallback to tx hash
      attestationUID = txHash
      console.log('📋 Using tx hash as attestation reference:', attestationUID)
    }
    
    console.log('✅ EAS Attestation created:', attestationUID)
    
    // Store attestation data locally for reference
    const attestationData = {
      uid: attestationUID,
      schemaUID,
      photoHash: formattedPhotoHash,
      timestamp,
      photographer,
      ipfsCid,
      zkCommitment: formattedZkCommitment,
      createdAt: new Date().toISOString(),
      txHash: txHash
    }
    localStorage.setItem(`eas_attestation_${photoHash.replace('0x', '')}`, JSON.stringify(attestationData))
    
    return { 
      success: true, 
      attestationId: attestationUID,
      explorerUrl: getEASExplorerUrl(attestationUID)
    }
  } catch (error: any) {
    console.error('EAS attestation error:', error)
    return { 
      success: false, 
      error: error.message || 'Failed to create attestation'
    }
  }
}

/**
 * Get attestation by UID
 */
export async function getAttestation(uid: string) {
  const ethereum = (window as any).ethereum
  if (!ethereum) return null
  
  const provider = new ethers.BrowserProvider(ethereum)
  const eas = new EAS(EAS_CONTRACT_ADDRESS)
  eas.connect(provider)
  
  return await eas.getAttestation(uid)
}

/**
 * Check if photo has EAS attestation (from localStorage)
 */
export function getLocalEASAttestation(photoHash: string): any | null {
  const cleanHash = photoHash.replace('0x', '')
  const data = localStorage.getItem(`eas_attestation_${cleanHash}`)
  return data ? JSON.parse(data) : null
}

/**
 * Set schema UID manually (if registered via explorer)
 */
export function setSchemaUID(uid: string): void {
  localStorage.setItem(SCHEMA_UID_KEY, uid)
  console.log('📋 Schema UID set:', uid)
}

/**
 * Get current schema UID
 */
export function getSchemaUID(): string | null {
  return localStorage.getItem(SCHEMA_UID_KEY)
}
