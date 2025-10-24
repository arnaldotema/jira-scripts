# INCIDENT #912 ANALYSIS: Index user_endpoints is Corrupted

## INCIDENT SUMMARY
- **Date:** June 16-18, 2025 (5 hours, 5 minutes duration for fix, but investigation continued 2 days)
- **Impact:** Increased error rates (50x codes) across Realtime API, Statistics API, Dashboard Backend, API V3
- **Root Cause:** **UNKNOWN** - MariaDB InnoDB index corruption on `device_delete` index of `user_endpoints` table
- **Services Affected:** Multiple services querying `user_endpoints` table (4 major services)
- **Post-Mortem:** https://www.notion.so/INC-912-Index-user_endpoints-is-corrupted-2162bccf284f8180adefcd810fecbd1e

---

## DETAILED ANALYSIS

### What Happened:
1. **Database Corruption:**
   - MariaDB InnoDB secondary index `device_delete` on `cloudtalk.user_endpoints` table corrupted
   - Error: "Tried to purge non-delete-marked record" during purge operation
   - Mismatch in undo/redo logs or corrupted index page

2. **Impact Cascade:**
   - Queries using `device_delete` index returned incorrect results or errors
   - Multiple services affected (all services querying user endpoints/devices)
   - Increased 50x error codes across the platform

3. **Suspected Trigger:**
   - DB archiver job was running (phase 3 started previous Tuesday)
   - Deleting old `asterisk_queue_log` table data
   - **Possible connection:** Index corruption coincided with archiver activity
   - **But:** No direct link found between archiver and `user_endpoints` table

4. **Detection:**
   - Datadog application logs showed errors
   - MariaDB error logs: "Flagged corruption of `device_delete` in table `cloudtalk`.`user_endpoints` in purge"

5. **Resolution:**
   - Rebuild corrupted index
   - Run `mysqlcheck` on all tables (no other corruption found)
   - Stopped db-archiver job temporarily
   - Mitigation: Upgrade MariaDB to 10.6.22 + reboot db-1 to clear memory

---

## PROBLEMATIC AREAS & PREVENTION ANALYSIS

### 1. TESTING GAPS ⚠️

**Limited testing opportunities (since root cause unknown):**

#### a) Database Integrity Testing Missing:
- **Test Gap:** No regular automated integrity checks of database indexes
- **Specific Test Needed:**
  ```
  Scheduled Database Health Check:
  - Run daily: mysqlcheck on all critical tables
  - Check InnoDB tablespace integrity
  - Verify index consistency
  - Alert if corruption detected
  - Run during low-traffic window (2-4 AM)
  ```
- **Evidence:** Corruption detected reactively via errors, not proactively
- **Benefit:** Would detect corruption before it impacts production

#### b) No Testing of DB Archiver Impact:
- **Test Gap:** DB archiver (deleting old data) not tested for side effects on other tables
- **Specific Test Needed:**
  ```
  Integration Test: "DB archiver impact on other tables"
  - Run archiver on staging database
  - Monitor: Index health on all tables (not just target table)
  - Run integrity checks before/after archiver
  - Assert: No index corruption on unrelated tables
  ```
- **Evidence:** Suspected link between archiver and corruption, but not proven
- **Current State:** Archiver stopped as precaution, no way to validate safety

#### c) Load Testing for Concurrent Deletes:
- **Test Gap:** No testing of concurrent deletes with high load
- **Specific Test Needed:**
  ```
  Stress Test: "Concurrent deletes under load"
  - Simulate: Archiver deleting old data
  - Concurrent: Services querying/updating user_endpoints
  - Monitor: Index health, purge thread activity
  - Assert: No index corruption under stress
  ```
- **Possible Root Cause:** Unclean session termination during delete could cause corruption

---

### 2. ALERTING GAPS 🚨

