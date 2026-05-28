/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
  images: { domains: ["ipfs.io", "gateway.pinata.cloud"] },
  env: {
    NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet",
    NEXT_PUBLIC_HORIZON_URL: process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org",
    NEXT_PUBLIC_SOROBAN_RPC_URL: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org",
    NEXT_PUBLIC_REGISTRY_CONTRACT: process.env.NEXT_PUBLIC_REGISTRY_CONTRACT || "",
    NEXT_PUBLIC_CREDIT_CONTRACT: process.env.NEXT_PUBLIC_CREDIT_CONTRACT || "",
    NEXT_PUBLIC_MARKETPLACE_CONTRACT: process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT || "",
    NEXT_PUBLIC_ORACLE_CONTRACT: process.env.NEXT_PUBLIC_ORACLE_CONTRACT || "",
    NEXT_PUBLIC_USDC_CONTRACT: process.env.NEXT_PUBLIC_USDC_CONTRACT || "",
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
  },
};
module.exports = nextConfig;
