export interface ChecklistItem {
  key: string;
  label: string;
}

const BASE_CHECKLIST: ChecklistItem[] = [
  { key: "documentation_reviewed", label: "Project documentation and monitoring reports have been reviewed in full" },
  { key: "additionality_confirmed", label: "Additionality claim is credible and supported by evidence" },
  { key: "no_double_counting", label: "Credits are not double-counted or double-issued in another registry" },
  { key: "methodology_score_verified", label: "Methodology score breakdown matches the submitted evidence" },
];

const METHODOLOGY_SPECIFIC: Record<string, ChecklistItem[]> = {
  "VCS": [
    { key: "vcs_validation_body", label: "Validation/Verification Body (VVB) report is attached and signed" },
    { key: "vcs_buffer_pool", label: "Non-permanence risk buffer pool contribution has been calculated" },
  ],
  "Gold Standard": [
    { key: "gs_sdg_impact", label: "SDG impact contributions are documented and traceable" },
    { key: "gs_stakeholder_consult", label: "Local stakeholder consultation record is on file" },
  ],
  "ART TREES": [
    { key: "art_jurisdictional_baseline", label: "Jurisdictional REDD+ baseline and leakage belt are documented" },
  ],
  "CDM": [
    { key: "cdm_pdd", label: "Project Design Document (PDD) is registered with the UNFCCC CDM registry" },
  ],
  "Plan Vivo": [
    { key: "pv_community_benefit", label: "Community benefit-sharing plan is documented" },
  ],
};

/** Base checklist plus any methodology-specific items, all required before an attestation can be submitted. */
export function getAttestationChecklist(methodology: string): ChecklistItem[] {
  return [...BASE_CHECKLIST, ...(METHODOLOGY_SPECIFIC[methodology] ?? [])];
}
