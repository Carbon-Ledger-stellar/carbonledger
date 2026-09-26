# Disaster Recovery Testing Schedule

**Version:** 1.0  
**Last Updated:** August 28, 2026  
**Cadence:** Quarterly (every 3 months)

---

## 2026 Testing Schedule

### Q1 Test: Database Failover (January - March)

**Scheduled Window:** 
- **Primary Date:** March 15, 2026, 10:00-12:00 UTC
- **Backup Date:** March 22, 2026, 10:00-12:00 UTC (if primary window unavailable)

**Test Scope:**
- Primary database failure simulation
- Failover to read replica
- RTO measurement: Target < 15 minutes
- RPO measurement: Target < 5 minutes
- Data consistency verification

**Participants:**
- [ ] SRE Lead (Test Coordinator)
- [ ] Database Administrator
- [ ] Backend Engineer (monitoring)
- [ ] On-Call Manager (observer)

**Pre-Test Checklist:**
- [ ] Production traffic diverted to staging region (no real user impact)
- [ ] Backup verified and accessible
- [ ] Failover infrastructure ready
- [ ] Monitoring systems armed for data collection
- [ ] Team members assembled and briefed
- [ ] Status page prepared (internal only)
- [ ] Runbooks reviewed by all participants

**Test Procedure:**

1. **Baseline Documentation (9:50 UTC)**
   - Document database status: connections, transactions, replication lag
   - Capture metrics: CPU, memory, disk I/O
   - Confirm API responding normally

2. **Simulate Failure (10:00 UTC)**
   - Stop primary database services: `service postgresql stop`
   - Alternative: Network isolate: `iptables -I INPUT -p tcp --dport 5432 -j DROP`
   - Record exact failure timestamp

3. **Failover Execution (10:00-10:15 UTC)**
   - Execute failover runbook: `docs/FAILOVER_RUNBOOKS.md#database-failover`
   - Promote read replica to primary
   - Update connection strings
   - Measure RTO continuously

4. **Validation (10:15-10:30 UTC)**
   - Verify data consistency (row counts, checksums)
   - Test API endpoints: GET /health, /projects, /retirements
   - Confirm no data loss or corruption
   - Measure RPO (check last transaction timestamp)

5. **Performance Baseline (10:30-11:00 UTC)**
   - Verify response times normalized
   - Check query performance
   - Confirm cache functionality

6. **Recovery Phase (11:00-11:45 UTC)**
   - Restore primary database
   - Re-establish replication
   - Verify new replica is healthy
   - Confirm master-slave synchronization

7. **Post-Test (11:45-12:00 UTC)**
   - Document all findings
   - Record RTO/RPO actual values
   - Identify any issues
   - Collect team feedback

**Success Criteria:**
- [ ] RTO < 15 minutes (actual measured time)
- [ ] RPO < 5 minutes (data loss measured in transactions)
- [ ] 100% data integrity (no rows lost/corrupted)
- [ ] API responds normally after failover
- [ ] Replication re-established successfully
- [ ] Zero production incidents during test

**Issue Escalation:**
- If RTO > 20 min: PAUSE test, investigate, document findings
- If data integrity issues: STOP test, preserve database state
- If unable to restore: Escalate to VP Engineering

**Report Template:**
```
Q1 2026 Database Failover Test Report

Test Date: March 15, 2026
Duration: 2 hours
Participants: [List]

Results:
- RTO Achieved: [15 min]
- RPO Achieved: [3 min]
- Data Integrity: [100% ✓]
- Issues Found: [0 critical, 1 minor]

RTO Timeline:
- Failure Detection: 10:00 UTC
- Failover Started: 10:00 UTC
- Primary Promoted: 10:04 UTC
- API Recovery: 10:12 UTC
- TOTAL RTO: 12 minutes ✓

Lessons Learned:
1. [Issue 1]: [Resolution]
2. [Issue 2]: [Action item]

Action Items:
- [ ] [Improvement 1]
- [ ] [Improvement 2]
```

---

### Q2 Test: Full System Failover (April - June)

**Scheduled Window:**
- **Primary Date:** June 10, 2026, 18:00-21:00 UTC
- **Backup Date:** June 17, 2026, 18:00-21:00 UTC

**Test Scope:**
- Comprehensive multi-component failover
- Database + Cache + API + Frontend
- Cross-region failover (if applicable)
- Full end-to-end RTO: < 1 hour target
- Communication and incident response procedures

**Participants:**
- [ ] Full SRE team (4-5 people)
- [ ] Incident Commander
- [ ] Database Admin
- [ ] Backend Leads
- [ ] Frontend Lead
- [ ] Product Manager (observer)
- [ ] Communication Lead

**Test Procedure:**

1. **Baseline (17:50 UTC)**
   - All systems confirmed healthy
   - Metrics baseline captured
   - Team briefed and ready

