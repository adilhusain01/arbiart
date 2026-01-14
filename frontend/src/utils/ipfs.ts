/**
 * IPFS Upload Utilities
 * Handles image upload to IPFS via Pinata SDK
 */

import { PinataSDK } from 'pinata';

// Initialize Pinata SDK with JWT
// You can get a JWT from https://app.pinata.cloud/developers/api-keys
const PINATA_JWT = import.meta.env.VITE_PINATA_JWT || '';
const PINATA_GATEWAY = import.meta.env.VITE_PINATA_GATEWAY || 'gateway.pinata.cloud';

// Initialize SDK (lazy initialization)
let pinataInstance: PinataSDK | null = null;

function getPinata(): PinataSDK | null {
  if (!PINATA_JWT) {
    console.warn('Pinata JWT not configured');
    return null;
  }
  if (!pinataInstance) {
    pinataInstance = new PinataSDK({
      pinataJwt: PINATA_JWT,
      pinataGateway: PINATA_GATEWAY
    });
  }
  return pinataInstance;
}

/**
 * Upload image to IPFS via Pinata SDK
 */
export async function uploadToPinata(
  imageBlob: Blob,
  metadata: Record<string, any>
): Promise<{ imageCid: string; thumbnailCid: string }> {
  const pinata = getPinata();
  
  // If Pinata not configured, return demo hash for development
  if (!pinata) {
    console.warn('Pinata not configured, generating demo CID');
    return generateDemoCid(imageBlob);
  }

  try {
    // Convert Blob to File for Pinata SDK
    const file = new File([imageBlob], `arbipic-${Date.now()}.jpg`, { type: 'image/jpeg' });
    
    // Upload using Pinata SDK
    const upload = await pinata.upload.public.file(file);
    
    if (upload.cid) {
      console.log('Pinata upload successful, CID:', upload.cid);
      
      // Get gateway URL for viewing
      const gatewayUrl = await pinata.gateways.public.convert(upload.cid);
      console.log('Gateway URL:', gatewayUrl);
      
      return {
        imageCid: upload.cid,
        thumbnailCid: upload.cid,
      };
    } else {
      console.error('Pinata upload returned no CID');
      return generateDemoCid(imageBlob);
    }
  } catch (error) {
    console.error('Pinata upload error:', error);
    return generateDemoCid(imageBlob);
  }
}

/**
 * Generate a demo CID when Pinata is not available
 */
async function generateDemoCid(imageBlob: Blob): Promise<{ imageCid: string; thumbnailCid: string }> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', await imageBlob.arrayBuffer());
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const demoHash = 'Qm' + hashArray.slice(0, 22).map(b => b.toString(16).padStart(2, '0')).join('');
  console.log('Using demo IPFS CID:', demoHash);
  return { imageCid: demoHash, thumbnailCid: demoHash };
}

/**
 * Upload to NFT.Storage (alternative)
 */
export async function uploadToNFTStorage(
  imageBlob: Blob
): Promise<{ imageCid: string; thumbnailCid: string }> {
  const formData = new FormData();
  formData.append('file', imageBlob);

  const NFT_STORAGE_KEY = import.meta.env.VITE_NFT_STORAGE_KEY || '';
  const response = await fetch('https://api.nft.storage/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NFT_STORAGE_KEY}`,
    },
    body: formData,
  });

  const data = await response.json();
  const cid = data.value.cid;
  
  return {
    imageCid: cid,
    thumbnailCid: cid,
  };
}

/**
 * Upload to Web3.Storage (another alternative)
 */
export async function uploadToWeb3Storage(
  imageBlob: Blob
): Promise<{ imageCid: string; thumbnailCid: string }> {
  // Implementation would go here
  // Requires @web3-storage/w3up-client package
  throw new Error('Not implemented - install @web3-storage/w3up-client');
}

/**
 * Create thumbnail from image
 */
export async function createThumbnail(
  imageDataUrl: string,
  maxWidth: number = 300
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      const scale = maxWidth / img.width;
      canvas.width = maxWidth;
      canvas.height = img.height * scale;
      
      ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create thumbnail'));
      }, 'image/jpeg', 0.7);
    };
    img.onerror = reject;
    img.src = imageDataUrl;
  });
}

/**
 * Convert data URL to Blob
 */
export function dataURLtoBlob(dataURL: string): Blob {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Get IPFS gateway URL
 */
export function getIPFSUrl(cid: string, gateway: string = 'ipfs.io'): string {
  return `https://${gateway}/ipfs/${cid}`;
}

/**
 * Mock upload for development (no API keys needed)
 */
export async function mockIPFSUpload(): Promise<{ imageCid: string; thumbnailCid: string }> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Return mock CIDs
  const mockCid = `Qm${Math.random().toString(36).substring(2, 15)}`;
  return {
    imageCid: mockCid,
    thumbnailCid: mockCid,
  };
}
