# Methodology Scoring Rubric

## Overview
All carbon projects registered on CarbonLedger must achieve a minimum score of **70 out of 100** on the methodology assessment. Projects scoring below 70 are automatically rejected during registration.

## Scoring Framework

Projects are evaluated across five key dimensions:

### 1. Additionality (0-30 points)

The project must demonstrate that carbon removal/avoidance would not have occurred without the carbon credit financing.

**Excellent (25-30):**
- Clear financial additionality demonstrated with third-party validation
- Technology or approach is innovative and not widely adopted
- Strong counterfactual analysis showing no alternative revenue streams
- Independent audit of additionality claims

**Good (20-24):**
- Demonstrated financial barriers partially overcome by carbon revenue
- Some innovation but with established precedents
- Basic counterfactual analysis provided
- Internal verification of additionality

**Fair (15-19):**
- Minimal additionality; project likely viable without carbon revenue
- Conventional approach with limited innovation
- Weak or no counterfactual analysis
- Reliance on common practice baselines

**Poor (0-14):**
- No demonstrable additionality
- Business-as-usual activities
- Cannot pass regulatory additionality standards (e.g., CDM, VCS)

### 2. Quantification & Monitoring (0-25 points)

Rigorous measurement, reporting, and verification of carbon impacts.

**Excellent (22-25):**
- High-precision quantification using multiple independent methods
- Continuous monitoring with real-time data feeds
- Satellite/GIS verification with Planet Labs or similar
- Uncertainty quantification < 10%
- Third-party verification (e.g., Verra, Gold Standard)

**Good (17-21):**
- Robust quantification using established methodologies
- Periodic monitoring with field sampling
- Satellite imagery verification
- Uncertainty quantification 10-20%
- Independent third-party verification

**Fair (12-16):**
- Standard quantification using published methodologies
- Annual or biennial monitoring
- Basic satellite data usage
- Uncertainty quantification 20-30%
- Limited verification history

**Poor (0-11):**
- Ad-hoc or inconsistent quantification
- No systematic monitoring
- No satellite verification
- Uncertainty > 30%
- Self-reported claims only

### 3. Permanence & Risk Management (0-20 points)

Strategies to ensure long-term carbon storage and manage reversal risks.

**Excellent (17-20):**
- 100+ year permanence or equivalent buffer pool contributions
- Comprehensive risk mitigation (fire, disease, climate change)
- Buffer reserve ≥ 20% of total credits issued
- Insurance or financial mechanisms for reversals
- Regular risk assessments with adaptive management

**Good (14-16):**
- 50+ year permanence or significant buffer pool
- Documented risk mitigation strategies
- Buffer reserve 10-20%
- Planned insurance/financial mechanisms
- Periodic risk assessments

**Fair (10-13):**
- 10-50 year permanence with buffer pool
- Basic risk mitigation identified
- Buffer reserve 5-10%
- Ad-hoc risk management
- Limited assessment frequency

**Poor (0-9):**
- Temporary storage only (< 10 years)
- No documented risk mitigation
- No buffer pool
- No insurance or financial backing
- No formal risk assessment

### 4. Leakage & Co-Benefits (0-15 points)

Addressing potential displacement of emissions and delivering additional benefits.

**Excellent (13-15):**
- Comprehensive leakage analysis with mitigation
- Quantified and verified beyond-carbon co-benefits
- UN SDG alignment with 5+ goals
- Strong community engagement and benefit-sharing
- Positive biodiversity impact

**Good (10-12):**
- Documented leakage assessment
- Verified co-benefits in 2-3 areas
- UN SDG alignment with 3-4 goals
- Community consultation documented
- Neutral or positive biodiversity impact

**Fair (7-9):**
- Basic leakage considerations
- Noted co-benefits without full verification
- UN SDG alignment with 1-2 goals
- Limited community engagement
- Mixed biodiversity impact

**Poor (0-6):**
- No leakage analysis
- No verified co-benefits
- No SDG alignment
- No community engagement
- Negative biodiversity impact

### 5. Governance & Transparency (0-10 points)

Project governance, stakeholder engagement, and data transparency.

**Excellent (9-10):**
- Independent governance board with stakeholders
- 100% transparent data (on-chain + public documentation)
- Regular independent audits
- Clear grievance mechanisms
- Full supply chain traceability

**Good (7-8):**
- Multi-stakeholder governance structure
- Public documentation of all claims
- Annual independent audits
- Documented grievance process
- Good supply chain visibility

**Fair (5-6):**
- Basic governance structure
- Selective data disclosure
- Biennial audits
- Informal grievance handling
- Limited supply chain visibility

**Poor (0-4):**
- No formal governance
- Opaque data and claims
- No independent audits
- No grievance mechanism
- Opaque supply chain

## Scoring Methodology

### Total Score Calculation
```
Total Score = Additionality + Quantification + Permanence + Leakage + Governance
```

### Thresholds
- **90-100:** Exceptional (Premium tier pricing)
- **80-89:** Strong (Standard tier)
- **70-79:** Acceptable (Entry tier) ← Minimum threshold for registration
- **<70:** Rejected

### Registration Process
1. Developer submits project with self-assessment score
2. Oracle satellite monitoring verifies key quantifications
3. Independent verifier validates full assessment
4. On-chain registration requires score ≥ 70
5. Score stored immutably with project record
6. Annual reassessment required, score updates on-chain

## Implementation on CarbonLedger

### Smart Contract Enforcement
- `carbon_registry::register_project()` validates `methodology_score >= 70`
- Rejection with clear error if threshold not met
- Score stored in `CarbonProject` struct permanently

### Oracle Verification
- Satellite monitoring (Planet Labs / Google Earth Engine) validates quantification
- Oracle submits `methodology_score` with each monitoring period
- On-chain warning event if score drops below 70 after registration

### Frontend Display
- Score prominently displayed on project detail page
- Color-coded badge: Green (≥80), Yellow (70-79), Red (<70)
- Full rubric available in project documentation

## Appeals & Reassessment

Projects may appeal scoring decisions with:
1. Additional documentation/evidence
2. Third-party expert review
3. On-chain vote by staked verifiers
4. Updated score after 90-day period

Reassessment triggers:
- Annual review (automatic)
- Significant project modifications
- Monitoring data indicating score degradation
- Stakeholder petition with 500+ signed verifications

## Version History

- **v1.0** (April 2026): Initial rubric based on VCS, Gold Standard, and CDM methodologies