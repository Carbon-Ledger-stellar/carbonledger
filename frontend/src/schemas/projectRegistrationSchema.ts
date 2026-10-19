import { z } from "zod";

/**
 * Shared validation schema for project registration.
 * Mirrors the backend ProjectRegistration DTO rules and the
 * vintage-year-validation-spec.md requirements for vintage year and coordinates.
 */

const MIN_VINTAGE_YEAR = 1990;
const MAX_VINTAGE_YEAR = new Date().getFullYear() + 1;

const vintageYearSchema = z
  .number({
    required_error: "Vintage year is required",
    invalid_type_error: "Vintage year must be a number",
  })
  .int("Vintage year must be a whole number")
  .min(MIN_VINTAGE_YEAR, `Vintage year must be ${MIN_VINTAGE_YEAR} or later`)
  .max(MAX_VINTAGE_YEAR, `Vintage year must be ${MAX_VINTAGE_YEAR} or earlier`);

const latitudeSchema = z
  .number({
    required_error: "Latitude is required",
    invalid_type_error: "Latitude must be a number",
  })
  .min(-90, "Latitude must be between -90 and 90")
  .max(90, "Latitude must be between -90 and 90");

const longitudeSchema = z
  .number({
    required_error: "Longitude is required",
    invalid_type_error: "Longitude must be a number",
  })
  .min(-180, "Longitude must be between -180 and 180")
  .max(180, "Longitude must be between -180 and 180");

export const projectRegistrationSchema = z.object({
  projectName: z
    .string({ required_error: "Project name is required" })
    .trim()
    .min(1, "Project name is required")
    .max(200, "Project name must be 200 characters or fewer"),
  description: z
    .string({ required_error: "Description is required" })
    .trim()
    .min(1, "Description is required")
    .max(2000, "Description must be 2000 characters or fewer"),
  country: z
    .string({ required_error: "Country is required" })
    .trim()
    .min(1, "Country is required"),
  region: z.string().trim().max(200, "Region must be 200 characters or fewer").optional(),
  vintageYear: vintageYearSchema,
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  areaHectares: z
    .number({ invalid_type_error: "Area must be a number" })
    .positive("Area must be greater than zero")
    .optional(),
});

export type ProjectRegistrationFormValues = z.infer<typeof projectRegistrationSchema>;

export const projectRegistrationDefaults: Partial<ProjectRegistrationFormValues> = {
  projectName: "",
  description: "",
  country: "",
  region: "",
};