2. **Simulated Cascade Failure (18:00 UTC)**
   - Stop primary database
   - Stop primary Redis node
   - Simulate API pod crash
   - (Staggered 30 seconds apart)

3. **Incident Response (18:00-19:00 UTC)**
   - Declare incident (practice protocols)
   - Identify failures (detection time goal: < 5 min)
   - Initiate failover procedures
   - Execute communication plan
   - Monitor metrics

4. **Recovery Execution (19:00-20:00 UTC)**
   - Database failover: target 15 min
   - Cache recovery: target 5 min
   - API failover: target 10 min
   - Frontend validation: target 5 min
   - Cumulative RTO target: < 1 hour

5. **System Validation (20:00-20:30 UTC)**
   - Full health check suite
   - Data consistency
   - Functional verification (critical journeys)
   - Performance baseline

6. **Post-Incident Procedures (20:30-20:45 UTC)**
   - Incident declared resolved
   - Status page updated
   - RCA process started (simulated)
   - Initial findings documented

7. **Restoration (20:45-21:00 UTC)**
   - Bring down replica infrastructure
   - Restore primary components
   - Re-establish replication/clustering

**Success Criteria:**
- [ ] RTO < 1 hour (actual measured)
- [ ] All components recovered
- [ ] Data integrity maintained
- [ ] Team communication effective
- [ ] Incident response procedures validated
- [ ] MTTR continues to improve

---

### Q3 Test: Data Integrity & PITR (July - September)

**Scheduled Window:**
- **Primary Date:** September 5, 2026, 02:00-04:30 UTC
- **Backup Date:** September 12, 2026, 02:00-04:30 UTC

**Test Scope:**
- Point-in-time recovery (PITR)
- Backup restoration from oldest backup in retention window
- Data validation at specific time points
- Incremental recovery procedures
- RPO verification

**Participants:**
- [ ] Database Administrator (lead)
- [ ] SRE Team (2-3)
- [ ] Backend Engineer
- [ ] Data team (if applicable)

**Test Procedure:**

1. **Preparation (01:50 UTC)**
   - Identify a historical time point (3 days ago)
   - Document expected state at that time
   - Retrieve backup and WAL files
   - Verify all assets accessible

2. **Restoration Start (02:00 UTC)**
   - Begin PITR process
   - Target recovery time: T-3 days (72 hours ago)
   - Measure: time-to-restore
   - Expected time: 30-45 minutes

3. **PITR Execution (02:00-02:45 UTC)**
   - Extract full backup
   - Apply WAL archive up to target timestamp
   - Monitor for errors
   - Verify recovery completeness

4. **Data Validation (02:45-03:30 UTC)**
   - Compare recovered database to backup records
   - Verify transaction log consistency
   - Check for any gaps or anomalies
   - Validate audit trails
   - Measure data as-of time accuracy

5. **Verification Queries (03:30-04:00 UTC)**
   - Expected transaction count at time T
   - Verify no "future" transactions in recovered database
   - Check specific record states
   - Validate foreign key constraints
   - Confirm soft-delete flags

6. **Documentation (04:00-04:30 UTC)**
   - Record all findings
   - Document PITR effectiveness
   - Confirm RPO within targets
   - Note any discrepancies

**Success Criteria:**
- [ ] PITR completes within 45 minutes
- [ ] 100% data integrity at target time
- [ ] No transactions exist after target time
- [ ] All constraints valid
- [ ] Audit log complete and accurate

---

### Q4 Test: Full Production Simulation (October - December)

**Scheduled Window:**
- **Primary Date:** December 8, 2026, 22:00 UTC - December 9, 2026, 02:00 UTC
- **Backup Date:** December 15, 2026, 22:00 UTC - December 16, 2026, 02:00 UTC

**Test Scope:**
- Comprehensive annual disaster recovery test
- Full production environment replication
- Multi-region failover (if applicable)
- Complete incident response workflow
- Communication drills
- All recovery procedures validated

**Participants:**
- [ ] Full engineering team (10+ people)
- [ ] Product team (observers)
- [ ] Operations
- [ ] Customer support (observer)
- [ ] Executives (briefing only)

**Test Procedure:**

1. **Pre-Test Briefing (21:30 UTC)**
   - Review previous quarter findings
   - Explain test scenario
   - Assign roles and responsibilities
   - Answer questions

2. **Environment Setup (21:45 UTC)**
   - Clone production database to test environment
   - Prepare failover infrastructure
   - Verify all monitoring tools active
   - Confirm communication channels ready

3. **Failure Simulation (22:00 UTC)**
   - Multi-point failure scenario (to be determined)
   - Example: Primary datacenter becomes inaccessible
   - Cascade failures: DB → Cache → Network
   - Verify detection systems working

4. **Incident Response (22:00-23:30 UTC)**
   - Incident declared
   - Response procedures activated
   - Communication cadence: updates every 15 min
   - Status page updated
   - Executive briefing template used

