import {
  isConnected,
  isAllowed,
  setAllowed,
  getAddress,
  signTransaction as freighterSignTransaction,
  getNetworkDetails,
  WatchWalletChanges,
} from "@stellar/freighter-api";

export type FreighterNetwork = "TESTNET" | "PUBLIC" | "FUTURENET";

const TESTNET_PASSPHRASE =
  "Test SDF Network ; September 2015";
const PUBLIC_PASSPHRASE =
  "Public Global Stellar Network ; September 2015";

function passphraseFor(network: FreighterNetwork): string {
  return network === "PUBLIC" ? PUBLIC_PASSPHRASE : TESTNET_PASSPHRASE;
}

export async function connectFreighter(): Promise<string> {
  const connected = await isConnected();
  if (!connected.isConnected) {
    throw new Error("WALLET_NOT_INSTALLED");
  }
  const allowed = await isAllowed();
  if (!allowed.isAllowed) {
    const result = await setAllowed();
    if (!result.isAllowed) throw new Error("WALLET_PERMISSION_DENIED");
  }
  return getPublicKey();
}

export async function getPublicKey(): Promise<string> {
  const result = await getAddress();
  if (result.error) throw new Error(result.error);
  return result.address;
}

export async function signTransaction(
  xdr: string,
  network: FreighterNetwork = "TESTNET",
): Promise<string> {
  const result = await freighterSignTransaction(xdr, {
    networkPassphrase: passphraseFor(network),
  });
  if (result.error) throw new Error(result.error);
  return result.signedTxXdr;
}

export async function checkNetwork(): Promise<FreighterNetwork> {
  const details = await getNetworkDetails();
  if (details.error) throw new Error(details.error);
  return details.networkPassphrase.includes("Test SDF") ? "TESTNET" : "PUBLIC";
}

export async function switchToTestnet(): Promise<void> {
  const network = await checkNetwork();
  if (network !== "TESTNET") {
    throw new Error("WRONG_NETWORK");
  }
}

export async function isFreighterInstalled(): Promise<boolean> {
  const connected = await isConnected();
  return !!connected.isConnected;
}

export async function isFreighterConnected(): Promise<boolean> {
  if (!(await isFreighterInstalled())) return false;
  const allowed = await isAllowed();
  return !!allowed.isAllowed;
}

export async function isWrongNetwork(): Promise<boolean> {
  try {
    const network = await checkNetwork();
    return network !== "TESTNET";
  } catch {
    return true;
  }
}

export { WatchWalletChanges };
