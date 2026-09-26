/**
 * Maps a project's `projectType` to a static cover icon under
 * /public/images/project-types. Several project types share an icon —
 * there's no per-type artwork yet, just a representative category glyph.
 */
const ICON_BY_TYPE: Record<string, string> = {
  "Reforestation": "tree",
  "Agroforestry": "tree",
  "Forest Conservation": "tree",
  "Soil Carbon": "tree",
  "Renewable Energy": "turbine",
  "Direct Air Capture": "factory",
  "Methane Capture": "factory",
  "Waste to Energy": "factory",
  "Blue Carbon": "wave",
};

const DEFAULT_ICON = "tree";

export function projectTypeIconUrl(projectType: string): string {
  const icon = ICON_BY_TYPE[projectType] ?? DEFAULT_ICON;
  return `/images/project-types/${icon}.svg`;
}