#### a) No Alert for Database Error Logs:
- **Alert Missing:** MariaDB error log monitoring for "corruption" or "purge" errors
- **Should Alert When:** MariaDB logs contain "Flagged corruption" or "InnoDB: error"
- **Implementation:**
  - Parse MariaDB error logs (already sent to Elasticsearch/Datadog?)
  - Alert on keywords: "corruption", "InnoDB: ERROR", "purge non-delete-marked"
  - **Immediate P2 incident** when corruption detected
- **Current State:** Detected via application errors (indirect), not database logs (direct)

#### b) No Proactive Index Health Monitoring:
- **Alert Missing:** No monitoring of index health/consistency
- **Should Alert When:**
  - Index fragmentation exceeds threshold
  - Purge thread errors increase
  - Undo log size grows abnormally
- **Implementation:**
  - Export MariaDB metrics: `innodb_purge_errors`, `innodb_index_corruption`
  - Alert on anomalies

#### c) DB Archiver Job Monitoring:
- **Alert Missing:** No alerting on archiver job impact
- **Should Alert When:**
  - Archiver job causes slow queries on other tables
  - Lock wait time increases during archiver execution
  - Disk I/O spikes during archiver
- **Implementation:**
  - Monitor query performance during archiver windows
  - Alert if unrelated queries slow down significantly

---

### 3. DEPLOYMENT STRATEGY ISSUES 🚀

#### a) No Blue-Green for Database Changes:
- **Current:** DB archiver runs directly on production database
- **Problem:** No way to test impact safely
- **Better Strategy:**
  ```
  Safe DB Archiver Execution:
  1. Test archiver on db-4 (replica) first
  2. Run integrity checks on db-4 after archiver completes
  3. If clean: Run on db-1 (master)
  4. Monitor db-1 for 1 hour after archiver
  5. Run integrity check on db-1
  ```
- **Evidence:** Team created snapshot and replicated db-4 → db-1 to run checks (reactive, should be proactive)

#### b) No Gradual Rollout of Archiver Phases:
- **Current:** Archiver phase 3 started, affected multiple tables
- **Problem:** No phased approach per table
- **Better Approach:**
  - Phase 3 Step 1: Archive one table, monitor 24 hours
  - Phase 3 Step 2: If clean, archive next table
  - Allows early detection if specific table causes issues

---

### 4. INFRASTRUCTURE/CONFIG ISSUES ⚙️

#### a) Possible MariaDB Version Bug:
- **Hypothesis:** Running older MariaDB version with known bugs
- **Mitigation Taken:** Upgrade to 10.6.22 (latest stable)
- **Better Approach:**
  - **Stay on latest minor versions** - Security/bug fixes released regularly
  - **Upgrade cadence:** Every 6 months for minor versions
  - **Test upgrades on staging first**

#### b) Database Cache/Memory Issues:
- **Hypothesis:** "Memory failure in database cache"
- **Mitigation Taken:** Reboot db-1 to clear memory
- **Better Approach:**
  - **Monitor memory health:** ECC errors, memory corruption indicators
  - **Restart policy:** Regular reboots to clear stale cache (e.g., monthly maintenance window)
  - **Memory limits:** Ensure InnoDB buffer pool not over-allocated

#### c) Checksum Algorithm:
- **Action Taken:** Ensure `innodb_checksum_algorithm` set to `crc32`
- **Why This Matters:** CRC32 more robust for detecting corruption
- **Better Approach:**
  - **Audit all DB config:** Ensure production DB has optimal corruption-prevention settings
  - **Document required settings:** `innodb_checksum_algorithm=crc32`, `innodb_checksums=ON`

#### d) Filesystem Corruption Possibility:
- **Hypothesis:** "Filesystem corruption" listed as possible cause
- **No Evidence:** mysqlcheck found no other corruption
- **Better Monitoring:**
  - **SMART disk monitoring:** Alert on disk health degradation
  - **Filesystem checks:** Periodic fsck on database volumes
  - **RAID health monitoring:** If using RAID, monitor array status

---

### 5. PROCESS / OPERATIONAL GAPS 🛠️

