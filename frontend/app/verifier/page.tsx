'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const STATUS_OPTIONS = ['pending', 'approved', 'rejected'] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number] | 'all';

const METHODOLOGY_OPTIONS = ['all', 'reforestation', 'renewable-energy', 'conservation', 'carbon-capture'] as const;
type MethodologyFilter = (typeof METHODOLOGY_OPTIONS)[number];

interface VerifierProject {
  id: string;
  name: string;
  status: 'pending' | 'approved' | 'rejected';
  methodology: string;
}

interface VerifierDashboardProps {
  projects: VerifierProject[];
}

function isStatusFilter(value: string | null): value is StatusFilter {
  return value === 'all' || (value !== null && (STATUS_OPTIONS as readonly string[]).includes(value));
}

function isMethodologyFilter(value: string | null): value is MethodologyFilter {
  return value !== null && (METHODOLOGY_OPTIONS as readonly string[]).includes(value);
}

export default function VerifierDashboard({ projects }: VerifierDashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const statusParam = searchParams.get('status');
  const methodologyParam = searchParams.get('methodology');

  const [status, setStatus] = useState<StatusFilter>(isStatusFilter(statusParam) ? statusParam : 'all');
  const [methodology, setMethodology] = useState<MethodologyFilter>(
    isMethodologyFilter(methodologyParam) ? methodologyParam : 'all'
  );

  useEffect(() => {
    setStatus(isStatusFilter(statusParam) ? statusParam : 'all');
    setMethodology(isMethodologyFilter(methodologyParam) ? methodologyParam : 'all');
  }, [statusParam, methodologyParam]);

  const updateFilters = (nextStatus: StatusFilter, nextMethodology: MethodologyFilter) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextStatus === 'all') {
      params.delete('status');
    } else {
      params.set('status', nextStatus);
    }
    if (nextMethodology === 'all') {
      params.delete('methodology');
    } else {
      params.set('methodology', nextMethodology);
    }
    const query = params.toString();
    router.replace(query ? `/verifier?${query}` : '/verifier', { scroll: false });
  };

  const handleStatusChange = (value: StatusFilter) => {
    setStatus(value);
    updateFilters(value, methodology);
  };

  const handleMethodologyChange = (value: MethodologyFilter) => {
    setMethodology(value);
    updateFilters(status, value);
  };

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      const matchesStatus = status === 'all' || project.status === status;
      const matchesMethodology = methodology === 'all' || project.methodology === methodology;
      return matchesStatus && matchesMethodology;
    });
  }, [projects, status, methodology]);

  return (
    <div className="verifier-dashboard">
      <div className="verifier-filters">
        <label htmlFor="status-filter">Status</label>
        <select
          id="status-filter"
          value={status}
          onChange={(event) => handleStatusChange(event.target.value as StatusFilter)}
        >
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option.charAt(0).toUpperCase() + option.slice(1)}
            </option>
          ))}
        </select>

        <label htmlFor="methodology-filter">Methodology</label>
        <select
          id="methodology-filter"
          value={methodology}
          onChange={(event) => handleMethodologyChange(event.target.value as MethodologyFilter)}
        >
          {METHODOLOGY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === 'all' ? 'All methodologies' : option}
            </option>
          ))}
        </select>
      </div>

      {filteredProjects.length === 0 ? (
        <p className="verifier-empty">No projects match the selected filters.</p>
      ) : (
        <ul className="verifier-projects">
          {filteredProjects.map((project) => (
            <li key={project.id} className="verifier-project">
              <span className="verifier-project-name">{project.name}</span>
              <span className="verifier-project-status">{project.status}</span>
              <span className="verifier-project-methodology">{project.methodology}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
