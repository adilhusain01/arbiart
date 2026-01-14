// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PhotoVerifierSolidity
 * @dev Solidity equivalent of the Stylus Verifier contract for gas benchmarking
 * 
 * This contract is used to compare gas costs between Solidity and Stylus (Rust/WASM)
 * implementations of the same photo verification logic.
 */
contract PhotoVerifierSolidity {
    struct PhotoAttestation {
        uint256 verifiedAt;      // Block timestamp when verified
        address owner;           // Photo owner address
        uint256 zkCommitment;    // ZK commitment for ownership proof
    }

    // Photo attestations: photoHash => attestation
    mapping(uint256 => PhotoAttestation) public attestations;
    
    // Owner photo count for tracking
    mapping(address => uint256) public ownerPhotoCount;
    
    // Contract owner
    address public owner;
    
    // Total photos verified
    uint256 public photoCount;

    constructor() {
        owner = msg.sender;
        photoCount = 0;
    }

    /**
     * @dev Verify a photo - minimal on-chain storage
     * @param photoHash The SHA256 hash of the photo
     * @param zkCommitment The ZK commitment for ownership proof
     * @return timestamp The block timestamp when verified
     */
    function verifyPhoto(uint256 photoHash, uint256 zkCommitment) external returns (uint256) {
        uint256 timestamp = block.timestamp;
        
        // Store attestation
        attestations[photoHash] = PhotoAttestation({
            verifiedAt: timestamp,
            owner: msg.sender,
            zkCommitment: zkCommitment
        });
        
        // Track owner's photo count
        ownerPhotoCount[msg.sender]++;
        
        // Increment total counter
        photoCount++;
        
        return timestamp;
    }

    /**
     * @dev Get attestation for a photo
     */
    function getAttestation(uint256 photoHash) external view returns (uint256, address, uint256) {
        PhotoAttestation storage att = attestations[photoHash];
        return (att.verifiedAt, att.owner, att.zkCommitment);
    }

    /**
     * @dev Verify ZK proof of ownership
     */
    function verifyZkProof(uint256 photoHash, uint256 secret) external view returns (bool) {
        PhotoAttestation storage att = attestations[photoHash];
        uint256 computed = computeCommitment(photoHash, secret);
        return computed == att.zkCommitment;
    }

    /**
     * @dev Compute ZK commitment using keccak256
     */
    function computeCommitment(uint256 photoHash, uint256 secret) public pure returns (uint256) {
        bytes memory data = abi.encodePacked(photoHash, secret);
        return uint256(keccak256(data));
    }

    /**
     * @dev Check if a photo is verified
     */
    function isVerified(uint256 photoHash) external view returns (bool) {
        return attestations[photoHash].verifiedAt > 0;
    }

    /**
     * @dev Get photo owner
     */
    function getOwnerOf(uint256 photoHash) external view returns (address) {
        return attestations[photoHash].owner;
    }

    /**
     * @dev Get owner's photo count
     */
    function getOwnerPhotoCount(address _owner) external view returns (uint256) {
        return ownerPhotoCount[_owner];
    }

    /**
     * @dev Get total photos verified
     */
    function getPhotoCount() external view returns (uint256) {
        return photoCount;
    }
}
