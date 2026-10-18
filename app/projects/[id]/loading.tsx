import LoadingSkeleton from "@/components/LoadingSkeleton";

export default function ProjectDetailLoading() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <LoadingSkeleton variant="text" width="40%" height="2rem" />
      </div>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <LoadingSkeleton variant="text" width="60%" height="1.5rem" />
          <LoadingSkeleton variant="text" width="30%" height="1rem" />
        </div>
        <LoadingSkeleton variant="rect" width="8rem" height="2.5rem" />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="md:col-span-2 flex flex-col gap-4">
          <LoadingSkeleton variant="rect" width="100%" height="12rem" />
          <LoadingSkeleton variant="text" width="100%" height="1rem" />
          <LoadingSkeleton variant="text" width="90%" height="1rem" />
          <LoadingSkeleton variant="text" width="80%" height="1rem" />
        </div>

        <div className="flex flex-col gap-4">
          <LoadingSkeleton variant="rect" width="100%" height="6rem" />
          <LoadingSkeleton variant="rect" width="100%" height="6rem" />
          <LoadingSkeleton variant="rect" width="100%" height="6rem" />
        </div>
      </div>
    </div>
  );
}
