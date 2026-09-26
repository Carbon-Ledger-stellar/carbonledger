import {
  rpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  xdr,
  scValToNative,
  nativeToScVal,
  Address,
  Operation,
} from "@stellar/stellar-sdk";
import { PreviewEffect, PreviewState } from "./transaction-preview-types";
import { formatStroops } from "./stellar";
import { getCarbonErrorPlainMessage } from "./carbon-error-codes";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ||
  "https://soroban-testnet.stellar.org";
const NETWORK =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet"
    ? Networks.PUBLIC
    : Networks.TESTNET;

export const sorobanServer = new rpc.Server(RPC_URL);

export interface ContractCallParams {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  sourcePublicKey: string;
}

export async function simulateContract(
  params: ContractCallParams,
): Promise<rpc.Api.SimulateTransactionResponse> {
  const account = await sorobanServer.getAccount(params.sourcePublicKey);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(
              params.contractId,
            ).toScAddress(),
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

export async function invokeContract(
  params: ContractCallParams,
  signedXdr: string,
): Promise<string> {
  const { TransactionBuilder: TB } = await import("@stellar/stellar-sdk");
  const tx = TB.fromXDR(signedXdr, NETWORK);
  const response = await sorobanServer.sendTransaction(tx);
  if (response.status === "ERROR")
    throw new Error(
      `Contract invocation failed: ${response.errorResult}`,
    );

  // Poll for result
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const result = await sorobanServer.getTransaction(response.hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS)
      return response.hash;
    if (result.status === rpc.Api.GetTransactionStatus.FAILED)
      throw new Error("Transaction failed on-chain");
  }
  throw new Error("Transaction confirmation timeout");
}

export async function getContractEvents(
  contractId: string,
  startLedger: number,
): Promise<rpc.Api.EventResponse[]> {
  const response = await sorobanServer.getEvents({
    startLedger,
    filters: [{ type: "contract", contractIds: [contractId] }],
  });
  return response.events;
}

/**
 * Extract the numeric CarbonError code from a Soroban simulation error string.
 * Soroban typically encodes contract errors as "Error(Contract, #N)" or
 * "ContractError: N" in the diagnostic events / error string.
 */