5. **Failover & Recovery (23:30-01:30 UTC)**
   - Execute all failover procedures
   - Multi-component coordination
   - Validate recovery effectiveness
   - Measure aggregate RTO
   - Track all metrics

6. **System Validation (01:30-02:00 UTC)**
   - Full end-to-end testing
   - User journey verification
   - Performance validation
   - Data integrity check

**Success Criteria:**
- [ ] Aggregate RTO < 1 hour
- [ ] All procedures validated
- [ ] Team coordination effective
- [ ] No data loss
- [ ] Performance acceptable

**Post-Test Outcomes:**
- Full written report with all findings
- Action items for next year
- Procedure updates documented
- Team retrospective
- Executive summary for leadership

---

## Test Management & Scheduling

### Calendar Integration

```
2026 DR Testing Schedule

Q1: Database Failover          | March 15, 2026
Q2: Full System Failover       | June 10, 2026
Q3: Data Integrity & PITR      | September 5, 2026
Q4: Full Production Simulation | December 8, 2026

Reserve Dates (if needed):
Q1 Backup: March 22, 2026
Q2 Backup: June 17, 2026
Q3 Backup: September 12, 2026
Q4 Backup: December 15, 2026
```

### Notification & Coordination

**6 Weeks Before Test:**
- [ ] Send "Save the Date" to all stakeholders
- [ ] Reserve infrastructure/team time
- [ ] Begin preparing test scenarios

**2 Weeks Before Test:**
- [ ] Send detailed agenda and runbooks
- [ ] Confirm participant availability
- [ ] Run pre-test walkthrough (1 hour)
- [ ] Update documentation as needed

**1 Week Before Test:**
- [ ] Final walkthrough with all participants
- [ ] Confirm infrastructure readiness
- [ ] Verify monitoring tools
- [ ] Review communication procedures

**Day Before Test:**
- [ ] Final confirmation from all parties
- [ ] Verify test environment status
- [ ] Confirm on-call rotation coverage
- [ ] Brief stakeholders on test window

---

## Metrics Collection & Tracking

### Key Metrics per Test

```
Database Failover Test (Q1):
├─ Detection Time: [Target: < 5 min]
├─ RTO: [Target: < 15 min]
├─ RPO: [Target: < 5 min]
├─ Data Integrity Score: [Target: 100%]
└─ Team Readiness: [Feedback form]

Full System Failover (Q2):
├─ Detection Time: [Target: < 5 min]
├─ Component RTO:
│  ├─ Database: < 15 min
│  ├─ Cache: < 5 min
│  ├─ API: < 10 min
│  └─ Frontend: < 5 min
├─ Aggregate RTO: [Target: < 60 min]
├─ Communication Effectiveness: [1-5 rating]
└─ Incident Response Quality: [Rubric]

PITR Test (Q3):
├─ Restore Time: [Target: < 45 min]
├─ Data Accuracy: [Expected vs. Actual]
├─ RPO Verification: [Gap analysis]
├─ Audit Trail Completeness: [%]
└─ Constraint Validation: [Pass/Fail]

Annual Simulation (Q4):
├─ Overall RTO: [Target: < 60 min]
├─ Team Coordination: [Rubric 1-5]
├─ Procedure Completeness: [%]
├─ Communication Timeliness: [%]
├─ Executive Confidence: [Feedback]
└─ Recommended Improvements: [List]
```

### Trend Analysis

Track improvements quarter-over-quarter:

```
Metric              | Q1 2026 | Q2 2026 | Q3 2026 | Q4 2026 | Target
────────────────────────────────────────────────────────────────────
Average RTO (min)   | 18      | 12      | -       | <60     | <60
Average RPO (min)   | 8       | 4       | <5      | <30     | <30
Detection Time (min)| 6       | 4       | -       | <5      | <5
Data Integrity (%)  | 100     | 100     | 100     | 100     | 100
MTTR Improvement    | -       | -33%    | -50%    | -67%    | Ongoing
```

---

## Continuous Improvement

### Lessons Learned Process

After each test:
1. Collect team feedback (anonymous survey)
2. Document issues and root causes
3. Identify process improvements
4. Update runbooks as needed
5. Share findings with entire team

### Process Refinements

Based on test results, update:
- [ ] Runbook procedures
- [ ] Alert thresholds
- [ ] Monitoring configurations
- [ ] Team training needs
- [ ] Infrastructure capacity
- [ ] Replication setup
- [ ] Backup strategies

### Annual Review

End of year (November):
- [ ] Review all 4 quarterly tests
- [ ] Calculate aggregate metrics
- [ ] Assess RTO/RPO achievement
- [ ] Plan improvements for next year
- [ ] Update this schedule with new learning

---

**Next Review:** November 28, 2026