#### a) Unknown Root Cause = Unknown Prevention:
- **Problem:** "Root cause - unknown until now"
- **Risk:** Could happen again with no clear prevention
- **Better Process:**
  - **Deep dive investigation:** Engage MariaDB support/experts
  - **Analyze binary logs:** Review redo/undo logs around corruption time
  - **Correlation analysis:** Compare archiver activity with corruption timeline
  - **Known bug research:** Check MariaDB JIRA for similar corruption reports

#### b) No Database Maintenance Windows:
- **Current:** Operations (archiver, upgrades) run during business hours?
- **Problem:** Increased risk during high-load periods
- **Better Approach:**
  - **Scheduled maintenance windows:** Upgrades, archiver, integrity checks during low-traffic (2-4 AM)
  - **Change freeze:** No DB changes during peak hours

#### c) Reactive Integrity Checks:
- **Current:** Ran mysqlcheck after corruption detected
- **Problem:** Corruption could exist undetected for days/weeks
- **Better Approach:**
  - **Proactive daily checks:** Automated mysqlcheck on all critical tables
  - **Weekly full check:** All tables in database
  - **Alert on any anomalies**

---

## CATEGORIZATION SUMMARY

| Prevention Method | Specific Measures | Priority |
|-------------------|------------------|----------|
| **TESTING** | ✅ Daily automated database integrity checks (mysqlcheck)<br>✅ Integration test: DB archiver impact on other tables<br>✅ Stress test: Concurrent deletes under load | **HIGH** |
| **ALERTING** | ✅ MariaDB error log monitoring ("corruption", "purge" errors)<br>✅ Index health metrics (fragmentation, purge errors)<br>✅ DB archiver job impact monitoring (query slowdowns) | **CRITICAL** |
| **DEPLOYMENT** | ✅ Test archiver on replica (db-4) before master (db-1)<br>✅ Gradual rollout: One table at a time<br>✅ Post-archiver integrity checks mandatory | **MEDIUM** |
| **INFRASTRUCTURE** | ✅ Upgrade MariaDB to latest minor version (INFRA-2607)<br>✅ Regular database server reboots (monthly)<br>✅ Audit DB config (innodb_checksum_algorithm=crc32)<br>✅ SMART disk monitoring<br>✅ Filesystem health checks | **HIGH** |
| **PROCESS** | ✅ Root cause deep dive (engage MariaDB support)<br>✅ Scheduled maintenance windows (low-traffic)<br>✅ Proactive daily integrity checks | **MEDIUM** |

---

## KEY TAKEAWAYS

**Primary Prevention Opportunities:**
1. **Proactive integrity checks would detect this early** - Daily mysqlcheck would catch corruption before production impact
2. **MariaDB error log alerting is critical** - Corruption logged hours before production impact, no alert
3. **Test archiver impact on replicas first** - Could have detected issue before affecting master
4. **Unknown root cause is concerning** - Could recur without warning

**Evidence from Architecture:**
- **MariaDB Cloudtalk database**: Central database for user_endpoints, contacts, calls
- **ct-prod-eu-db-1**: Master database
- **db-4**: Replica for testing/verification
- **Multiple services affected**: Realtime API, Statistics API, Dashboard Backend, APIv3 all query user_endpoints

**Why This Incident is Unique:**
- **Database-level issue** - Not application code or config
- **Unknown root cause** - Cannot definitively prevent recurrence
- **Suspected archiver connection** - But no proof
- **Wide impact** - One corrupted index affected 4+ major services

**Possible Root Causes (unconfirmed):**
1. **Unclean session termination** during delete (archiver?)
2. **Memory failure** in database cache (ECC error?)
3. **MariaDB bug** in older version
4. **Filesystem corruption** (SMART, RAID issues?)

---

## FOLLOW-UP JIRA TICKETS

- **INFRA-2607:** Upgrade mariadb databases to latest minor version 10.6.22
- **INFRA-2603:** Create database db-1 disk snapshot, mount it on db-4 and check for corruption
- (Implicit) Implement daily automated mysqlcheck for all critical tables
- (Implicit) Add MariaDB error log monitoring and alerting
- (Implicit) Deep dive root cause investigation (engage MariaDB support)
