import {
  SorobanRpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  xdr,
  scValToNative,
  nativeToScVal,
  Address,
  assembleTransaction,
} from "@stellar/stellar-sdk";
import { parseHorizonTransactionFailure } from "./horizon-transaction-error";

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL!;
const REGISTRY_CONTRACT =
  process.env.NEXT_PUBLIC_REGISTRY_CONTRACT ?? process.env.NEXT_PUBLIC_CARBON_REGISTRY_CONTRACT_ID ?? "";
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

export interface PollProgress {
  current: number;
  max: number;
}

export class SorobanPollTimeoutError extends Error {
  constructor(
    message: string,
    readonly txHash: string,
  ) {
    super(message);
    this.name = "SorobanPollTimeoutError";
  }
}

export async function simulateContract(params: ContractCallParams): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
  const account = await sorobanServer.getAccount(params.sourcePublicKey);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(
      // @ts-ignore — soroban invoke
      {
        type: "invokeHostFunction",
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(params.contractId).toScAddress(),
            functionName: params.method,
            args: params.args,
          }),
        ),
        auth: [],
      },
    )
    .setTimeout(30)
    .build();
  return sorobanServer.simulateTransaction(tx);
}

async function buildPreparedTransaction(params: ContractCallParams): Promise<string> {
  if (!params.contractId) {
    throw new Error("Carbon registry contract is not configured");
  }

  const account = await sorobanServer.getAccount(params.sourcePublicKey);
  const raw = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(
      // @ts-ignore
      {
        type: "invokeHostFunction",
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(params.contractId).toScAddress(),
            functionName: params.method,
            args: params.args,
          }),
        ),
        auth: [],
      },
    )
    .setTimeout(30)
    .build();

  const simulation = await sorobanServer.simulateTransaction(raw);
  if (SorobanRpc.Api.isSimulationError(simulation)) {
    throw new Error(simulation.error ?? "Contract simulation failed");
  }

  return assembleTransaction(raw, simulation).build().toXDR();
}

export async function pollSorobanTransaction(
  hash: string,
  options?: { maxAttempts?: number; intervalMs?: number; onProgress?: (p: PollProgress) => void },
): Promise<string> {
  const maxAttempts = options?.maxAttempts ?? 20;
  const intervalMs = options?.intervalMs ?? 3000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    options?.onProgress?.({ current: attempt, max: maxAttempts });
    const result = await sorobanServer.getTransaction(hash);
    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }
    if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      const message =
        result.resultMetaXdr != null
          ? parseHorizonTransactionFailure({ result_xdr: result.resultMetaXdr })
          : "Transaction failed on-chain";
      throw new Error(message);
    }
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }

  throw new SorobanPollTimeoutError("Transaction confirmation timeout", hash);
}

export async function invokeContract(params: ContractCallParams, signedXdr: string): Promise<string> {
  const { TransactionBuilder: TB } = await import("@stellar/stellar-sdk");
  const tx = TB.fromXDR(signedXdr, NETWORK);
  const response = await sorobanServer.sendTransaction(tx);
  if (response.status === "ERROR") throw new Error(`Contract invocation failed: ${response.errorResult}`);

  return pollSorobanTransaction(response.hash);
}

export async function signAndInvokeContract(
  params: ContractCallParams,
  onProgress?: (phase: "building" | "signing" | "submitting" | "polling", poll?: PollProgress) => void,
): Promise<string> {
  onProgress?.("building");
  const unsignedXdr = await buildPreparedTransaction(params);

  onProgress?.("signing");
  const { signTransaction: freighterSign } = await import("./freighter");
  const signedXdr = await freighterSign(unsignedXdr, "TESTNET");

  onProgress?.("submitting");
  const { TransactionBuilder: TB } = await import("@stellar/stellar-sdk");
  const tx = TB.fromXDR(signedXdr, NETWORK);
  const response = await sorobanServer.sendTransaction(tx);
  if (response.status === "ERROR") {
    throw new Error(`Contract invocation failed: ${response.errorResult}`);
  }

  onProgress?.("polling");
  return pollSorobanTransaction(response.hash, {
    onProgress: p => onProgress?.("polling", p),
  });
}

function registryParams(
  verifierPublicKey: string,
  projectId: string,
  method: string,
  extraArgs: xdr.ScVal[] = [],
): ContractCallParams {
  return {
    contractId: REGISTRY_CONTRACT,
    method,
    args: [
      new Address(verifierPublicKey).toScVal(),
      nativeToScVal(projectId, { type: "string" }),
      ...extraArgs,
    ],
    sourcePublicKey: verifierPublicKey,
  };
}

export async function verifyProjectOnChain(
  verifierPublicKey: string,
  projectId: string,
  onProgress?: (phase: "building" | "signing" | "submitting" | "polling", poll?: PollProgress) => void,
): Promise<string> {
  return signAndInvokeContract(registryParams(verifierPublicKey, projectId, "verify_project"), onProgress);
}

export async function rejectProjectOnChain(
  verifierPublicKey: string,
  projectId: string,
  reason: string,
  onProgress?: (phase: "building" | "signing" | "submitting" | "polling", poll?: PollProgress) => void,
): Promise<string> {
  return signAndInvokeContract(
    registryParams(verifierPublicKey, projectId, "reject_project", [
      nativeToScVal(reason, { type: "string" }),
    ]),
    onProgress,
  );
}

export async function getContractEvents(contractId: string, startLedger: number): Promise<SorobanRpc.Api.EventResponse[]> {
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
