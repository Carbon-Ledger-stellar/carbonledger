'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function ProjectNotFound() {
  const pathname = usePathname();
  const projectId = pathname?.split('/').filter(Boolean).pop();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">
        404
      </p>
      <h1 className="mt-2 text-3xl font-bold text-gray-900">
        Project not found
      </h1>
      <p className="mt-4 max-w-md text-base text-gray-600">
        {projectId
          ? `We couldn't find a project with the ID "${projectId}". It may have been removed or the link may be incorrect.`
          : "We couldn't find the project you're looking for. It may have been removed or the link may be incorrect."}
      </p>
      <Link
        href="/marketplace"
        className="mt-8 inline-flex items-center rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        Back to marketplace
      </Link>
    </div>
  );
}
