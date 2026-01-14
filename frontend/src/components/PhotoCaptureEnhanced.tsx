import React, { useRef, useState, useCallback, useEffect } from 'react'
import Webcam from 'react-webcam'
import { sha256 } from 'js-sha256'
import { useAccount, useWaitForTransactionReceipt, useReadContract, useSwitchChain, useChainId } from 'wagmi'
import { VERIFIER_ABI, VERIFIER_ADDRESS } from '../config'
import { Hash, encodeFunctionData } from 'viem'
import { arbitrumSepolia } from 'wagmi/chains'
import { collectDeviceMetadata, hashToBigInt } from '../utils/deviceMetadata'
import { generateZKProof, storeSecretSecurely, retrieveSecret, computeCommitment } from '../utils/zkProof'
import { uploadToPinata } from '../utils/ipfs'
import { 
  generateVerificationUrl, 
  generateTwitterShareUrl, 
  generateVerificationId,
  storeVerificationLocally,
  copyVerificationLink,
  addVerificationWatermark,
  VerificationData
} from '../utils/verification'
import { createSimpleAttestation } from '../utils/eas'

const videoConstraints = {
  width: 1280,
  height: 720,
  facingMode: 'user'
}

interface PhotoData {
  imageSrc: string
  hash: string
  timestamp?: bigint
  txHash?: Hash
  ipfsCid?: string
  zkSecret?: string
  verificationId?: string
  easAttestationId?: string  // EAS attestation UID
  easExplorerUrl?: string    // EAS explorer URL
}

type VerificationStep = 'idle' | 'collecting' | 'uploading' | 'signing' | 'confirming' | 'attesting' | 'complete'

