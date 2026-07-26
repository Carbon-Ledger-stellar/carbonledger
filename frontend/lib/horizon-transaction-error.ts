import { xdr } from "@stellar/stellar-sdk";

/**
 * Extract a CarbonError(N)-compatible message from a Horizon transaction result XDR.
 */
export function parseTransactionResultXdr(resultXdr: string): string {
  try {
    const txResult = xdr.TransactionResult.fromXDR(resultXdr, "base64");
    const result = txResult.result();
    if (result.switch() !== xdr.TransactionResultCode.txFailed()) {
      return "Transaction failed on-chain";
    }

    const opResults = result.results();
    for (let i = 0; i < opResults.length; i++) {
      const contractCode = extractContractCodeFromOpResult(opResults[i]);
      if (contractCode != null) {
        return `CarbonError(${contractCode})`;
      }
    }
  } catch {
    // fall through
  }

  return "Transaction failed on-chain";
}

function extractContractCodeFromOpResult(opResult: xdr.OperationResult): number | null {
  try {
    const body = opResult.tr();
    if (body.switch() !== xdr.OperationType.invokeHostFunction()) {
      return null;
    }

    const invokeResult = body.invokeHostFunctionResult();
    const tag = invokeResult.switch().name;
    if (tag !== "invokeHostFunctionTrapped" && tag !== "invokeHostFunctionMalformed") {
      return null;
    }

    const err = invokeResult.error?.();
    if (!err) {
      return null;
    }

    const errTag = err.switch().name;
    if (errTag === "contractCode") {
      return err.contractCode();
    }
    if (errTag === "contractError") {
      return err.contractError();
    }
  } catch {
    return null;
  }
  return null;
}

export function parseHorizonTransactionFailure(tx: {
  result_xdr?: string;
  result_codes?: unknown;
}): string {
  if (tx.result_xdr) {
    const parsed = parseTransactionResultXdr(tx.result_xdr);
    if (parsed !== "Transaction failed on-chain") {
      return parsed;
    }
  }

  if (tx.result_codes && typeof tx.result_codes === "object") {
    const ops = (tx.result_codes as { operations?: string[] }).operations;
    if (ops?.length) {
      for (const op of ops) {
        const match = op.match(/contract_code_(\d+)|error_code_(\d+)|#(\d+)/i);
        const code = match?.[1] ?? match?.[2] ?? match?.[3];
        if (code) {
          return `CarbonError(${code})`;
        }
      }
    }
  }

  if (tx.result_xdr) {
    return parseTransactionResultXdr(tx.result_xdr);
  }

  return "Transaction failed on-chain";
}
