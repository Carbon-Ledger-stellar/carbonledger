import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <span className="text-6xl font-bold tracking-tight">404</span>
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The page you are looking for does not exist or the project you are
          trying to view could not be found.
        </p>
      </div>
      <Link
        href="/marketplace"
        className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Back to Marketplace
      </Link>
    </main>
  );
}