export const PhotoCaptureEnhanced: React.FC = () => {
  const webcamRef = useRef<Webcam>(null)
  const [photo, setPhoto] = useState<PhotoData | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [step, setStep] = useState<VerificationStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [watermarkedImage, setWatermarkedImage] = useState<string | null>(null)
  const [pendingTxHash, setPendingTxHash] = useState<Hash | null>(null)
  const [attestationCreated, setAttestationCreated] = useState(false)
  
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  
  // Watch for transaction confirmation
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ 
    hash: pendingTxHash || undefined 
  })

  const isCorrectNetwork = chainId === arbitrumSepolia.id

  // Read attestation data if photo exists
  const { data: attestation } = useReadContract({
    address: VERIFIER_ADDRESS,
    abi: VERIFIER_ABI,
    functionName: 'getAttestation',
    args: photo?.hash ? [BigInt(`0x${photo.hash}`)] : undefined,
    query: {
      enabled: !!photo?.hash
    }
  })

  // Handle confirmation complete
  useEffect(() => {
    if (isConfirmed && photo && pendingTxHash && address && !attestationCreated) {
      // Mark as created immediately to prevent re-runs
      setAttestationCreated(true)
      
      // Create EAS attestation
      setStep('attesting')
      
      const createAttestation = async () => {
        try {
          // Get stored ZK commitment
          const storedMetadata = localStorage.getItem(`arbipic_metadata_${photo.hash}`)
          const metadata = storedMetadata ? JSON.parse(storedMetadata) : {}
          
          const easResult = await createSimpleAttestation(
            `0x${photo.hash}`,
            Math.floor(Date.now() / 1000),
            address,
            photo.ipfsCid || '',
            metadata.zkCommitment || '0x0'
          )
          
          if (easResult.success && easResult.attestationId) {
            setPhoto(prev => prev ? { 
              ...prev, 
              easAttestationId: easResult.attestationId,
              easExplorerUrl: easResult.explorerUrl 
            } : null)
            console.log('✅ EAS Attestation created:', easResult.attestationId)
            if (easResult.explorerUrl) {
              console.log('🔗 View on EAS Explorer:', easResult.explorerUrl)
            }
            if (easResult.error) {
              console.warn('⚠️', easResult.error)
            }
          }
        } catch (err) {
          console.warn('EAS attestation failed (non-critical):', err)
        }
        
        setStep('complete')
        
        // Store verification data locally
        const verificationData: VerificationData = {
          photoHash: photo.hash,
          txHash: pendingTxHash,
          timestamp: Math.floor(Date.now() / 1000),
          owner: address,
          ipfsCid: photo.ipfsCid
        }
        storeVerificationLocally(verificationData)
        
        // Generate watermarked image
        addVerificationWatermark(photo.imageSrc, photo.hash)
          .then(setWatermarkedImage)
          .catch(console.error)
      }
      
      createAttestation()
    }
  }, [isConfirmed, photo, pendingTxHash, address, attestationCreated])

  const capture = useCallback(() => {
    setIsCapturing(true)
    setError(null)
    const imageSrc = webcamRef.current?.getScreenshot()
    
    if (imageSrc) {
      // Remove data:image/jpeg;base64, prefix
      const base64Data = imageSrc.split(',')[1]
      const photoHash = sha256(base64Data)
      
      setPhoto({
        imageSrc,
        hash: photoHash,
        verificationId: generateVerificationId(photoHash)
      })
    }
    setIsCapturing(false)
  }, [webcamRef])

  const verifyWithMetadata = useCallback(async () => {
    if (!photo || !isConnected || !address) return
    setError(null)

    // Check if we're on the correct network
    if (!isCorrectNetwork) {
      try {
        await switchChain({ chainId: arbitrumSepolia.id })
      } catch (error) {
        console.error('Failed to switch network:', error)
        setError('Failed to switch network. Please switch manually.')
        return
      }
    }

    try {
      // Step 1: Collect device metadata (stored off-chain)
      setStep('collecting')
      const metadata = await collectDeviceMetadata(
        { width: 1280, height: 720 },
        photo.hash // Use photo hash as location salt
      )

      // Step 2: Generate ZK proof
      const zkProof = generateZKProof(`0x${photo.hash}`)
      storeSecretSecurely(photo.hash, zkProof.secret)
      setPhoto(prev => prev ? { ...prev, zkSecret: zkProof.secret } : null)

      // Step 3: Upload to IPFS (off-chain storage)
      setStep('uploading')
      let ipfsCid = ''
      
      try {
        // Convert base64 to blob
        const base64Data = photo.imageSrc.split(',')[1]
        const byteCharacters = atob(base64Data)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        const imageBlob = new Blob([byteArray], { type: 'image/jpeg' })

        const ipfsResult = await uploadToPinata(imageBlob, {
          photoHash: photo.hash,
          timestamp: metadata.timestamp,
          deviceFingerprint: metadata.fingerprint.slice(0, 16),
        })
        ipfsCid = ipfsResult.imageCid
        setPhoto(prev => prev ? { ...prev, ipfsCid } : null)
        
        // Store extended metadata off-chain (localStorage + IPFS metadata)
        const offChainMetadata = {
          photoHash: photo.hash,
          ipfsCid,
          thumbnailCid: ipfsResult.thumbnailCid,
          deviceFingerprint: metadata.fingerprint,
          captureTimestamp: metadata.timestamp,
          cameraResolution: metadata.resolution,
          locationHash: metadata.locationHash,
          zkCommitment: zkProof.commitment,
          createdAt: Date.now()
        }
        localStorage.setItem(`arbipic_metadata_${photo.hash}`, JSON.stringify(offChainMetadata))
        console.log('Off-chain metadata stored:', offChainMetadata)
      } catch (ipfsError) {
        console.warn('IPFS upload failed, continuing without:', ipfsError)
        // Continue without IPFS - metadata still stored locally
      }

      // Step 4: Submit MINIMAL data to blockchain (just hash + zkCommitment)
      setStep('signing')
      
      // Only 2 arguments now - photoHash and zkCommitment
      const photoHashBigInt = hashToBigInt(photo.hash)
      const zkCommitmentBigInt = BigInt(zkProof.commitment)
      
      // Debug logging
      console.log('Contract call args (simplified):', {
        photoHash: photoHashBigInt.toString(),
        zkCommitment: zkCommitmentBigInt.toString()
      })
      
      // Encode the function call data manually
      const callData = encodeFunctionData({
        abi: VERIFIER_ABI,
        functionName: 'verifyPhoto',
        args: [photoHashBigInt, zkCommitmentBigInt],
      })
      
      console.log('Sending raw transaction via window.ethereum to bypass simulation...')
      console.log('Calldata:', callData)
      
      // Use window.ethereum.request directly to bypass wagmi/viem simulation
      // This sends the transaction directly without eth_call simulation
      const ethereum = (window as any).ethereum
      if (!ethereum) {
        throw new Error('MetaMask not found')
      }
      
      // Get current gas price for reliability
      const gasPrice = await ethereum.request({ method: 'eth_gasPrice' })
      
      const txHash = await ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: address,
          to: VERIFIER_ADDRESS,
          data: callData,
          gas: '0x7A120', // 500000 in hex - increased for reliability
          gasPrice: gasPrice // Use current gas price
        }],
      }) as Hash
      
      console.log('Transaction sent:', txHash)
      setPendingTxHash(txHash)
      setPhoto(prev => prev ? { ...prev, txHash } : null)

      setStep('confirming')
    } catch (err: any) {
      console.error('Verification failed:', err)
      setError(err.message || 'Verification failed')
      setStep('idle')
    }
  }, [photo, isConnected, isCorrectNetwork, switchChain, address])

  // Simple verification (minimal - just hash with zero zkCommitment)
  const verifySimple = useCallback(async () => {
    if (!photo || !isConnected) return
    setError(null)

    if (!isCorrectNetwork) {
      try {
        await switchChain({ chainId: arbitrumSepolia.id })
      } catch (error) {
        setError('Failed to switch network')
        return
      }
    }

    setStep('signing')
    
    try {
      // Generate a simple ZK commitment for basic verification
      const zkProof = generateZKProof(`0x${photo.hash}`)
      storeSecretSecurely(photo.hash, zkProof.secret)
      
      const photoHashBigInt = hashToBigInt(photo.hash)
      const zkCommitmentBigInt = BigInt(zkProof.commitment)
      
      // Encode and send via window.ethereum to bypass simulation
      const callData = encodeFunctionData({
        abi: VERIFIER_ABI,
        functionName: 'verifyPhoto',
        args: [photoHashBigInt, zkCommitmentBigInt],
      })
      
      const ethereum = (window as any).ethereum
      if (!ethereum) {
        throw new Error('MetaMask not found')
      }
      
      const txHash = await ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: address,
          to: VERIFIER_ADDRESS,
          data: callData,
          gas: '0x3D090', // 250000 in hex
        }],
      }) as Hash
      
      console.log('Transaction sent:', txHash)
      setPendingTxHash(txHash)
      setPhoto(prev => prev ? { ...prev, txHash } : null)
      setStep('confirming')
    } catch (err: any) {
      console.error('Verification failed:', err)
      setError(err.message || 'Verification failed')
      setStep('idle')
    }
  }, [photo, isConnected, isCorrectNetwork, switchChain, address])

  const shareOnTwitter = useCallback(() => {
    if (!photo || !pendingTxHash || !address) return
    
    const verificationData: VerificationData = {
      photoHash: photo.hash,
      txHash: pendingTxHash,
      timestamp: Math.floor(Date.now() / 1000),
      owner: address,
      ipfsCid: photo.ipfsCid
    }
    
    const twitterUrl = generateTwitterShareUrl(verificationData)
    window.open(twitterUrl, '_blank')
  }, [photo, pendingTxHash, address])

  const copyLink = useCallback(async () => {
    if (!photo) return
    const success = await copyVerificationLink(photo.hash)
    if (success) {
      alert('Verification link copied to clipboard!')
    }
  }, [photo])

  const downloadWatermarked = useCallback(() => {
    if (!watermarkedImage) return
    const link = document.createElement('a')
    link.href = watermarkedImage
    link.download = `arbipic-verified-${photo?.verificationId}.jpg`
    link.click()
  }, [watermarkedImage, photo])

  // Download original (non-watermarked) - this will hash correctly when re-uploaded
  const downloadOriginal = useCallback(() => {
    if (!photo?.imageSrc) return
    const link = document.createElement('a')
    link.href = photo.imageSrc
    // Include full hash in filename so verification works even after rename
    link.download = `arbipic-original-${photo.hash}.jpg`
    link.click()
  }, [photo])

  // Prove ownership using ZK proof
  const [zkProofResult, setZkProofResult] = useState<'idle' | 'proving' | 'success' | 'failed'>('idle')
  
  const proveOwnership = useCallback(async () => {
    if (!photo) return
    setZkProofResult('proving')
    
    try {
      // Retrieve stored secret
      const secret = retrieveSecret(photo.hash)
      if (!secret) {
        alert('❌ ZK secret not found locally. You can only prove ownership from the device that captured the photo.')
        setZkProofResult('failed')
        return
      }
      
      // Verify locally first
      const secretBigInt = BigInt(secret)
      // Compute locally to validate before on-chain call
      const _commitment = computeCommitment(`0x${photo.hash}`, secretBigInt)
      console.log('Local commitment:', _commitment)
      
      // Call the on-chain verification
      const ethereum = (window as any).ethereum
      if (!ethereum) {
        throw new Error('MetaMask not found')
      }
      
      // Encode verifyZkProof call
      const callData = encodeFunctionData({
        abi: VERIFIER_ABI,
        functionName: 'verifyZkProof',
        args: [BigInt(`0x${photo.hash}`), secretBigInt],
      })
      
      // Call (not send) to verify without gas
      const result = await ethereum.request({
        method: 'eth_call',
        params: [{
          to: VERIFIER_ADDRESS,
          data: callData,
        }, 'latest'],
      })
      
      // Result is true if ownership is proven
      const isValid = result !== '0x0000000000000000000000000000000000000000000000000000000000000000'
      
      if (isValid) {
        setZkProofResult('success')
        alert('✅ ZK Proof Verified! You have proven ownership of this photo without revealing the image.')
      } else {
        setZkProofResult('failed')
        alert('❌ ZK Proof Failed. The secret does not match the on-chain commitment.')
      }
    } catch (err) {
      console.error('ZK proof error:', err)
      setZkProofResult('failed')
      alert('❌ ZK Proof Failed: ' + (err as Error).message)
    }
  }, [photo])

  const reset = () => {
    setPhoto(null)
    setStep('idle')
    setError(null)
    setWatermarkedImage(null)
    setPendingTxHash(null)
    setAttestationCreated(false)
  }

  const getStepMessage = () => {
    switch (step) {
      case 'collecting': return '📊 Collecting device metadata...'
      case 'uploading': return '☁️ Uploading to IPFS...'
      case 'signing': return '✍️ Please sign the transaction...'
      case 'confirming': return '⏳ Confirming on blockchain...'
      case 'attesting': return '📜 Creating EAS attestation...'
      case 'complete': return '✅ Photo verified!'
      default: return null
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-6">
          <h2 className="text-3xl font-bold text-white text-center">
            📸 ArbiPic Verifier
          </h2>
          <p className="text-white/90 text-center mt-2">
            Capture, verify & share authentic photos on Arbitrum
          </p>
        </div>

        <div className="p-6">
          {!photo ? (
            <div className="space-y-4">
              <div className="relative rounded-xl overflow-hidden shadow-lg">
                <Webcam
                  audio={false}
                  height={720}
                  ref={webcamRef}
                  screenshotFormat="image/jpeg"
                  width={1280}
                  videoConstraints={videoConstraints}
                  className="w-full"
                />
              </div>
              
              <button
                onClick={capture}
                disabled={isCapturing || !isConnected}
                className="w-full py-4 px-6 bg-gradient-to-r from-blue-500 to-purple-500 text-white font-semibold rounded-xl shadow-lg hover:from-blue-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105"
              >
                {isConnected ? '📸 Capture Photo' : '🔌 Connect Wallet First'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Image Display */}
              <div className="rounded-xl overflow-hidden shadow-lg relative">
                <img 
                  src={watermarkedImage || photo.imageSrc} 
                  alt="Captured" 
                  className="w-full" 
                />
                {step === 'complete' && (
                  <div className="absolute top-4 right-4 bg-green-500 text-white px-3 py-1 rounded-full text-sm font-semibold shadow-lg">
                    ✓ Verified
                  </div>
                )}
              </div>

              {/* Status Message */}
              {step !== 'idle' && step !== 'complete' && (
                <div className="bg-blue-50 border-2 border-blue-400 rounded-xl p-4 text-center animate-pulse">
                  <p className="text-blue-700 font-medium">{getStepMessage()}</p>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="bg-red-50 border-2 border-red-400 rounded-xl p-4 text-center">
                  <p className="text-red-700 font-medium">❌ {error}</p>
                </div>
              )}

              {/* Photo Info */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 font-medium">Photo Hash:</span>
                  <code className="text-xs bg-white px-3 py-1 rounded-lg shadow-sm font-mono">
                    {photo.hash.slice(0, 16)}...
                  </code>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-gray-600 font-medium">Verification ID:</span>
                  <code className="text-xs bg-purple-100 text-purple-700 px-3 py-1 rounded-lg font-mono">
                    #{photo.verificationId}
                  </code>
                </div>
                
                {attestation && attestation[0] > 0n && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600 font-medium">Verified At:</span>
                    <span className="text-sm text-green-600 font-semibold">
                      {new Date(Number(attestation[0]) * 1000).toLocaleString()}
                    </span>
                  </div>
                )}

                {pendingTxHash && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600 font-medium">Tx Hash:</span>
                    <a
                      href={`https://sepolia.arbiscan.io/tx/${pendingTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      {pendingTxHash.slice(0, 16)}...
                    </a>
                  </div>
                )}

                {photo.ipfsCid && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600 font-medium">IPFS:</span>
                    <a
                      href={`https://gateway.pinata.cloud/ipfs/${photo.ipfsCid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      {photo.ipfsCid.slice(0, 16)}...
                    </a>
                  </div>
                )}

                {photo.easAttestationId && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600 font-medium">EAS:</span>
                    {photo.easExplorerUrl ? (
                      <a 
                        href={photo.easExplorerUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-xs bg-purple-100 text-purple-700 px-3 py-1 rounded-lg font-mono hover:bg-purple-200 transition-colors"
                      >
                        📜 View Attestation ↗
                      </a>
                    ) : (
                      <span className="text-xs bg-purple-100 text-purple-700 px-3 py-1 rounded-lg font-mono">
                        📜 {photo.easAttestationId.startsWith('local-') ? 'Local' : 'On-chain'}
                      </span>
                    )}
                  </div>
                )}

                {photo.zkSecret && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600 font-medium">ZK Proof:</span>
                    <span className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-lg font-mono">
                      🔐 Secret stored locally
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              {step !== 'complete' ? (
                <div className="flex gap-3">
                  <button
                    onClick={verifyWithMetadata}
                    disabled={isConfirming || !isConnected || (attestation && attestation[0] > 0n) || step !== 'idle'}
                    className="flex-1 py-3 px-6 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold rounded-xl shadow-lg hover:from-green-600 hover:to-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {(attestation && attestation[0] > 0n) ? '✅ Already Verified' :
                     !isCorrectNetwork ? '🔄 Switch Network' :
                     '🔐 Verify with Metadata'}
                  </button>

                  <button
                    onClick={verifySimple}
                    disabled={isConfirming || !isConnected || (attestation && attestation[0] > 0n) || step !== 'idle'}
                    className="py-3 px-6 bg-gray-600 text-white font-semibold rounded-xl shadow-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    title="Quick verify without metadata"
                  >
                    ⚡ Quick
                  </button>

                  <button
                    onClick={reset}
                    className="py-3 px-6 bg-gray-500 text-white font-semibold rounded-xl shadow-lg hover:bg-gray-600 transition-all"
                  >
                    🔄
                  </button>
                </div>
              ) : (
                /* Sharing Options */
                <div className="space-y-3">
                  <div className="bg-green-50 border-2 border-green-500 rounded-xl p-4 text-center">
                    <p className="text-green-700 font-semibold text-lg">
                      ✨ Photo successfully verified on Arbitrum!
                    </p>
                    <p className="text-green-600 text-sm mt-1">
                      Share it on Twitter to prove it's authentic
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={shareOnTwitter}
                      className="flex-1 py-3 px-6 bg-[#1DA1F2] text-white font-semibold rounded-xl shadow-lg hover:bg-[#1a8cd8] transition-all flex items-center justify-center gap-2"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                      Share on X/Twitter
                    </button>

                    <button
                      onClick={copyLink}
                      className="py-3 px-6 bg-purple-500 text-white font-semibold rounded-xl shadow-lg hover:bg-purple-600 transition-all"
                      title="Copy verification link"
                    >
                      🔗 Copy Link
                    </button>

                    {watermarkedImage && (
                      <button
                        onClick={downloadWatermarked}
                        className="py-3 px-6 bg-blue-500 text-white font-semibold rounded-xl shadow-lg hover:bg-blue-600 transition-all"
                        title="Download with verification badge (for sharing)"
                      >
                        🏷️ Badge
                      </button>
                    )}

                    <button
                      onClick={downloadOriginal}
                      className="py-3 px-6 bg-green-500 text-white font-semibold rounded-xl shadow-lg hover:bg-green-600 transition-all"
                      title="Download original (verifiable by re-upload)"
                    >
                      💾 Original
                    </button>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={reset}
                      className="flex-1 py-3 px-6 bg-gray-500 text-white font-semibold rounded-xl shadow-lg hover:bg-gray-600 transition-all"
                    >
                      📸 Capture New Photo
                    </button>
                    
                    <button
                      onClick={proveOwnership}
                      disabled={zkProofResult === 'proving'}
                      className={`py-3 px-6 font-semibold rounded-xl shadow-lg transition-all ${
                        zkProofResult === 'success' 
                          ? 'bg-green-500 text-white' 
                          : zkProofResult === 'failed'
                          ? 'bg-red-500 text-white'
                          : 'bg-amber-500 text-white hover:bg-amber-600'
                      }`}
                      title="Prove you own this photo without revealing it"
                    >
                      {zkProofResult === 'proving' ? '⏳...' : 
                       zkProofResult === 'success' ? '✅ Proven' :
                       zkProofResult === 'failed' ? '❌ Failed' :
                       '🔐 Prove Ownership'}
                    </button>
                  </div>

                  {/* Verification URL Display */}
                  <div className="bg-gray-100 rounded-xl p-3 text-center">
                    <p className="text-xs text-gray-500 mb-1">Verification Link:</p>
                    <code className="text-sm text-purple-600 font-mono">
                      {generateVerificationUrl(photo.hash)}
                    </code>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Connection Warning */}
          {!isConnected && (
            <div className="mt-4 bg-yellow-50 border-2 border-yellow-400 rounded-xl p-4 text-center">
              <p className="text-yellow-700 font-medium">
                ⚠️ Please connect your wallet to capture and verify photos
              </p>
            </div>
          )}

          {/* Network Warning */}
          {isConnected && !isCorrectNetwork && (
            <div className="mt-4 bg-orange-50 border-2 border-orange-400 rounded-xl p-4 text-center">
              <p className="text-orange-700 font-medium">
                🔄 Wrong Network! Please switch to Arbitrum Sepolia
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
