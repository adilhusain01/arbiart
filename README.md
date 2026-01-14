# ArbiPic 📸

> **On-Chain Verifiable Photo Capture System using Stylus and Arbitrum Orbit L3**

A decentralized application that combats AI-generated fake images by enabling users to capture photos via webcam and cryptographically verify them on-chain. Using Arbitrum's Stylus (Rust smart contracts) and Orbit L3, each photo is hashed, stored on IPFS, and verified on the blockchain with ZK-style ownership proofs.

---

## 🌟 Features

| Feature | Description |
|---------|-------------|
| **📸 Webcam Capture** | Real-time photo capture using react-webcam |
| **🔐 On-Chain Verification** | SHA-256 hash stored immutably on Arbitrum |
| **⚡ Stylus Contracts** | Rust/WASM for ~10x gas savings vs Solidity |
| **🌐 IPFS Storage** | Decentralized image storage via Pinata |
| **🔗 ZK Commitments** | keccak256-based ownership proofs |
| **🟣 Orbit L3** | Custom L3 chain for ultra-low cost verification |
| **🐦 Social Sharing** | Tweet verification proofs directly |
| **🔍 Verification Page** | Anyone can verify authenticity by uploading an image |
| **🔄 Network Switching** | Seamlessly switch between Sepolia and L3 |
| **🏷️ Watermarked Badges** | Download verified images with proof overlay |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                │
│  React 18 + TypeScript + Vite + Tailwind + Wagmi v2            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ PhotoCapture│  │ VerifyPage  │  │ NetworkSwitcher        │  │
│  │ Enhanced    │  │             │  │ (Sepolia ↔ Orbit L3)   │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐  ┌────────────────┐  ┌────────────────────┐
│   IPFS        │  │  Arbitrum      │  │  Orbit L3          │
│   (Pinata)    │  │  Sepolia       │  │  (Local/Custom)    │
│               │  │  Chain: 421614 │  │  Chain: 333333     │
│  Images +     │  │                │  │                    │
│  Metadata     │  │  ┌──────────┐  │  │  ┌──────────┐      │
└───────────────┘  │  │ Stylus   │  │  │  │ Stylus   │      │
                   │  │ Contract │  │  │  │ Contract │      │
                   │  │ (Rust)   │  │  │  │ (Rust)   │      │
                   │  └──────────┘  │  │  └──────────┘      │
                   └────────────────┘  └────────────────────┘
```

---

## 📦 Multi-Network Deployment

| Network | Contract Address | Chain ID | RPC |
|---------|-----------------|----------|-----|
| **Arbitrum Sepolia** | `0xeb246817d2440f82f4b4c04c2c120afefe1e5ec4` | 421614 | https://sepolia-rollup.arbitrum.io/rpc |
| **Orbit L3 (Local)** | `0x1294b86822ff4976bfe136cb06cf43ec7fcf2574` | 333333 | http://127.0.0.1:3347 |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **Rust** toolchain: `rustup install stable`
- **Cargo Stylus CLI**: `cargo install cargo-stylus --locked`
- **Docker** (for Orbit L3 local development)
- **MetaMask** wallet
- **Testnet ETH**: Get from [Sepolia Faucet](https://sepolia-faucet.pk910.de/)

### 1. Clone & Install

```bash
git clone https://github.com/yourusername/ArbiPic.git
cd ArbiPic

# Install frontend dependencies
cd frontend && npm install

# Build Rust contract
cd ../contracts && cargo build --release
```

### 2. Configure Environment

Create `frontend/.env`:
```env
VITE_PINATA_JWT=your_pinata_jwt_token
VITE_PINATA_GATEWAY=your-gateway.mypinata.cloud
VITE_APP_URL=http://localhost:5173
```

### 3. Run Frontend

```bash
cd frontend
npm run dev
```

Visit http://localhost:5173

---

## 🟣 Orbit L3 Deployment

For ultra-low cost verification on your own L3 chain:

### Start Local L3

```bash
# Clone nitro-testnode
git clone --recurse-submodules https://github.com/OffchainLabs/nitro-testnode.git
cd nitro-testnode

# Start L1 → L2 → L3 chain
yes | ./test-node.bash --init --l3node --detach
```

### Deploy Contract to L3

```bash
cd ArbiPic/contracts

cargo stylus deploy \
    --endpoint http://127.0.0.1:3347 \
    --private-key 0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659
