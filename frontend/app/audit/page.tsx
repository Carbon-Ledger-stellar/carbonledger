'use client';

import { useState } from 'react';
import type { SearchResult, ProvenanceTrail } from '@/types/audit';

export default function AuditPage() {
  const [searchType, setSearchType] = useState<'serial' | 'project' | 'retirement'>('serial');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTerm.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Call your backend API (no wallet required)
      const response = await fetch(`/api/audit/search?type=${searchType}&q=${encodeURIComponent(searchTerm)}`);
      
      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }
      
      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Carbon Credit Audit Explorer
          </h1>
          <p className="text-xl text-gray-600">
            Search credits by serial number, project ID, or retirement certificate ID
          </p>
          <p className="text-sm text-gray-500 mt-2">
            🔓 No wallet required - Public audit trail for regulators, journalists, and the public
          </p>
        </div>

        {/* Search Form */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <select
                value={searchType}
                onChange={(e) => setSearchType(e.target.value as any)}
                className="px-4 py-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
              >
                <option value="serial">Serial Number</option>
                <option value="project">Project ID</option>
                <option value="retirement">Retirement Certificate ID</option>
              </select>
              
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={`Enter ${searchType}...`}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                required
              />
              
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Searching...' : 'Search'}
              </button>
            </div>
          </form>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
            <p className="mt-2 text-gray-600">Searching carbon credit records...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* Credit Details */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Credit Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InfoRow label="Serial Number" value={result.serialNumber} />
                <InfoRow label="Project ID" value={result.projectId} />
                <InfoRow label="Project Name" value={result.projectName} />
                <InfoRow label="Vintage Year" value={result.vintageYear} />
                <InfoRow label="Amount" value={`${result.amount} tonnes CO₂`} />
                <InfoRow label="Status" value={result.status} highlight={result.status === 'Retired'} />
                <InfoRow label="Issuance Date" value={new Date(result.issuanceDate).toLocaleDateString()} />
                {result.retirementDate && (
                  <InfoRow label="Retirement Date" value={new Date(result.retirementDate).toLocaleDateString()} />
                )}
              </div>
            </div>

            {/* Provenance Trail */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Provenance Trail</h2>
              <div className="space-y-4">
                {result.provenance.map((step, index) => (
                  <ProvenanceStep key={index} step={step} index={index} />
                ))}
              </div>
            </div>

            {/* Retirement Certificate (if retired) */}
            {result.retirementCertificate && (
              <div className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">Retirement Certificate</h2>
                <div className="border border-gray-200 rounded-lg p-4">
                  <p className="text-sm text-gray-600 mb-2">Certificate ID: {result.retirementCertificate.id}</p>
                  <p className="text-sm text-gray-600 mb-4">
                    Beneficiary: {result.retirementCertificate.beneficiary}
                  </p>
                  <a
                    href={`/api/audit/certificate/${result.retirementCertificate.id}`}
                    download
                    className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  >
                    📄 Download Certificate (PDF)
                  </a>
                  <p className="text-xs text-gray-500 mt-2">
                    This certificate is permanently verifiable on-chain
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Help Section */}
        {!result && !loading && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-8">
            <h3 className="text-lg font-semibold text-blue-900 mb-2">How to use the audit explorer</h3>
            <ul className="space-y-2 text-blue-800">
              <li>• <strong>Serial Number:</strong> Format example: CRB-2024-001-12345</li>
              <li>• <strong>Project ID:</strong> The unique identifier assigned to each carbon project</li>
              <li>• <strong>Retirement Certificate ID:</strong> Appears on retirement certificates after credits are retired</li>
            </ul>
            <p className="mt-4 text-sm text-blue-700">
              All data is sourced directly from the Stellar blockchain and verified by our oracle network.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="border-b border-gray-100 pb-2">
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className={`mt-1 text-lg ${highlight ? 'text-green-600 font-semibold' : 'text-gray-900'}`}>
        {value}
      </dd>
    </div>
  );
}

function ProvenanceStep({ step, index }: { step: ProvenanceTrail; index: number }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'issued': return 'bg-green-100 text-green-800 border-green-200';
      case 'transferred': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'retired': return 'bg-purple-100 text-purple-800 border-purple-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className={`border-l-4 p-4 rounded-r-lg ${getStatusColor(step.status)}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-gray-500">Step {index + 1}</span>
            <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(step.status)}`}>
              {step.status.toUpperCase()}
            </span>
          </div>
          <p className="text-gray-900">{step.description}</p>
          <p className="text-sm text-gray-500 mt-1">
            {new Date(step.timestamp).toLocaleString()}
          </p>
          {step.transactionHash && (
            <p className="text-xs text-gray-400 mt-1">
              Tx: {step.transactionHash.slice(0, 10)}...{step.transactionHash.slice(-8)}
            </p>
          )}
        </div>
        {step.amount && (
          <div className="text-right">
            <p className="text-sm font-semibold text-gray-900">{step.amount} tonnes</p>
          </div>
        )}
      </div>
    </div>
  );
}