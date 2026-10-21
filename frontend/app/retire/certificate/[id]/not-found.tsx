import Link from "next/link";

export default function CertificateNotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold">Certificate not found</h1>
      <p className="text-muted-foreground">
        We couldn&apos;t find a retirement certificate for this link. It may have
        been removed or the URL may be incorrect.
      </p>
      <Link
        href="/retire"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Back to retirement
      </Link>
    </main>
  );
}
