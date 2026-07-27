module.exports = {
  colors: {
    surface: "#fff",
    primary: { 200: "#a7f3d0", 600: "#059669", 700: "#047857", 800: "#065f46" },
    neutral: { 50: "#f9fafb", 100: "#f3f4f6", 200: "#e5e7eb", 400: "#9ca3af", 500: "#6b7280", 700: "#374151", 800: "#1f2937", 900: "#111827" },
    verified: { bg: "#d1fae5", text: "#065f46", border: "#6ee7b7" },
    suspended: { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" },
  },
  statusBadge: () => ({ bg: "#e5e7eb", text: "#374151", border: "#d1d5db" }),
};
