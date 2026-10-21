'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { ProjectCard } from '@/components/verifier/ProjectCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { VerifierProject } from '@/types/verifier';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

interface VerifierDashboardProps {
  projects: VerifierProject[];
}

function parseStatus(value: string | null): StatusFilter {
  if (value === 'pending' || value === 'approved' || value === 'rejected') {
    return value;
  }
  return 'all';
}

export function VerifierDashboard({ projects }: VerifierDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const status = parseStatus(searchParams.get('status'));
  const methodology = searchParams.get('methodology') ?? 'all';
  const [search, setSearch] = useState(searchParams.get('q') ?? '');

  const methodologies = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((project) => {
      if (project.methodology) {
        set.add(project.methodology);
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [projects]);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (!value || value === 'all') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (current !== search) {
      const timeout = setTimeout(() => updateParams({ q: search || null }), 300);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [search, searchParams, updateParams]);

  const filteredProjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter((project) => {
      if (status !== 'all' && project.status !== status) {
        return false;
      }
      if (methodology !== 'all' && project.methodology !== methodology) {
        return false;
      }
      if (term) {
        const haystack = `${project.name ?? ''} ${project.methodology ?? ''}`.toLowerCase();
        if (!haystack.includes(term)) {
          return false;
        }
      }
      return true;
    });
  }, [projects, status, methodology, search]);

  const hasActiveFilters =
    status !== 'all' || methodology !== 'all' || search.trim().length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <Select
            value={status}
            onValueChange={(value) => updateParams({ status: value })}
          >
            <SelectTrigger className="sm:w-48" aria-label="Filter by status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={methodology}
            onValueChange={(value) => updateParams({ methodology: value })}
          >
            <SelectTrigger className="sm:w-56" aria-label="Filter by methodology">
              <SelectValue placeholder="Methodology" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All methodologies</SelectItem>
              {methodologies.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects"
            className="sm:max-w-xs"
            aria-label="Search projects"
          />
        </div>

        {hasActiveFilters ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              updateParams({ status: null, methodology: null, q: null });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {filteredProjects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No projects match the selected filters.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
