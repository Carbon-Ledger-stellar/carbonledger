import {
  getPublicKey as freighterGetPublicKey,
  signTransaction as freighterSignTransaction,
  isConnected,
  isAllowed,
  setAllowed,
  getNetworkDetails,
} from "@stellar/freighter-api";

export type FreighterNetwork = "TESTNET" | "PUBLIC" | "FUTURENET";

export async function connectFreighter(): Promise<string> {
  const connected = await isConnected();
  const connectedFlag = typeof connected === "boolean" ? connected : (connected as { isConnected?: boolean }).isConnected;
  if (!connectedFlag) {
    throw new Error("WALLET_NOT_INSTALLED");
  }
  const allowed = await isAllowed();
  const allowedFlag = typeof allowed === "boolean" ? allowed : (allowed as { isAllowed?: boolean }).isAllowed;
  if (!allowedFlag) {
    const result = await setAllowed();
    const resultFlag = typeof result === "boolean" ? result : (result as { isAllowed?: boolean }).isAllowed;
    if (!resultFlag) throw new Error("WALLET_PERMISSION_DENIED");
  }
  return getPublicKey();
}

export async function getPublicKey(): Promise<string> {
  const result = await freighterGetPublicKey();
  const resultData = typeof result === "string" ? { publicKey: result } : (result as { publicKey?: string; error?: string });
  if (resultData.error) throw new Error(resultData.error);
  if (!resultData.publicKey) throw new Error("WALLET_PERMISSION_DENIED");
  return resultData.publicKey;
}

export async function signTransaction(
  xdr: string,
  network: FreighterNetwork = "TESTNET",
): Promise<string> {
  const result = await freighterSignTransaction(xdr, { network });
  const resultData = typeof result === "string" ? { signedTxXdr: result } : (result as { signedTxXdr?: string; error?: string });
  if (resultData.error) throw new Error(resultData.error);
  if (!resultData.signedTxXdr) throw new Error("WALLET_PERMISSION_DENIED");
  return resultData.signedTxXdr;
}

export async function checkNetwork(): Promise<FreighterNetwork> {
  const details = await getNetworkDetails();
  const networkDetails = details as { error?: string; networkPassphrase?: string };
  if (networkDetails.error) throw new Error(networkDetails.error);
  return networkDetails.networkPassphrase?.includes("Test SDF") ? "TESTNET" : "PUBLIC";
}

export async function switchToTestnet(): Promise<void> {
  const network = await checkNetwork();
  if (network !== "TESTNET") {
    throw new Error("WRONG_NETWORK");
  }
}
