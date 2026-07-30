import {
  SorobanRpc,
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

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet"
  ? Networks.PUBLIC
  : Networks.TESTNET;

export const sorobanServer = new SorobanRpc.Server(RPC_URL);

export interface ContractCallParams {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  sourcePublicKey: string;
}

export async function simulateContract(params: ContractCallParams): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
  const account = await sorobanServer.getAccount(params.sourcePublicKey);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(params.contractId).toScAddress(),
            functionName:    params.method,
            args:            params.args,
          }),
        ),
        auth: [],
      }) as any,
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
    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return response.hash;
    if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED)
      throw new Error("Transaction failed on-chain");
  }
  throw new Error("Transaction confirmation timeout");
}

export async function getContractEvents(contractId: string, startLedger: number): Promise<SorobanRpc.Api.EventResponse[]> {
  const response = await sorobanServer.getEvents({
    startLedger,
    filters: [{ type: "contract", contractIds: [contractId] }],
  });
  return response.events;
}

export function describeSimulationError(error: unknown): string {
  const raw = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "Simulation failed";

  const normalized = raw.toLowerCase();
  if (normalized.includes("contracterror: 4") || normalized.includes("insufficient credits")) {
    return "The preview could not complete because insufficient credits are not available or your balance is insufficient.";
  }
  if (normalized.includes("contracterror: 10") || normalized.includes("listing") || normalized.includes("not found")) {
    return "The marketplace listing is no longer available, so this transaction cannot be previewed.";
  }
  if (normalized.includes("already retired") || normalized.includes("retired")) {
    return "These credits are already retired, so this transaction would fail.";
  }
  if (normalized.includes("network") || normalized.includes("rpc")) {
    return "The Stellar network is temporarily unavailable, so the preview could not be completed.";
  }
  return "Unable to preview this transaction. Please verify the amount, wallet balance, and network selection and try again.";
}

export function buildPreviewStateFromSimulation(
  simulation: SorobanRpc.Api.SimulateTransactionResponse,
  details: { debitLabel: string; creditLabel: string; debitValue: string; creditValue: string; feeLabel?: string },
): PreviewState {
  const successResponse = simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;
  const effects: PreviewEffect[] = [
    { label: details.debitLabel, value: details.debitValue },
    { label: details.creditLabel, value: details.creditValue },
  ];

  const feeCharged = (successResponse.result as any)?.feeCharged;
  if (feeCharged) {
    const fee = Number(feeCharged) / 1_000_000_000;
    effects.push({ label: "Estimated gas fee", value: `${fee.toFixed(2)} XLM` });
  }

  return {
    loading: false,
    ready: true,
    effects,
    feeEstimate: details.feeLabel ?? (feeCharged ? `${(Number(feeCharged) / 1_000_000_000).toFixed(2)} XLM` : undefined),
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
    const totalCost = BigInt(params.pricePerCredit) * BigInt(params.amount);
    const simulation = await simulateContract({
      contractId: params.contractId,
      method: "purchase_credits",
      args: [
        new Address(params.sourcePublicKey).toScVal(),
        nativeToScVal(params.listingId),
        nativeToScVal(BigInt(params.amount)),
      ],
      sourcePublicKey: params.sourcePublicKey,
    });

    return buildPreviewStateFromSimulation(simulation, {
      debitLabel: "USDC debit",
      creditLabel: "Credits received",
      debitValue: `$${formatStroops(totalCost)} USDC`,
      creditValue: `${params.amount} credits`,
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
        nativeToScVal(params.batchId),
        nativeToScVal(BigInt(params.amount)),
        nativeToScVal(params.reason || "preview"),
        nativeToScVal(params.beneficiary || "preview"),
        nativeToScVal(`preview-${Date.now()}`),
        nativeToScVal(`preview-${Date.now()}`),
      ],
      sourcePublicKey: params.sourcePublicKey,
    });

    return buildPreviewStateFromSimulation(simulation, {
      debitLabel: "USDC debit",
      creditLabel: "Credits retired",
      debitValue: "$0.00 USDC",
      creditValue: `${params.amount} credits`,
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

export function parseRetirementCertificate(scVal: xdr.ScVal): Record<string, unknown> {
  return scValToNative(scVal) as Record<string, unknown>;
}

export function parseMarketListing(scVal: xdr.ScVal): Record<string, unknown> {
  return scValToNative(scVal) as Record<string, unknown>;
}
