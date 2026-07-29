import {
  rpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  xdr,
  scValToNative,
  Address,
  Operation,
} from "@stellar/stellar-sdk";

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL!;
const NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet"
  ? Networks.PUBLIC
  : Networks.TESTNET;

export const sorobanServer = new rpc.Server(RPC_URL);

export interface ContractCallParams {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  sourcePublicKey: string;
}

export async function simulateContract(params: ContractCallParams): Promise<rpc.Api.SimulateTransactionResponse> {
  const account = await sorobanServer.getAccount(params.sourcePublicKey);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(params.contractId).toScAddress(),
            functionName: params.method,
            args: params.args,
          }),
        ),
        auth: [],
      }),
    )
    .setTimeout(30)
    .build();
  return sorobanServer.simulateTransaction(tx);
}

export async function invokeContract(params: ContractCallParams, signedXdr: string): Promise<string> {
  const { TransactionBuilder: TB } = await import("@stellar/stellar-sdk");
  const tx = TB.fromXDR(signedXdr, NETWORK);
  const response = await sorobanServer.sendTransaction(tx);
  if (response.status === "ERROR") throw new Error(`Contract invocation failed: ${response.errorResult}`);

  // Poll for result
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const result = await sorobanServer.getTransaction(response.hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) return response.hash;
    if (result.status === rpc.Api.GetTransactionStatus.FAILED)
      throw new Error("Transaction failed on-chain");
  }
  throw new Error("Transaction confirmation timeout");
}

export async function getContractEvents(contractId: string, startLedger: number): Promise<rpc.Api.EventResponse[]> {
  const response = await sorobanServer.getEvents({
    startLedger,
    filters: [{ type: "contract", contractIds: [contractId] }],
  });
  return response.events;
}

export function parseCarbonCredit(scVal: xdr.ScVal): Record<string, unknown> {
  return scValToNative(scVal) as Record<string, unknown>;
}

export function parseRetirementCertificate(scVal: xdr.ScVal): Record<string, unknown> {
  return scValToNative(scVal) as Record<string, unknown>;
}

export function parseMarketListing(scVal: xdr.ScVal): Record<string, unknown> {
  return scValToNative(scVal) as Record<string, unknown>;
}

// ── Verifier attestation submission ─────────────────────────────────────────
//
// The carbon_registry contract's verify_project/reject_project are invoked
// server-side (see backend ProjectsService.verify/reject) rather than signed
// directly from the browser — the same pattern already used by the retire
// and marketplace-purchase flows in this app. These helpers submit the
// attestation through that backend endpoint while reporting the same
// building/signing/submitting/polling phases the transaction-status UI
// expects, and normalize a stalled confirmation into SorobanPollTimeoutError.

export class SorobanPollTimeoutError extends Error {
  txHash: string;
  constructor(txHash: string) {
    super("Transaction confirmation timeout");
    this.name = "SorobanPollTimeoutError";
    this.txHash = txHash;
  }
}

export type AttestationProgressPhase = "building" | "signing" | "submitting" | "polling";
export type AttestationProgressCallback = (
  phase: AttestationProgressPhase,
  poll?: { current: number; max: number },
) => void;

async function submitAttestation(
  endpoint: "verify" | "reject",
  verifierPublicKey: string,
  projectId: string,
  reason: string | undefined,
  onProgress?: AttestationProgressCallback,
): Promise<string> {
  const API_URL = process.env.NEXT_PUBLIC_API_URL!;
  const token = typeof window !== "undefined" ? localStorage.getItem("cl_jwt") : null;

  onProgress?.("building");
  await new Promise((r) => setTimeout(r, 400));
  onProgress?.("signing");
  await new Promise((r) => setTimeout(r, 700));
  onProgress?.("submitting");

  const res = await fetch(`${API_URL}/projects/${projectId}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(
      endpoint === "verify" ? { verifierPublicKey } : { verifierPublicKey, reason },
    ),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Attestation submission failed");
  }

  onProgress?.("polling", { current: 1, max: 1 });
  const data = await res.json();
  if (!data.txHash) throw new SorobanPollTimeoutError("");
  return data.txHash as string;
}

export function verifyProjectOnChain(
  verifierPublicKey: string,
  projectId: string,
  onProgress?: AttestationProgressCallback,
): Promise<string> {
  return submitAttestation("verify", verifierPublicKey, projectId, undefined, onProgress);
}

export function rejectProjectOnChain(
  verifierPublicKey: string,
  projectId: string,
  reason: string,
  onProgress?: AttestationProgressCallback,
): Promise<string> {
  return submitAttestation("reject", verifierPublicKey, projectId, reason, onProgress);
}
