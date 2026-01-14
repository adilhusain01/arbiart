/**
 * Device and Photo Metadata Utilities
 */

import { sha256 } from 'js-sha256';

export interface PhotoMetadata {
  // Image data
  imageHash: string;
  ipfsCid: string;
  thumbnailCid: string;
  
  // Device info
  deviceFingerprint: string;
  userAgent: string;
  screenResolution: string;
  platform: string;
  
  // Camera/capture info
  captureTimestamp: number;
  cameraResolution: string;
  
  // Location (optional, hashed)
  locationHash: string;
  
  // ZK data
  zkCommitment: string;
  zkSecret: string; // Store securely, never send to chain!
  isEncrypted: boolean;
}

/**
 * Get device fingerprint (hashed for privacy)
 */
export function getDeviceFingerprint(): string {
  const components = [
    navigator.userAgent,
    navigator.language,
    screen.colorDepth,
    screen.width,
    screen.height,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || '',
    (navigator as any).deviceMemory || '',
  ].join('|');
  
  return '0x' + sha256(components);
}

/**
 * Get device information
 */
export function getDeviceInfo() {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    screenResolution: `${screen.width}x${screen.height}`,
    colorDepth: screen.colorDepth,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cores: navigator.hardwareConcurrency || 'unknown',
    memory: (navigator as any).deviceMemory || 'unknown',
  };
}

/**
 * Get camera resolution from video element
 */
export function getCameraResolution(video: HTMLVideoElement): string {
  return `${video.videoWidth}x${video.videoHeight}`;
}

/**
 * Get geolocation (with permission)
 */
export async function getLocation(): Promise<{
  latitude: number;
  longitude: number;
  accuracy: number;
} | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      () => resolve(null),
      { timeout: 5000 }
    );
  });
}

/**
 * Hash location for privacy
 */
export function hashLocation(
  latitude: number,
  longitude: number,
  salt: string = 'arbipic'
): string {
  const locationString = `${latitude.toFixed(6)},${longitude.toFixed(6)},${salt}`;
  return '0x' + sha256(locationString);
}

/**
 * Get comprehensive photo metadata
 */
export async function collectPhotoMetadata(
  imageDataUrl: string,
  videoElement?: HTMLVideoElement
): Promise<Partial<PhotoMetadata>> {
  const deviceInfo = getDeviceInfo();
  const location = await getLocation();
  
  return {
    deviceFingerprint: getDeviceFingerprint(),
    userAgent: deviceInfo.userAgent,
    screenResolution: deviceInfo.screenResolution,
    platform: deviceInfo.platform,
    captureTimestamp: Date.now(),
    cameraResolution: videoElement 
      ? getCameraResolution(videoElement)
      : 'unknown',
    locationHash: location
      ? hashLocation(location.latitude, location.longitude)
      : '0x' + '0'.repeat(64),
    isEncrypted: false,
  };
}

/**
 * Format metadata for display
 */
export function formatMetadata(metadata: Partial<PhotoMetadata>): Record<string, string> {
  return {
    'Device': metadata.userAgent?.substring(0, 50) + '...' || 'Unknown',
    'Screen': metadata.screenResolution || 'Unknown',
    'Camera': metadata.cameraResolution || 'Unknown',
    'Captured': metadata.captureTimestamp 
      ? new Date(metadata.captureTimestamp).toLocaleString()
      : 'Unknown',
    'Location': metadata.locationHash && metadata.locationHash !== '0x' + '0'.repeat(64)
      ? 'Verified (hashed)'
      : 'Not provided',
    'Encrypted': metadata.isEncrypted ? 'Yes' : 'No',
  };
}

/**
 * Export metadata as JSON
 */
export function exportMetadata(metadata: PhotoMetadata): string {
  return JSON.stringify(metadata, null, 2);
}

/**
 * Validate metadata before submission
 */
export function validateMetadata(metadata: Partial<PhotoMetadata>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (!metadata.imageHash) errors.push('Image hash is required');
  if (!metadata.deviceFingerprint) errors.push('Device fingerprint is required');
  if (!metadata.captureTimestamp) errors.push('Capture timestamp is required');
  if (!metadata.zkCommitment) errors.push('ZK commitment is required');
  
  return {
    valid: errors.length === 0,
    errors,
  };
}
