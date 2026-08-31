export interface ProvenanceTrail {
  status: 'issued' | 'transferred' | 'retired';
  description: string;
  timestamp: string;
  transactionHash?: string;
  amount?: number;
  from?: string;
  to?: string;
}

export interface SearchResult {
  serialNumber: string;
  projectId: string;
  projectName: string;
  vintageYear: number;
  amount: number;
  status: 'Active' | 'Retired' | 'Suspended';
  issuanceDate: string;
  retirementDate?: string;
  provenance: ProvenanceTrail[];
  retirementCertificate?: {
    id: string;
    beneficiary: string;
    reason?: string;
  };
}
