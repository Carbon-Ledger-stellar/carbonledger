import { Horizon, Asset, Networks, TransactionBuilder, BASE_FEE, Operation } from "@stellar/stellar-sdk";

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL!;
const NETWORK     = process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet"
  ? Networks.PUBLIC
  : Networks.TESTNET;

const server = new Horizon.Server(HORIZON_URL);

export function formatCreditAsset(projectId: string, issuerPublicKey: string): Asset {
  // Stellar asset codes max 12 chars — use first 12 chars of project ID
  const code = projectId.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 12);
  return new Asset(code, issuerPublicKey);
}

export async function getOrderBook(
  sellingAsset: Asset,
  buyingAsset: Asset,
  limit = 20,
): Promise<any> {
  return server.orderbook(sellingAsset, buyingAsset).limit(limit).call();
}

export async function getBestPrice(
  sellingAsset: Asset,
  buyingAsset: Asset,
): Promise<number | null> {
  const book = await getOrderBook(sellingAsset, buyingAsset);
  if (book.asks.length === 0) return null;
  return parseFloat(book.asks[0].price);
}

export async function placeBuyOrder(
  buyerKeypair: { publicKey: string; sign: (xdr: string) => Promise<string> },
  sellingAsset: Asset,
  buyingAsset: Asset,
  amount: string,
  price: string,
): Promise<string> {
  const account = await server.loadAccount(buyerKeypair.publicKey);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(
      Operation.manageBuyOffer({
        selling: sellingAsset,
        buying:  buyingAsset,
        buyAmount: amount,
        price,
      }),
    )
    .setTimeout(30)
    .build();
  const signed = await buyerKeypair.sign(tx.toXDR());
  const { TransactionBuilder: TB } = await import("@stellar/stellar-sdk");
  const signedTx = TB.fromXDR(signed, NETWORK);
  const result = await server.submitTransaction(signedTx);
  return result.hash;
}

export async function placeSellOrder(
  sellerKeypair: { publicKey: string; sign: (xdr: string) => Promise<string> },
  sellingAsset: Asset,
  buyingAsset: Asset,
  amount: string,
  price: string,
): Promise<string> {
  const account = await server.loadAccount(sellerKeypair.publicKey);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(
      Operation.manageSellOffer({
        selling: sellingAsset,
        buying:  buyingAsset,
        amount,
        price,
      }),
    )
    .setTimeout(30)
    .build();
  const signed = await sellerKeypair.sign(tx.toXDR());
  const { TransactionBuilder: TB } = await import("@stellar/stellar-sdk");
  const signedTx = TB.fromXDR(signed, NETWORK);
  const result = await server.submitTransaction(signedTx);
  return result.hash;
}

export async function getTradeHistory(
  baseAsset: Asset,
  counterAsset: Asset,
  limit = 50,
): Promise<any[]> {
  const trades = await server
    .trades()
    .forAssetPair(baseAsset, counterAsset)
    .limit(limit)
    .order("desc")
    .call();
  return trades.records;
}
