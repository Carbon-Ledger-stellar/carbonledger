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
