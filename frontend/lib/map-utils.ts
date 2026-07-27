import { CarbonProject, MarketListing } from "./api";

/**
 * A single map-ready pin: one marketplace listing joined with its
 * project's coordinates and metadata. Built client-side because
 * GET /marketplace/listings does not include project.coordinates
 * (see joinListingsWithProjects below for details).
 */
export interface MapPin {
  listingId: string;
  projectId: string;
  projectName: string;
  lat: number;
  lng: number;
  vintageYear: number;
  methodologyScore: number;
  amountAvailable: number;
  projectType: string;
  methodology: string;
  country: string;
}

/**
 * Pin color, keyed by projectType (REDD+, Blue Carbon, Improved
 * Cookstoves, Reforestation, etc.) — NOT by methodology (VCS, Gold
 * Standard, ACR, CAR), which is a different field in this codebase.
 * The GrantFox issue's examples ("REDD+", "Blue Carbon") are actually
 * projectType values here, so pins are colored by that field.
 * Modeled on the existing `methodologyColors` map in CreditCard.tsx.
 */
export const projectTypeColors: Record<string, string> = {
  "REDD+": "#16a34a",
  "Blue Carbon": "#0891b2",
  "Reforestation": "#65a30d",
  "Renewable Energy": "#eab308",
  "Methane Capture": "#f97316",
  "Soil Carbon": "#a16207",
  "Energy Efficiency": "#7c3aed",
  "Improved Cookstoves": "#db2777",
};

export const DEFAULT_PIN_COLOR = "#6b7280";

export function getProjectTypeColor(projectType: string): string {
  return projectTypeColors[projectType] ?? DEFAULT_PIN_COLOR;
}

export interface JoinResult {
  pins: MapPin[];
  /** Listings whose project has no usable coordinates, or whose project wasn't found in the fetched project set. */
  missingCoordinatesCount: number;
}

/**
 * Join marketplace listings with project coordinates.
 *
 * Why this join exists: GET /marketplace/listings returns MarketListing
 * rows with no project relation included, so coordinates never reach the
 * marketplace UI even though MarketListing.project -> CarbonProject.coordinates
 * exists in the schema. Rather than changing the backend response, the
 * marketplace page fetches projects separately (useProjectsForMap) and
 * joins them here by projectId.
 *
 * Listings whose project has no coordinates (e.g. registered before
 * coordinates were required) or whose project isn't present in the
 * fetched project set are excluded from `pins` and counted in
 * `missingCoordinatesCount` so the UI can surface that some listings
 * aren't mapped rather than silently dropping them with no explanation.
 */
export function joinListingsWithProjects(
  listings: MarketListing[],
  projects: CarbonProject[]
): JoinResult {
  const projectById = new Map(projects.map((p) => [p.projectId, p]));
  const pins: MapPin[] = [];
  let missingCoordinatesCount = 0;

  for (const listing of listings) {
    const project = projectById.get(listing.projectId);
    const coords = project?.coordinates;

    if (!project || !coords || typeof coords.lat !== "number" || typeof coords.lng !== "number") {
      missingCoordinatesCount++;
      continue;
    }

    pins.push({
      listingId: listing.listingId,
      projectId: listing.projectId,
      projectName: listing.projectName || project.name || listing.projectId,
      lat: coords.lat,
      lng: coords.lng,
      vintageYear: listing.vintageYear,
      methodologyScore: project.methodologyScore,
      amountAvailable: listing.amountAvailable,
      projectType: project.projectType,
      methodology: listing.methodology,
      country: listing.country,
    });
  }

  return { pins, missingCoordinatesCount };
}
