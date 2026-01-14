import React, { useState, useCallback, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { sha256 } from 'js-sha256'
import { useReadContract } from 'wagmi'
import { VERIFIER_ABI, VERIFIER_ADDRESS, PINATA_GATEWAY } from '../config'
import { generateVerificationId, generateContractUrl, getLocalVerification } from '../utils/verification'
import { retrieveSecret } from '../utils/zkProof'
import { encodeFunctionData } from 'viem'

interface PhotoMetadata {
  ipfsCid: string
  verifiedAt: bigint
  owner: string
  isEncrypted: boolean
}

export const VerifyPage: React.FC = () => {
  const { verificationId } = useParams<{ verificationId?: string }>()
  
  const [inputHash, setInputHash] = useState('')
  const [searchHash, setSearchHash] = useState<string | null>(null)
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  
  // ZK Proof state
  const [zkProofStatus, setZkProofStatus] = useState<'idle' | 'proving' | 'success' | 'failed'>('idle')
  const [hasSecret, setHasSecret] = useState(false)

  // Try to get full hash from URL param or local storage
  useEffect(() => {
    if (verificationId) {
      // Check local storage for full hash
      const localData = getLocalVerification(verificationId)
      if (localData) {
        setSearchHash(localData.photoHash)
      } else {
        // Just use the ID - we'll need full hash for on-chain lookup
        setInputHash(verificationId)
      }
    }
  }, [verificationId])

  // Check if user has the secret for this photo (means they're the owner)
  useEffect(() => {
    if (searchHash) {
      const secret = retrieveSecret(searchHash)
      setHasSecret(!!secret)
      setZkProofStatus('idle')
    }
  }, [searchHash])

  // Prove ownership using ZK proof
  const proveOwnership = useCallback(async () => {
    if (!searchHash) return
    setZkProofStatus('proving')
    
    try {
      const secret = retrieveSecret(searchHash)
      if (!secret) {
        setZkProofStatus('failed')
        return
      }
      
      const secretBigInt = BigInt(secret)
      
      // Encode verifyZkProof call
      const callData = encodeFunctionData({
        abi: VERIFIER_ABI,
        functionName: 'verifyZkProof',
        args: [BigInt(`0x${searchHash}`), secretBigInt],
      })
      
      const ethereum = (window as any).ethereum
      if (!ethereum) {
        throw new Error('MetaMask not found')
      }
      
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
      
      setZkProofStatus(isValid ? 'success' : 'failed')
    } catch (err) {
      console.error('ZK proof error:', err)
      setZkProofStatus('failed')
    }
  }, [searchHash])

  // Read on-chain verification status
  const { data: isVerified, isLoading: isCheckingVerification } = useReadContract({
    address: VERIFIER_ADDRESS,
    abi: VERIFIER_ABI,
    functionName: 'isVerified',
    args: searchHash ? [BigInt(`0x${searchHash}`)] : undefined,
    query: {
      enabled: !!searchHash
    }
  })

  // Read attestation timestamp
  const { data: attestation } = useReadContract({
    address: VERIFIER_ADDRESS,
    abi: VERIFIER_ABI,
    functionName: 'getAttestation',
    args: searchHash ? [BigInt(`0x${searchHash}`)] : undefined,
    query: {
      enabled: !!searchHash
    }
  })

  // Read full metadata (using getAttestation)
  const { data: metadata } = useReadContract({
    address: VERIFIER_ADDRESS,
    abi: VERIFIER_ABI,
    functionName: 'getAttestation',
    args: searchHash ? [BigInt(`0x${searchHash}`)] : undefined,
    query: {
      enabled: !!searchHash
    }
  }) as { data: [bigint, `0x${string}`, bigint] | undefined }

  const handleImageUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      setUploadedImage(dataUrl)
      
      // Try to extract FULL hash from original image filename (e.g., "arbipic-original-abc123...xyz.jpg")
      const originalMatch = file.name.match(/arbipic-original-([a-f0-9]{64})/i)
      if (originalMatch) {
        const fullHash = originalMatch[1]
        console.log('Found full hash from original filename:', fullHash)
        setSearchHash(fullHash)
        setInputHash(fullHash)
        return
      }
      
      // Try to extract verification ID from watermarked filename (e.g., "arbipic-verified-7362dd92de99.jpg")
      const verifiedMatch = file.name.match(/arbipic-verified-([a-f0-9]+)/i)
      if (verifiedMatch) {
        const verificationId = verifiedMatch[1]
        // Look up the full hash from localStorage
        const localData = getLocalVerification(verificationId)
        if (localData) {
          console.log('Found original hash from verification ID:', localData.photoHash)
          setSearchHash(localData.photoHash)
          setInputHash(localData.photoHash)
          return
        }
      }
      
      // Compute hash of uploaded image - this will match for ORIGINAL downloads
      const base64Data = dataUrl.split(',')[1]
      const hash = sha256(base64Data)
      console.log('Using computed hash:', hash)
      setSearchHash(hash)
      setInputHash(hash)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleHashSearch = useCallback(() => {
    if (!inputHash) return
    setIsSearching(true)
    
    // Clean the input
    let cleanHash = inputHash.startsWith('0x') ? inputHash.slice(2) : inputHash
    
    // If it's a short verification ID (12 chars or less), try to look up full hash
    if (cleanHash.length <= 12) {
      const localData = getLocalVerification(cleanHash)
      if (localData) {
        console.log('Found full hash from verification ID:', localData.photoHash)
        cleanHash = localData.photoHash
      } else {
        console.log('Verification ID not found in local storage:', cleanHash)
      }
    }
    
    setSearchHash(cleanHash)
    
    setTimeout(() => setIsSearching(false), 1000)
  }, [inputHash])

  const handlePaste = useCallback(async () => {
    try {
      const clipboardItems = await navigator.clipboard.read()
      for (const item of clipboardItems) {
        // Check for image
        if (item.types.includes('image/png') || item.types.includes('image/jpeg')) {
          const blob = await item.getType(item.types.find(t => t.startsWith('image/'))!)
          const reader = new FileReader()
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string
            setUploadedImage(dataUrl)
            const base64Data = dataUrl.split(',')[1]
            const hash = sha256(base64Data)
            setSearchHash(hash)
            setInputHash(hash)
          }
          reader.readAsDataURL(blob)
          return
        }
        // Check for text (hash)
        if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain')
          const text = await blob.text()
          if (text.length === 64 || (text.startsWith('0x') && text.length === 66)) {
            setInputHash(text)
            handleHashSearch()
          }
        }
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err)
    }
  }, [handleHashSearch])

  // Parse attestation data (now returns [timestamp, owner, zkCommitment])
  const parsedMetadata: PhotoMetadata | null = metadata ? {
    ipfsCid: '', // Not stored on-chain anymore, will get from localStorage
    verifiedAt: metadata[0],
    owner: metadata[1] as string,
    isEncrypted: false // Not stored on-chain
  } : null

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 py-12">
      <div className="max-w-4xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            🔍 Verify Photo Authenticity
          </h1>
          <p className="text-gray-600 mt-2">
            Check if a photo was verified on the Arbitrum blockchain
          </p>
        </div>

        {/* Search Box */}
        <div className="bg-white rounded-2xl shadow-xl p-6 mb-8">
          <div className="space-y-4">
            {/* Upload or Paste Image */}
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-purple-400 transition-colors">
              {uploadedImage ? (
                <div className="relative">
                  <img 
                    src={uploadedImage} 
                    alt="Uploaded for verification" 
                    className="max-h-64 mx-auto rounded-lg shadow-md"
                  />
                  <button
                    onClick={() => { setUploadedImage(null); setSearchHash(null); }}
                    className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-red-600"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                    id="image-upload"
                  />
                  <label 
                    htmlFor="image-upload"
                    className="cursor-pointer"
                  >
                    <div className="text-4xl mb-2">🖼️</div>
                    <p className="text-gray-600 font-medium">
                      Drop an image here or click to upload
                    </p>
                    <p className="text-gray-400 text-sm mt-1">
                      We'll compute its hash and check the blockchain
                    </p>
                  </label>
                  
                  <div className="mt-4">
                    <button
                      onClick={handlePaste}
                      className="px-4 py-2 bg-purple-100 text-purple-600 rounded-lg hover:bg-purple-200 transition-colors"
                    >
                      📋 Paste from Clipboard
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Or enter hash manually */}
            <div className="flex items-center gap-4">
              <div className="flex-1 h-px bg-gray-200"></div>
              <span className="text-gray-400 text-sm">OR enter hash directly</span>
              <div className="flex-1 h-px bg-gray-200"></div>
            </div>

            <div className="flex gap-3">
              <input
                type="text"
                value={inputHash}
                onChange={(e) => setInputHash(e.target.value)}
                placeholder="Enter photo hash (64 characters) or verification ID"
                className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-purple-400 focus:outline-none font-mono text-sm"
              />
              <button
                onClick={handleHashSearch}
                disabled={!inputHash || isSearching}
                className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-purple-600 disabled:opacity-50 transition-all"
              >
                {isSearching ? '🔄' : '🔍'} Verify
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        {searchHash && (
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            {/* Clear search button */}
            <div className="flex justify-end p-2 bg-gray-50 border-b">
              <button
                onClick={() => {
                  setSearchHash(null)
                  setInputHash('')
                  setUploadedImage(null)
                }}
                className="px-3 py-1 text-sm text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                ✕ New Search
              </button>
            </div>
            
            {isCheckingVerification ? (
              <div className="p-12 text-center">
                <div className="text-4xl mb-4 animate-bounce">🔍</div>
                <p className="text-gray-600">Checking blockchain...</p>
              </div>
            ) : isVerified ? (
              <>
                {/* Verified Banner */}
                <div className="bg-gradient-to-r from-green-500 to-emerald-500 p-6 text-white text-center">
                  <div className="text-5xl mb-2">✅</div>
                  <h2 className="text-2xl font-bold">Photo is Verified!</h2>
                  <p className="text-white/80 mt-1">
                    This photo was captured and verified on the Arbitrum blockchain
                  </p>
                </div>

                {/* Verification Details */}
                <div className="p-6 space-y-4">
                  {/* IPFS Image Preview */}
                  {parsedMetadata?.ipfsCid && (
                    <div className="rounded-xl overflow-hidden shadow-lg">
                      <img 
                        src={`${PINATA_GATEWAY}${parsedMetadata.ipfsCid}`}
                        alt="Verified photo"
                        className="w-full"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    </div>
                  )}

                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 font-medium">Photo Hash:</span>
                      <code className="text-xs bg-white px-3 py-1 rounded-lg shadow-sm font-mono">
                        {searchHash.slice(0, 16)}...{searchHash.slice(-8)}
                      </code>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 font-medium">Verification ID:</span>
                      <code className="text-sm bg-purple-100 text-purple-700 px-3 py-1 rounded-lg font-mono">
                        #{generateVerificationId(searchHash)}
                      </code>
                    </div>

                    {attestation && attestation[0] > 0n && (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600 font-medium">Verified On:</span>
                        <span className="text-green-600 font-semibold">
                          {new Date(Number(attestation[0]) * 1000).toLocaleString()}
                        </span>
                      </div>
                    )}

                    {parsedMetadata?.owner && (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600 font-medium">Owner:</span>
                        <a 
                          href={`https://sepolia.arbiscan.io/address/${parsedMetadata.owner}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline font-mono text-sm"
                        >
                          {parsedMetadata.owner.slice(0, 8)}...{parsedMetadata.owner.slice(-6)}
                        </a>
                      </div>
                    )}

                    {parsedMetadata?.ipfsCid && (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600 font-medium">IPFS:</span>
                        <a 
                          href={`${PINATA_GATEWAY}${parsedMetadata.ipfsCid}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline font-mono text-sm"
                        >
                          {parsedMetadata.ipfsCid.slice(0, 12)}...
                        </a>
                      </div>
                    )}
                  </div>

                  {/* ZK Proof of Ownership Section */}
                  <div className={`rounded-xl p-4 ${
                    zkProofStatus === 'success' ? 'bg-green-50 border-2 border-green-500' :
                    zkProofStatus === 'failed' ? 'bg-red-50 border-2 border-red-500' :
                    hasSecret ? 'bg-amber-50 border-2 border-amber-500' :
                    'bg-gray-50 border-2 border-gray-200'
                  }`}>
                    <p className={`font-medium text-center mb-3 ${
                      zkProofStatus === 'success' ? 'text-green-700' :
                      zkProofStatus === 'failed' ? 'text-red-700' :
                      hasSecret ? 'text-amber-700' :
                      'text-gray-600'
                    }`}>
                      🔐 Zero-Knowledge Ownership Proof
                    </p>
                    
                    {zkProofStatus === 'success' ? (
                      <div className="text-center">
                        <div className="text-4xl mb-2">✅</div>
                        <p className="text-green-700 font-semibold">Ownership Proven!</p>
                        <p className="text-green-600 text-sm mt-1">
                          The current user has cryptographically proven they own this photo.
                        </p>
                      </div>
                    ) : zkProofStatus === 'failed' ? (
                      <div className="text-center">
                        <div className="text-4xl mb-2">❌</div>
                        <p className="text-red-700 font-semibold">Proof Failed</p>
                        <p className="text-red-600 text-sm mt-1">
                          Could not verify ownership. Secret may be incorrect.
                        </p>
                      </div>
                    ) : hasSecret ? (
                      <div className="text-center">
                        <p className="text-amber-700 text-sm mb-3">
                          You have the secret key for this photo. Click below to prove ownership without revealing the image.
                        </p>
                        <button
                          onClick={proveOwnership}
                          disabled={zkProofStatus === 'proving'}
                          className="px-6 py-2 bg-amber-500 text-white font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-all"
                        >
                          {zkProofStatus === 'proving' ? '⏳ Proving...' : '🔐 Prove I Own This Photo'}
                        </button>
                      </div>
                    ) : (
                      <div className="text-center">
                        <p className="text-gray-500 text-sm">
                          Only the original photographer can prove ownership using their secret key.
                        </p>
                        <p className="text-gray-400 text-xs mt-2">
                          If you're the owner, open this page on the device where you captured the photo.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Blockchain Proof Link */}
                  <div className="bg-blue-50 rounded-xl p-4">
                    <p className="text-blue-700 font-medium text-center mb-2">
                      🔗 Blockchain Proof
                    </p>
                    <a
                      href={generateContractUrl()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center text-blue-600 hover:underline text-sm"
                    >
                      View Contract on Arbiscan →
                    </a>
                  </div>
                </div>
              </>
            ) : (
              /* Not Verified */
              <div className="p-12 text-center">
                <div className="text-5xl mb-4">❌</div>
                <h2 className="text-2xl font-bold text-red-600">Not Verified</h2>
                <p className="text-gray-600 mt-2">
                  This photo was not found on the Arbitrum blockchain.
                </p>
                <p className="text-gray-500 text-sm mt-4">
                  It may be AI-generated or hasn't been verified through ArbiPic yet.
                </p>
              </div>
            )}
          </div>
        )}

        {/* How it works */}
        {!searchHash && (
          <div className="bg-white rounded-2xl shadow-xl p-6 mt-8">
            <h3 className="text-xl font-bold text-gray-800 mb-4 text-center">
              How ArbiPic Verification Works
            </h3>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="text-center p-4">
                <div className="text-3xl mb-2">📸</div>
                <h4 className="font-semibold text-gray-700">1. Capture</h4>
                <p className="text-gray-500 text-sm">
                  User takes a photo with ArbiPic, which collects device metadata
                </p>
              </div>
              <div className="text-center p-4">
                <div className="text-3xl mb-2">⛓️</div>
                <h4 className="font-semibold text-gray-700">2. Verify</h4>
                <p className="text-gray-500 text-sm">
                  Photo hash & metadata stored on Arbitrum blockchain (immutable proof)
                </p>
              </div>
              <div className="text-center p-4">
                <div className="text-3xl mb-2">✅</div>
                <h4 className="font-semibold text-gray-700">3. Check</h4>
                <p className="text-gray-500 text-sm">
                  Anyone can verify by uploading the image or using the verification link
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-8 text-gray-500 text-sm">
          <p>Powered by <span className="font-semibold">Arbitrum Stylus</span> • Fighting AI fakes with blockchain</p>
        </div>
      </div>
    </div>
  )
}
