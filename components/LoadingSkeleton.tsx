import React from "react";

type SkeletonProps = {
  className?: string;
};

/**
 * A single skeleton block. Compose these to mirror the layout of the
 * content that is loading so the page does not shift when data resolves.
 */
export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-gray-200 dark:bg-gray-700 ${className}`}
    />
  );
}

type LoadingSkeletonProps = {
  /**
   * Optional layout preset. "project-detail" mirrors the ProjectDetail
   * page structure (header, meta row, description, and content sections).
   */
  variant?: "default" | "project-detail";
  className?: string;
};

/**
 * Route-level loading placeholder built from Skeleton blocks.
 * Used by app/projects/[id]/loading.tsx to avoid a blank page and
 * prevent layout shift while project data resolves.
 */
export default function LoadingSkeleton({
  variant = "default",
  className = "",
}: LoadingSkeletonProps) {
  if (variant === "project-detail") {
    return (
      <div
        role="status"
        aria-label="Loading project"
        className={`mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8 ${className}`}
      >
        <span className="sr-only">Loading project…</span>

        {/* Header: title + action buttons */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-3">
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>

        {/* Meta row: status, owner, dates */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>

        {/* Description block */}
        <div className="mt-8 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>

        {/* Content sections */}
        <div className="mt-8 space-y-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-label="Loading"
      className={`space-y-4 ${className}`}
    >
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
