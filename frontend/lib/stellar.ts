import {
  Horizon,
  Keypair,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Asset,
  Operation,
  Account,
} from "@stellar/stellar-sdk";

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";
const NETWORK     = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet"
  ? Networks.PUBLIC
  : Networks.TESTNET;

export const horizonServer = new Horizon.Server(HORIZON_URL);

export async function createStellarAccount(): Promise<Keypair> {
  return Keypair.random();
}

export async function fundTestnetAccount(publicKey: string): Promise<void> {
  const resp = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  if (!resp.ok) throw new Error("Friendbot funding failed");
}

export async function submitTransaction(xdr: string): Promise<Horizon.HorizonApi.SubmitTransactionResponse> {
  const { TransactionBuilder: TB } = await import("@stellar/stellar-sdk");
  const tx = TB.fromXDR(xdr, NETWORK);
  return horizonServer.submitTransaction(tx);
}

export async function getAccountBalances(publicKey: string): Promise<Horizon.HorizonApi.BalanceLine[]> {
  const account = await horizonServer.loadAccount(publicKey);
  return account.balances;
}

/** Convert stroops (i128 with 7 decimals) to human-readable USDC string. */
export function formatStroops(stroops: bigint | number | string): string {
  const n = BigInt(stroops);
  const whole = n / 10_000_000n;
  const frac  = (n % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Parse a human-readable USDC amount to stroops. */
export function parseStroops(usdc: string): bigint {
  const [whole, frac = ""] = usdc.split(".");
  const fracPadded = frac.padEnd(7, "0").slice(0, 7);
  return BigInt(whole) * 10_000_000n + BigInt(fracPadded);
}

export async function issueAsset(
  issuerKeypair: Keypair,
  assetCode: string,
  distributorPublicKey: string,
  amount: string,
): Promise<string> {
  const asset   = new Asset(assetCode, issuerKeypair.publicKey());
  const account = await horizonServer.loadAccount(issuerKeypair.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(Operation.payment({ destination: distributorPublicKey, asset, amount }))
    .setTimeout(30)
    .build();
  tx.sign(issuerKeypair);
  const result = await horizonServer.submitTransaction(tx);
  return result.hash;
}

export async function createTrustline(
  accountKeypair: Keypair,
  assetCode: string,
  issuerPublicKey: string,
): Promise<string> {
  const asset   = new Asset(assetCode, issuerPublicKey);
  const account = await horizonServer.loadAccount(accountKeypair.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(30)
    .build();
  tx.sign(accountKeypair);
  const result = await horizonServer.submitTransaction(tx);
  return result.hash;
}
