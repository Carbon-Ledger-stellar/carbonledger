export const CarbonErrorMessages: Record<number, string> = {
  1:  "Project already exists.",
  2:  "Project not found.",
  3:  "Unauthorized verifier.",
  4:  "Unauthorized oracle.",
  5:  "Invalid serial range.",
  6:  "Insufficient credits.",
  7:  "Zero amount not allowed.",
  8:  "Unauthorized upgrade.",
  9:  "Invalid vintage year.",
  10: "Project not verified.",
  11: "Methodology score too low.",
  12: "Arithmetic error occurred.",
};

export function getCarbonErrorMessage(error: any): string | null {
  if (!error) return null;
  
  // Handle cases where the error message contains the code, e.g., "CarbonError(1)" or "Error: 1"
  const match = error.toString().match(/CarbonError\((\d+)\)/) || error.toString().match(/Error: (\d+)/);
  if (match) {
    const code = parseInt(match[1]);
    return CarbonErrorMessages[code] || `On-chain error code: ${code}`;
  }

  // If the error message is just a number
  if (!isNaN(parseInt(error))) {
    return CarbonErrorMessages[parseInt(error)] || `On-chain error code: ${error}`;
  }

  return null;
}