```

### Add L3 to MetaMask

| Field | Value |
|-------|-------|
| Network Name | ArbiPic L3 (Orbit) |
| RPC URL | http://127.0.0.1:3347 |
| Chain ID | 333333 |
| Currency Symbol | ETH |

**Pre-funded test account:**
- Address: `0x3f1Eae7D46d88F08fc2F8ed27FCb2AB183EB2d0E`
- Private Key: `0xb6b15c8cb491557369f3c7d2c287b053eb229daa9c22138887752191c9520659`

See [docs/ORBIT_L3_DEPLOYMENT.md](docs/ORBIT_L3_DEPLOYMENT.md) for detailed guide.

---

## 📝 Usage Guide

### Capture & Verify a Photo

1. **Connect Wallet**: Click "Connect Wallet" and connect MetaMask
2. **Select Network**: Use the network switcher (🔵 Sepolia or 🟣 Orbit L3)
3. **Capture Photo**: Click "📸 Capture Photo" 
4. **Verify On-Chain**: Click "🔐 Verify On-Chain" to submit
5. **View Results**: Get IPFS link, transaction hash, and verification ID
6. **Share**: Tweet your verified photo or copy the verification link

### Verify Someone Else's Photo

1. Go to `/verify` page
2. Upload the image or paste the verification ID
3. System checks on-chain if the photo was verified
4. See owner address, timestamp, and ZK proof status

### Prove Ownership (ZK Proof)

If you verified a photo, you can prove ownership without revealing the image:
1. Click "🔐 Prove Ownership" 
2. Your locally-stored secret is used to verify against on-chain commitment
3. Cryptographic proof confirms you're the original owner

---

## 🔑 Smart Contract API

### Stylus Contract (Rust)

```rust
fn verify_photo(photo_hash: U256, zk_commitment: U256) -> U256
fn get_attestation(photo_hash: U256) -> (U256, Address, U256)
fn is_verified(photo_hash: U256) -> bool
fn verify_zk_proof(photo_hash: U256, secret: U256) -> bool
fn get_owner_of(photo_hash: U256) -> Address
fn get_photo_count() -> U256
```

### ABI (Solidity-compatible)

```solidity
function verifyPhoto(uint256 photoHash, uint256 zkCommitment) returns (uint256)
function getAttestation(uint256 photoHash) view returns (uint256, address, uint256)
function isVerified(uint256 photoHash) view returns (bool)
function verifyZkProof(uint256 photoHash, uint256 secret) view returns (bool)
function getOwnerOf(uint256 photoHash) view returns (address)
function getPhotoCount() view returns (uint256)
```

---

## 📊 Gas Benchmarks

| Operation | Stylus (Rust) | Solidity | Savings |
|-----------|---------------|----------|---------|
| verifyPhoto | ~45,000 gas | ~120,000 gas | **~63%** |
| getAttestation | ~8,000 gas | ~25,000 gas | **~68%** |
| verifyZkProof | ~12,000 gas | ~35,000 gas | **~66%** |

See [docs/GAS_BENCHMARKS.md](docs/GAS_BENCHMARKS.md) for detailed benchmarks.

---

## 📁 Project Structure

```
ArbiPic/
├── contracts/                    # Rust Stylus smart contract
│   ├── src/
│   │   ├── lib.rs               # Main contract code
│   │   └── main.rs              # ABI export
│   ├── solidity/
│   │   └── PhotoVerifierSolidity.sol
│   ├── Cargo.toml
│   └── Stylus.toml
├── frontend/                     # React frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── Header.tsx
│   │   │   ├── NetworkSwitcher.tsx
│   │   │   ├── PhotoCaptureEnhanced.tsx
│   │   │   └── VerifyPage.tsx
│   │   ├── utils/
│   │   │   ├── zkProof.ts
│   │   │   ├── ipfs.ts
│   │   │   ├── verification.ts
│   │   │   └── eas.ts
│   │   ├── config.ts
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
├── docs/
│   ├── GAS_BENCHMARKS.md
│   └── ORBIT_L3_DEPLOYMENT.md
├── scripts/
│   ├── deploy.sh
│   └── benchmark.sh
└── README.md
```

---

## 🛠️ Development

### Contract Development

```bash
cd contracts
cargo stylus check
cargo build --release --target wasm32-unknown-unknown
cargo stylus deploy --endpoint https://sepolia-rollup.arbitrum.io/rpc --private-key $KEY
```

### Frontend Development

```bash
cd frontend
npm run dev       # Start dev server
npm run build     # Build for production
npm run preview   # Preview production build
```

---

## 💡 Why Stylus?

| Benefit | Description |
|---------|-------------|
| **⚡ 10x Gas Savings** | WASM execution is more efficient than EVM bytecode |
| **🦀 Rust Safety** | Memory safety, no null pointers, no buffer overflows |
| **🔧 Modern Tooling** | Cargo, rustfmt, clippy, rust-analyzer support |
| **🔄 EVM Compatible** | Full interoperability with Solidity contracts |
| **📦 Rich Ecosystem** | Access to all Rust crates (with no_std support) |

---

## 🎯 What we have Achieved

| Category | Implementation |
|----------|---------------|
| ✅ **Stylus** | Rust smart contract with keccak256 ZK proofs |
| ✅ **Orbit L3** | Custom chain deployment with nitro-testnode |
| ✅ **Gas Efficiency** | 60-70% savings vs Solidity |
| ✅ **IPFS** | Decentralized storage via Pinata |
| ✅ **ZK Proofs** | Privacy-preserving ownership verification |
| ✅ **Multi-Chain** | Network switcher (Sepolia + L3) |
| ✅ **Social Proof** | Twitter sharing integration |
| ✅ **Modern UX** | React 18 + Wagmi v2 + Tailwind |

---

## 🔮 Future Roadmap

- [ ] Production Orbit Chain - Deploy on mainnet L3
- [ ] Full ZK Proofs - Implement SNARKs/STARKs for complete privacy
- [ ] Batch Verification - Verify multiple photos in one transaction
- [ ] AI Detection - Integrate deepfake detection algorithms
- [ ] Mobile App - React Native version
- [ ] Cross-Chain Bridge - Verify proofs across L2/L3

---

## 🔗 Resources

- [Stylus Documentation](https://docs.arbitrum.io/stylus/stylus-gentle-introduction)
- [Arbitrum Orbit](https://docs.arbitrum.io/launch-orbit-chain/orbit-gentle-introduction)
- [Cargo Stylus CLI](https://github.com/OffchainLabs/cargo-stylus)
- [Wagmi Documentation](https://wagmi.sh/)
- [Pinata IPFS](https://www.pinata.cloud/)

---

**Built with ❤️  🏆**

*Fighting AI fakes with blockchain technology*
