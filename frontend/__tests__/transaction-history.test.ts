import { generateTransactionsCSV, Transaction } from "../components/TransactionHistory";

describe("generateTransactionsCSV", () => {
  const sampleTransactions: Transaction[] = [
    {
      id: "tx-1",
      date: "2024-01-15",
      type: "Purchase",
      amount: "500 tCO2e",
      price: "$15.00",
      txHash: "0xabc123",
      status: "Completed",
      description: "Amazon Protection Project",
    },
    {
      id: "tx-2",
      date: "2024-01-10",
      type: "Retirement",
      amount: "200 tCO2e",
      price: "$12.50",
      txHash: "0xdef456",
      status: "Verified",
      description: "Forest Conservation, Brazil",
    },
  ];

  it("includes correct CSV headers", () => {
    const csv = generateTransactionsCSV(sampleTransactions);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Date,Type,Amount,Price,Tx Hash,Status,Description");
  });

  it("formats transactions into CSV rows with proper escaping", () => {
    const csv = generateTransactionsCSV(sampleTransactions);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("2024-01-15,Purchase,500 tCO2e,$15.00,0xabc123,Completed,Amazon Protection Project");
    // Row 2 contains a comma in the description, so it must be quoted
    expect(lines[2]).toBe('2024-01-10,Retirement,200 tCO2e,$12.50,0xdef456,Verified,"Forest Conservation, Brazil"');
  });

  it("handles missing price or txHash gracefully", () => {
    const minimal: Transaction[] = [
      {
        id: "tx-3",
        date: "2024-02-01",
        type: "Sale",
        amount: "100 tCO2e",
        status: "Pending",
        description: "Direct sale",
      },
    ];
    const csv = generateTransactionsCSV(minimal);
    const lines = csv.split("\n");
    expect(lines[1]).toBe("2024-02-01,Sale,100 tCO2e,N/A,tx-3,Pending,Direct sale");
  });
});
