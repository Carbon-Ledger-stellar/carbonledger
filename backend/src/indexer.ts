import { SorobanRpc, Contract, scValToNative, xdr } from '@stellar/stellar-sdk';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const server = new SorobanRpc.Server(process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org');

const contracts = {
  registry: process.env.CARBON_REGISTRY_CONTRACT_ID!,
  credit: process.env.CARBON_CREDIT_CONTRACT_ID!,
  marketplace: process.env.CARBON_MARKETPLACE_CONTRACT_ID!,
  oracle: process.env.CARBON_ORACLE_CONTRACT_ID!,
};

async function getAllEvents() {
  const allEvents: SorobanRpc.Api.EventResponse[] = [];
  for (const contractId of Object.values(contracts)) {
    let cursor: string | undefined;
    while (true) {
      const response = await server.getEvents({
        startLedger: 1,
        cursor,
        filters: [{ type: 'contract', contractIds: [contractId] }],
      });
      allEvents.push(...response.events);
      if (!response.cursor) break;
      cursor = response.cursor;
    }
  }
  allEvents.sort((a, b) => a.ledger - b.ledger || a.txIndex - b.txIndex);
  return allEvents;
}

async function invokeRead(contractId: string, method: string, args: xdr.ScVal[]) {
  const contract = new Contract(contractId);
  const tx = new SorobanRpc.TransactionBuilder()
    .addOperation(contract.call(method, ...args))
    .build();
  const sim = await server.simulateTransaction(tx);
  if (sim.error) throw new Error(sim.error);
  return scValToNative(sim.result!.retval);
}

async function indexEvent(event: SorobanRpc.Api.EventResponse) {
  const topic = event.topic.map((t: xdr.ScVal) => scValToNative(t));
  const data = event.data.map((d: xdr.ScVal) => scValToNative(d));
  const eventType = topic[1] as string;

  switch (eventType) {
    case 'reg_proj':
      await handleRegisterProject(data[0] as string);
      break;
    case 'verified':
      await handleVerifyProject(data[0] as string);
      break;
    case 'rejected':
      await handleRejectProject(data[0] as string);
      break;
    case 'st_update':
      await handleStatusUpdate(data[0] as string);
      break;
    case 'suspended':
      await handleSuspendProject(data[0] as string);
      break;
    case 'minted':
      await handleMinted(data[0] as string);
      break;
    case 'retired':
      await handleRetired(data[0] as string);
      break;
    case 'transfer':
      await handleTransfer(data[0] as string, data[1] as string, data[2] as string, data[3] as number);
      break;
    case 'listed':
      await handleListed(data[0] as string);
      break;
    case 'delisted':
      await handleDelisted(data[0] as string);
      break;
    case 'purchase':
      await handlePurchase(data[0] as string, data[3] as number);
      break;
    case 'bulk_buy':
      await handleBulkBuy(data[0] as string, data[2] as number);
      break;
    case 'mkt_susp':
      await handleMarketSuspend(data[0] as string);
      break;
    case 'mon_data':
      await handleMonitoringData(data[0] as string, data[1] as string, data[2] as number, data[3] as number);
      break;
    default:
      // ignore
      break;
  }
}

async function handleRegisterProject(projectId: string) {
  const projectData = await invokeRead(contracts.registry, 'get_project', [xdr.ScVal.scvString(projectId)]);
  const project = {
    projectId,
    name: projectData.name,
    description: projectData.description,
    methodology: projectData.methodology,
    country: projectData.country,
    projectType: projectData.project_type,
    status: mapStatus(projectData.status),
    vintageYear: projectData.vintage_year,
    totalCreditsIssued: projectData.total_credits_issued,
    totalCreditsRetired: projectData.total_credits_retired,
    metadataCid: projectData.metadata_cid,
    verifierAddress: projectData.verifier_address,
    ownerAddress: projectData.owner_address,
    createdAt: new Date(projectData.created_at * 1000),
  };
  await prisma.carbonProject.upsert({
    where: { projectId },
    update: project,
    create: project,
  });
}

async function handleVerifyProject(projectId: string) {
  await prisma.carbonProject.update({
    where: { projectId },
    data: { status: 'Verified' },
  });
}

async function handleRejectProject(projectId: string) {
  await prisma.carbonProject.update({
    where: { projectId },
    data: { status: 'Rejected' },
  });
}

async function handleStatusUpdate(projectId: string) {
  const projectData = await invokeRead(contracts.registry, 'get_project', [xdr.ScVal.scvString(projectId)]);
  await prisma.carbonProject.update({
    where: { projectId },
    data: { status: mapStatus(projectData.status) },
  });
}

async function handleSuspendProject(projectId: string) {
  await prisma.carbonProject.update({
    where: { projectId },
    data: { status: 'Suspended' },
  });
}

async function handleMinted(batchId: string) {
  const batchData = await invokeRead(contracts.credit, 'get_credit_batch', [xdr.ScVal.scvString(batchId)]);
  const batch = {
    batchId,
    projectId: batchData.project_id,
    vintageYear: batchData.vintage_year,
    amount: batchData.amount,
    serialStart: batchData.serial_start,
    serialEnd: batchData.serial_end,
    status: batchData.status,
    metadataCid: batchData.metadata_cid,
    issuedAt: new Date(batchData.issued_at * 1000),
  };
  await prisma.creditBatch.upsert({
    where: { batchId },
    update: batch,
    create: batch,
  });
  await prisma.carbonProject.update({
    where: { projectId: batchData.project_id },
    data: { totalCreditsIssued: { increment: batchData.amount } },
  });
}

async function handleRetired(retirementId: string) {
  const certData = await invokeRead(contracts.credit, 'get_retirement_certificate', [xdr.ScVal.scvString(retirementId)]);
  const retirement = {
    retirementId,
    batchId: certData.credit_batch_id,
    projectId: certData.project_id,
    amount: certData.amount,
    retiredBy: certData.retired_by,
    beneficiary: certData.beneficiary,
    retirementReason: certData.retirement_reason,
    vintageYear: certData.vintage_year,
    serialNumbers: certData.serial_numbers,
    txHash: certData.tx_hash,
    retiredAt: new Date(certData.retired_at * 1000),
  };
  await prisma.retirementRecord.upsert({
    where: { retirementId },
    update: retirement,
    create: retirement,
  });
  await prisma.carbonProject.update({
    where: { projectId: certData.project_id },
    data: { totalCreditsRetired: { increment: certData.amount } },
  });
}

async function handleTransfer(batchId: string, from: string, to: string, amount: number) {
  await prisma.creditBatch.update({
    where: { batchId },
    data: { owner: to },
  });
}

async function handleListed(listingId: string) {
  const listingData = await invokeRead(contracts.marketplace, 'get_listing', [xdr.ScVal.scvString(listingId)]);
  const listing = {
    listingId,
    projectId: listingData.project_id,
    batchId: listingData.batch_id,
    seller: listingData.seller,
    amountAvailable: listingData.amount_available,
    pricePerCredit: listingData.price_per_credit.toString(),
    vintageYear: listingData.vintage_year,
    methodology: listingData.methodology,
    country: listingData.country,
    status: listingData.status,
    createdAt: new Date(listingData.created_at * 1000),
  };
  await prisma.marketListing.upsert({
    where: { listingId },
    update: listing,
    create: listing,
  });
}

async function handleDelisted(listingId: string) {
  await prisma.marketListing.update({
    where: { listingId },
    data: { status: 'Delisted' },
  });
}

async function handlePurchase(listingId: string, amount: number) {
  const listingData = await invokeRead(contracts.marketplace, 'get_listing', [xdr.ScVal.scvString(listingId)]);
  await prisma.marketListing.update({
    where: { listingId },
    data: {
      amountAvailable: listingData.amount_available,
      status: listingData.status,
    },
  });
}

async function handleBulkBuy(listingId: string, amount: number) {
  await handlePurchase(listingId, amount);
}

async function handleMarketSuspend(projectId: string) {
  // update listings to suspended or something
}

async function handleMonitoringData(projectId: string, period: string, tonnes: number, score: number) {
  // insert or update monitoring
}

function mapStatus(status: any) {
  if (status.Pending) return 'Pending';
  if (status.Verified) return 'Verified';
  if (status.Rejected) return 'Rejected';
  if (status.Suspended) return 'Suspended';
  if (status.Completed) return 'Completed';
  return 'Pending';
}

async function main() {
  console.log('Starting indexer from genesis...');
  const startTime = Date.now();
  const events = await getAllEvents();
  console.log(`Fetched ${events.length} events`);
  for (const event of events) {
    await indexEvent(event);
  }
  const endTime = Date.now();
  console.log(`Indexing completed in ${(endTime - startTime) / 1000} seconds`);
}

main().catch(console.error).finally(() => prisma.$disconnect());