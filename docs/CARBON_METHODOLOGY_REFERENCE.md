# Carbon Methodology Reference

## Overview
This document defines the methodology scoring system for carbon credit projects.

## Methodology Score

### Purpose
The methodology score ensures that only high-quality carbon projects receive credits. Projects must meet a minimum score threshold to be eligible for credit minting.

### Minimum Score Requirement
pub enum CarbonError {
    // ... other errors ...
    MethodologyScoreLow = 20,
}
{
  "error": "MethodologyScoreLow",
  "code": 20,
  "message": "Project methodology score is below the minimum threshold of 70",
  "details": {
    "project_id": 123,
    "current_score": 65,
    "minimum_score": 70
  }
}
EOF 