function extractCarbonErrorCode(raw: string): number | undefined {
  // "Error(Contract, #4)" format
  let m = raw.match(/Error\s*\(\s*Contract\s*,\s*#(\d+)\s*\)/i);
  if (m) return parseInt(m[1], 10);
  // "ContractError: 4" or "contracterror: 4" format
  m = raw.match(/contracterror:\s*(\d+)/i);
  if (m) return parseInt(m[1], 10);
  return undefined;
}

export function describeSimulationError(error: unknown): string {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "Simulation failed";

  // Try to extract and use the canonical CarbonError code first
  const code = extractCarbonErrorCode(raw);
  if (code !== undefined) {
    return getCarbonErrorPlainMessage(code);
  }

  // Fallback to keyword matching for responses without structured codes
  const normalized = raw.toLowerCase();
  if (
    normalized.includes("insufficient credits") ||
    normalized.includes("insufficientcredits")
  ) {
    return "Insufficient credits. You don't have enough credits in this batch to complete this action.";
  }
  if (normalized.includes("already retired") || normalized.includes("alreadyretired")) {
    return "These credits have already been retired and cannot be retired again.";
  }
  if (normalized.includes("listing") && normalized.includes("not found")) {
    return "The marketplace listing is no longer available, so this transaction cannot be previewed.";
  }
  if (normalized.includes("network") || normalized.includes("rpc")) {
    return "The Stellar network is temporarily unavailable, so the preview could not be completed.";
  }
  return "Unable to preview this transaction. Please verify the amount, wallet balance, and network selection and try again.";
}

export function buildPreviewStateFromSimulation(
  simulation: rpc.Api.SimulateTransactionResponse,
  details: {
    debitLabel: string;
    creditLabel: string;
    debitValue: string;
    creditValue: string;
    feeLabel?: string;
  },
): PreviewState {
  // If the simulation returned an error, surface it as plain language
  if (rpc.Api.isSimulationError(simulation)) {
    const errResp = simulation as rpc.Api.SimulateTransactionErrorResponse;
    return {
      loading: false,
      ready: false,
      effects: [],
      error: describeSimulationError(errResp.error),
    };
  }

  const successResponse =
    simulation as rpc.Api.SimulateTransactionSuccessResponse;

  const effects: PreviewEffect[] = [
    { label: details.debitLabel, value: details.debitValue },
    { label: details.creditLabel, value: details.creditValue },
  ];

  // minResourceFee is the Soroban resource fee in stroops (string).
  // The base inclusion fee (BASE_FEE = 100 stroops ≈ 0.00001 XLM) is added on top.
  const resourceFeeStroops = Number(successResponse.minResourceFee ?? 0);
  const baseFeeStroops = 100; // BASE_FEE
  const totalFeeStroops = resourceFeeStroops + baseFeeStroops;
  // Convert stroops → XLM (1 XLM = 10,000,000 stroops)
  const feeXlm = (totalFeeStroops / 10_000_000).toFixed(7).replace(/0+$/, "").replace(/\.$/, ".0000001");
  const feeLabel =
    details.feeLabel ?? `~${(totalFeeStroops / 10_000_000).toFixed(5)} XLM`;

  effects.push({ label: "Estimated network fee", value: feeLabel });

  return {
    loading: false,
    ready: true,
    effects,
    feeEstimate: feeLabel,
  };
}

export async function simulatePurchasePreview(params: {
  contractId: string;
  sourcePublicKey: string;
  listingId: string;
  amount: number;
  pricePerCredit: string;
}): Promise<PreviewState> {
  try {
    const totalCost = BigInt(params.pricePerCredit) * BigInt(Math.round(params.amount * 100)) / 100n;
    const simulation = await simulateContract({
      contractId: params.contractId,
      method: "purchase_credits",
      args: [
        new Address(params.sourcePublicKey).toScVal(),
        nativeToScVal(params.listingId, { type: "string" }),
        nativeToScVal(BigInt(params.amount), { type: "i128" }),
      ],
      sourcePublicKey: params.sourcePublicKey,
    });

    return buildPreviewStateFromSimulation(simulation, {
      debitLabel: "USDC debit",
      creditLabel: "Credits received",
      debitValue: `$${formatStroops(totalCost)} USDC`,
      creditValue: `${params.amount} credit${params.amount !== 1 ? "s" : ""}`,
    });
  } catch (error) {
    return {
      loading: false,
      ready: false,
      effects: [],
      error: describeSimulationError(error),
    };
  }
}

export async function simulateBulkPurchasePreview(params: {
  contractId: string;
  sourcePublicKey: string;
  items: Array<{ listingId: string; amount: number; pricePerCredit: string }>;
}): Promise<PreviewState> {
  try {
    const totalCost = params.items.reduce((sum, item) => {
      return sum + BigInt(item.pricePerCredit) * BigInt(Math.round(item.amount * 100)) / 100n;
    }, 0n);
    const totalAmount = params.items.reduce((sum, item) => sum + item.amount, 0);

    const simulation = await simulateContract({
      contractId: params.contractId,
      method: "bulk_purchase",
      args: [
        new Address(params.sourcePublicKey).toScVal(),
        nativeToScVal(
          params.items.map((item) => ({
            listing_id: item.listingId,
            amount: BigInt(Math.round(item.amount * 100)) / 100n,
          })),
        ),
      ],
      sourcePublicKey: params.sourcePublicKey,
    });

    return buildPreviewStateFromSimulation(simulation, {
      debitLabel: "USDC debit",
      creditLabel: "Credits received",
      debitValue: `$${formatStroops(totalCost)} USDC`,
      creditValue: `${totalAmount} credit${totalAmount !== 1 ? "s" : ""} across ${params.items.length} listing${params.items.length !== 1 ? "s" : ""}`,
    });
  } catch (error) {
    return {
      loading: false,
      ready: false,
      effects: [],
      error: describeSimulationError(error),
    };
  }
}

export async function simulateRetirementPreview(params: {
  contractId: string;
  sourcePublicKey: string;
  batchId: string;
  amount: number;
  beneficiary: string;
  reason: string;
}): Promise<PreviewState> {
  try {
    const simulation = await simulateContract({
      contractId: params.contractId,
      method: "retire_credits",
      args: [
        new Address(params.sourcePublicKey).toScVal(),
        nativeToScVal(params.batchId, { type: "string" }),
        nativeToScVal(BigInt(Math.round(params.amount * 100)) / 100n, { type: "i128" }),
        nativeToScVal(params.reason || "preview", { type: "string" }),
        nativeToScVal(params.beneficiary || "preview", { type: "string" }),
        nativeToScVal(`preview-${Date.now()}`, { type: "string" }),
        nativeToScVal(`preview-${Date.now()}`, { type: "string" }),
      ],
      sourcePublicKey: params.sourcePublicKey,
    });

    return buildPreviewStateFromSimulation(simulation, {
      debitLabel: "USDC debit",
      creditLabel: "Credits retired",
      debitValue: "$0.00 USDC",
      creditValue: `${params.amount} credit${params.amount !== 1 ? "s" : ""}`,
    });
  } catch (error) {
    return {
      loading: false,
      ready: false,
      effects: [],
      error: describeSimulationError(error),
    };
  }
}

export function parseCarbonCredit(scVal: xdr.ScVal): Record<string, unknown> {
  return scValToNative(scVal) as Record<string, unknown>;
}

export function parseRetirementCertificate(
  scVal: xdr.ScVal,
): Record<string, unknown> {
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

export type AttestationProgressPhase =
  | "building"
  | "signing"
  | "submitting"
  | "polling";
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
  const token =
    typeof window !== "undefined" ? localStorage.getItem("cl_jwt") : null;

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
      endpoint === "verify"
        ? { verifierPublicKey }
        : { verifierPublicKey, reason },
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
  return submitAttestation(
    "verify",
    verifierPublicKey,
    projectId,
    undefined,
    onProgress,
  );
}

export function rejectProjectOnChain(
  verifierPublicKey: string,
  projectId: string,
  reason: string,
  onProgress?: AttestationProgressCallback,
): Promise<string> {
  return submitAttestation(
    "reject",
    verifierPublicKey,
    projectId,
    reason,
    onProgress,
  );
}
