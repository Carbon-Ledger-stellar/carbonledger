# Carbon Methodology Reference

> Supported carbon accounting methodologies, their scoring criteria, and how they map to CarbonLedger contract parameters.

---

## Supported Methodologies

| Code | Standard | Full Name | Project Type | External Reference |
|------|----------|-----------|--------------|-------------------|
| `GS-VER` | Gold Standard | Gold Standard Verified Emission Reductions | Renewable energy, cookstoves, water | [goldstandard.org](https://goldstandard.org) |
| `VCS-REDD+` | Verra VCS | Verified Carbon Standard — REDD+ | Forest protection / avoided deforestation | [verra.org/programs/verified-carbon-standard](https://verra.org/programs/verified-carbon-standard) |
| `ACM0002` | CDM / Verra | Grid-connected electricity from renewables | Solar, wind, hydro | [unfccc.int/methodologies](https://cdm.unfccc.int/methodologies) |
| `VM0007` | Verra VCS | REDD+ Methodology Framework | Reducing deforestation and degradation | [verra.org](https://verra.org) |
| `VM0042` | Verra VCS | Improved Agricultural Land Management | Soil carbon sequestration | [verra.org](https://verra.org) |
| `GS-TPDDTEC` | Gold Standard | Technologies and Practices to Displace Decentralized Thermal Energy Consumption | Efficient cookstoves | [goldstandard.org](https://goldstandard.org) |
| `CAR-FOREST` | Climate Action Reserve | U.S. Forest Project Protocol | Reforestation / improved forest management | [climateactionreserve.org](https://www.climateactionreserve.org) |
| `ACR-WETLAND` | American Carbon Registry | Restoration of Pocosin Wetlands | Wetland restoration | [americancarbonregistry.org](https://americancarbonregistry.org) |

The `methodology` field in contracts accepts any non-empty string up to 64 characters. The values above are the recommended canonical codes.

---

## Methodology Score (0–100)

Each project is assigned a `methodology_score` at registration and updated with each monitoring submission. The score reflects the quality, rigor, and verifiability of the carbon accounting methodology used.

### Scoring Rubric

| Dimension | Max Points | Description |
|-----------|-----------|-------------|
| **Additionality** | 25 | Does the project demonstrate that emission reductions would not have occurred without carbon finance? |
| **Permanence** | 20 | How durable is the sequestration or reduction? (e.g., forests vs. geological storage) |
| **Measurability** | 20 | Can tonnes be quantified with satellite data, IoT sensors, or auditable field measurements? |
| **Leakage control** | 15 | Does the methodology account for emissions displaced to other areas? |
| **Co-benefits** | 10 | Biodiversity, community development, SDG alignment documented? |
| **Third-party verification** | 10 | Is the methodology accredited by Gold Standard, Verra, CDM, CAR, or ACR? |

**Total: 100 points**

### Score Bands

| Score | Band | Meaning |
|-------|------|---------|
| 90–100 | Excellent | Top-tier methodology with full satellite monitoring and accredited verification |
| 70–89 | Acceptable | Meets minimum bar; eligible for credit issuance |
| 50–69 | Below minimum | On-chain warning event emitted; credit issuance blocked |
| 0–49 | Poor | Project should be rejected or suspended |

---

## Minimum Score Rationale

The contracts enforce a **minimum `methodology_score` of 70** in two places:

- `carbon_registry::register_project()` — rejects registration with `CarbonError::MethodologyScoreLow` if score < 70.
- `carbon_oracle::submit_monitoring_data()` — emits a `low_score` warning event if score < 70 (does not block the submission, but flags the project for review).

**Why 70?** A score below 70 indicates at least one critical dimension (additionality, permanence, or measurability) is insufficiently documented. Credits from such projects carry material greenwashing risk and cannot be listed on the marketplace. The 70-point floor aligns with the minimum rigor required by Verra VCS and Gold Standard for third-party validation.

---

## Contract Parameter Mapping

| Contract field | Type | Description |
|----------------|------|-------------|
| `methodology` | `String` (≤ 64 chars) | Canonical methodology code (e.g., `"ACM0002"`) stored on `ProjectData` and `CreditListing` |
| `methodology_score` | `u32` (0–100) | Quality score stored on `ProjectData`; must be ≥ 70 to register or issue credits |
| `vintage_year` | `u32` | Year the emission reduction occurred; used together with `methodology` as the key for benchmark prices in `carbon_oracle` |

Benchmark prices are keyed by `(methodology, vintage_year)` in the oracle contract, allowing price feeds to reflect the market premium or discount applied to different methodology/vintage combinations.

---

## External Standards References

- [Gold Standard — Certification Requirements](https://goldstandard.org/certification)
- [Verra VCS — Program Documents](https://verra.org/programs/verified-carbon-standard/vcs-program-documents/)
- [UNFCCC CDM Methodology Booklet](https://cdm.unfccc.int/methodologies/documentation/meth_booklet.pdf)
- [Climate Action Reserve — Protocols](https://www.climateactionreserve.org/how/protocols/)
- [American Carbon Registry — Standards](https://americancarbonregistry.org/carbon-accounting/standards-methodologies)
