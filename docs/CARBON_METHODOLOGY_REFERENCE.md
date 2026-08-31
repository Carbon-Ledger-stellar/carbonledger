# Carbon Methodology Reference

## Overview
This document defines the methodology scoring system for carbon credit projects and provides a reference for supported carbon accounting methodologies, their scoring criteria, and how they map to CarbonLedger contract parameters.

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

## Methodology Score

### Purpose
The methodology score ensures that only high-quality carbon projects receive credits. Projects must meet a minimum score threshold to be eligible for credit minting.

### Minimum Score Requirement