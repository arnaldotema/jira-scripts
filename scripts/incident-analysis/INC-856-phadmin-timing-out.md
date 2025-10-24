# INCIDENT #856 ANALYSIS: Phadmin Timing Out

## INCIDENT SUMMARY
- **Date:** May 19, 2025 (36 minutes duration, but impact 45 minutes: 8:45-9:30 AM)
- **Impact:** PHadmin pages returning HTTP 500, some API calls (including SMS) failing for clients
- **Root Cause:** PHP-FPM memory limits unintentionally set to default 128MB (down from 2GB), causing OOM errors
- **Services Affected:** Admin server (PHadmin + Public API running on same EC2 instance)
- **Post-Mortem:** https://www.notion.so/INC-856-Phadmin-timing-out-1f82bccf284f8170b4e7c945f55c77aa

---

## DETAILED ANALYSIS

### What Happened:
1. **Background Context:**
   - Admin and API servers experiencing memory/CPU issues for weeks
   - Saturday: Admin server running out of memory → EC2 instance scaled to `c5.9xlarge` as hotfix
   - Plan: Enable PHP-FPM limits Monday morning to prevent memory exhaustion

2. **Deployment Mistake:**
   - Engineers intended to set PHP memory limit to 2GB per process
   - **Accidentally enabled default PHP-FPM limit of 128MB** (forgot to override default)
   - Admin server reloaded at 8:45 AM with new limits

3. **Failure Cascade:**
   - PHP processes tried to allocate >128MB (e.g., 67MB for cache operations)
   - Memory allocation failed → Fatal error: "Allowed memory size of 134217728 bytes exhausted"
   - PHadmin pages returned HTTP 500
   - Public API endpoints (including SMS) also affected (same server)
   - Traffic rerouted to API server at 9:23 AM (temporary mitigation)

4. **Detection:**
   - **No automated alerts** - detected by support team (Jiří Missbach)
   - Incident reported 33 minutes after impact started
   - Support unable to work

---

## PROBLEMATIC AREAS & PREVENTION ANALYSIS

### 1. TESTING GAPS ⚠️

#### a) Pre-Deployment Testing Missing:
- **Test Gap:** Configuration change deployed directly to production without staging validation
- **Specific Test Needed:**
  ```
  Staging Deployment Test:
  - Apply PHP-FPM config changes to staging environment
  - Run smoke tests: Load PHadmin pages, test API endpoints
  - Monitor: Memory allocation, error logs, response codes
  - Assert: No OOM errors, all pages load successfully
  - If pass: Deploy to production
  ```
- **Current State:** Direct production deployment ("Legacy configuration is not versioned, changing config files directly on instance")
- **Evidence:** Post-mortem explicitly states "we are changing config files directly on the instance level"

#### b) Load Testing for Memory Limits:
- **Test Gap:** No validation that 128MB limit is insufficient for typical workloads
- **Specific Test Needed:**
  ```
  Load Test: "PHadmin memory consumption under normal load"
  - Simulate 50 concurrent users loading PHadmin pages
  - Monitor: Peak memory per PHP-FPM process
  - Assert: Peak memory < configured limit
  - Result would show: Need 200MB+ per process, not 128MB
  ```
- **Repository:** No load testing infrastructure appears to exist for Admin/API servers
- **Evidence:** Engineers didn't know 128MB was too low until production failure

#### c) Integration Test for API Endpoints:
- **Test Gap:** No automated tests for critical API paths (SMS, PHadmin)
- **Specific Test Needed:**
  ```
  Synthetic Monitoring (already tracked as BIT-3177):
  - Every 1 minute: Test call to /api/sms/send.json (with test API key)
  - Test PHadmin pages load
  - Assert: HTTP 200, response time < 2s
  - Alert if failure
  ```
- **Evidence:** "API in old-dashboard is not covered by synthetics check" (BIT-3177)

---

### 2. ALERTING GAPS 🚨

#### a) PHP Error Log Monitoring:
- **Alert Missing:** No monitoring of PHP Fatal errors in logs
- **Should Alert When:** "Allowed memory size exhausted" appears in logs
- **Implementation:**
  - Elasticsearch query: `service:admin AND "Allowed memory size"`
  - Alert threshold: 5 errors in 1 minute
  - **Already tracked:** BIT-3168 (missing alert about ongoing issue from logs)
- **Current State:** Errors logged but not monitored

#### b) HTTP 500 Error Rate Alerting:
- **Alert Missing:** No alerting on spike in HTTP 500 responses from Admin server
- **Should Alert When:**
  - 500 error rate > 5% of requests
  - Absolute count > 10 errors/minute
- **Implementation:**
  - Monitor nginx access logs or Cloudflare metrics
  - Already visible in Cloudflare dashboard (traffic to my.cloudtalk.io)

#### c) Memory Allocation Failure Detection:
- **Alert Missing:** No monitoring of PHP-FPM pool status
- **Should Alert When:** PHP-FPM processes hitting memory limit
- **Implementation:**
  - Export PHP-FPM metrics: `php_fpm_process_memory_bytes`, `php_fpm_process_limit`
  - Alert: `php_fpm_process_memory_bytes > (php_fpm_limit * 0.9)`
  - Proactive warning before OOM

#### d) Synthetic Monitoring (Missing):
- **Alert Missing:** No proactive health checks for PHadmin or Public API
- **Should Have:** BIT-3177 already tracked
- **Implementation:**
  - Use Datadog Synthetic tests or similar
  - Test every 1-5 minutes from multiple regions
  - Alert on failure

---

### 3. DEPLOYMENT STRATEGY ISSUES 🚀

#### a) No Staging Environment for Config Changes:
- **Current:** Direct production deployment of configuration changes
- **Problem:** No validation before production rollout
- **Better Strategy:**
  ```
  Staged Config Deployment:
  1. Apply to staging Admin server
  2. Run automated smoke tests (PHadmin pages, API endpoints)
  3. Manual verification (load a few pages)
  4. If all pass: Deploy to production
  5. Monitor production for 15 minutes
  6. If issues: Automated rollback
  ```
- **Evidence:** "Legacy configuration is not versioned, we are changing config files directly on instance level"

#### b) No Rollback Plan:
- **Current:** Manual revert by editing config files on server
- **Problem:** Slow recovery (45 minutes to identify + fix)
- **Better Approach:**
  - **Version control:** Store config in Git, deploy via automation
  - **Automated rollback:** Single command to revert to previous config
  - **Blue-Green config:** Test new config on secondary server before switching traffic

#### c) Change Communication Gaps:
- **Problem:** "We should communicate changes more clearly and have the clear roadmap"
- **Better Approach:**
  - **Change ticket:** Create Jira ticket before config change with rollback plan
  - **Change window:** Announce maintenance window in team channel
  - **Post-change monitoring:** Dedicated engineer watches metrics for 30 minutes after change

---

### 4. INFRASTRUCTURE/CONFIG ISSUES ⚙️

#### a) Configuration Not Version Controlled:
- **Root Problem:** Legacy EC2 instances with manual config management
- **Current State:** "Legacy configuration is not versioned, changing config files directly on instance level"
- **Better Approach:**
  - **Infrastructure as Code:** Ansible/Terraform for all config
  - **Git-based workflow:** Config changes via PR with review
  - **Automated deployment:** CI/CD pipeline applies config
  - **Audit trail:** Git history shows who changed what and when

#### b) Shared EC2 Instance for Admin + Public API:
- **Problem:** PHadmin and Public API on same server → single point of failure
- **Risk:** Admin config change broke Public API (SMS endpoints)
- **Better Architecture:**
  - **Separate services:** PHadmin on one instance, Public API on another
  - **Kubernetes migration:** Migrate from EC2 to k8s with independent pods
  - **Resource isolation:** Even on shared instance, use cgroups to limit blast radius

#### c) Wrong Default Memory Limit:
- **Problem:** Default PHP-FPM limit (128MB) too low for CloudTalk workload
- **Root Cause:** Engineers forgot to override default when enabling limits
- **Better Approach:**
  - **Explicit defaults:** Always set memory_limit explicitly (no reliance on defaults)
  - **Config validation:** Automated check that memory_limit >= 512MB before deployment
  - **Documentation:** Clear runbook for PHP-FPM configuration

#### d) Ongoing Resource Exhaustion:
- **Deeper Issue:** "Root cause is ongoing resource issues with SMS endpoints and billing"
- **Problem:** Even with correct config, servers running out of resources
- **Root Fix Required:**
  - Investigate SMS/billing memory leaks (relates to INC-810)
  - Proper resource sizing (BIT team needs to communicate HW requirements)
  - Migrate to horizontally scalable architecture (k8s)

---

### 5. HUMAN ERROR / PROCESS GAPS 👥

#### a) Configuration Mistake:
- **Human Error:** Enabled PHP-FPM limits but forgot to set memory_limit to 2GB
- **Prevention:**
  - **Config templates:** Pre-validated templates with correct values
  - **Peer review:** Two engineers review config changes before deployment
  - **Automated validation:** Script checks config file for required values before applying

#### b) No Post-Deployment Monitoring:
- **Problem:** Config applied at 8:45, issue detected at 9:18 (33 minutes later)
- **Should Have:** Engineer actively watches logs/metrics for 15 minutes after config change
- **Better Process:**
  - **Deployment checklist:** Watch logs, check error rates, verify pages load
  - **Automated smoke tests:** Run immediately after config reload
  - **Slack notification:** Auto-post "Config deployed, monitoring for 15 minutes"

---

## CATEGORIZATION SUMMARY

| Prevention Method | Specific Measures | Priority |
|-------------------|------------------|----------|
| **TESTING** | ✅ Staging environment for config changes<br>✅ Load test to determine correct memory limits<br>✅ Synthetic monitoring for PHadmin + Public API (BIT-3177) | **CRITICAL** |
| **ALERTING** | ✅ PHP error log monitoring (BIT-3168)<br>✅ HTTP 500 error rate alerting<br>✅ PHP-FPM memory usage monitoring<br>✅ Synthetic health checks (BIT-3177) | **HIGH** |
| **DEPLOYMENT** | ✅ Staged rollout (staging → production)<br>✅ Automated rollback capability<br>✅ Change communication process<br>✅ Post-deployment monitoring window | **HIGH** |
| **INFRASTRUCTURE** | ✅ Version control for all configuration (Git)<br>✅ Separate Admin and Public API instances<br>✅ Infrastructure as Code (Ansible/Terraform)<br>✅ Fix underlying resource issues (SMS/billing) | **CRITICAL** |
| **PROCESS** | ✅ Config templates with validation<br>✅ Peer review for production changes<br>✅ Post-change monitoring checklist | **MEDIUM** |

---

## KEY TAKEAWAYS

**Primary Prevention Opportunities:**
1. **Infrastructure as Code would prevent this entirely** - Manual config changes on EC2 instances are a recipe for disaster
2. **Synthetic monitoring would have detected it in 1 minute** - Instead took 33 minutes (customer-reported)
3. **Staging environment is critical** - No way to validate config changes before production
4. **Configuration mistake was preventable** - Peer review or config validation script would catch wrong memory limit

**Evidence from Architecture:**
- **Admin server**: Legacy EC2 instance (`c5.9xlarge`) running PHP/CakePHP (old-dashboard codebase)
- **No Kubernetes**: Still on EC2 with manual configuration management
- **Shared resources**: PHadmin and Public API on same server (blast radius amplified)

**Why This Incident is Unique:**
- **100% configuration error** - No code bug, no external dependency failure
- **Self-inflicted** - Intentional change caused outage
- **Fast fix** - Once identified, revert took minutes
- **But detection was slow** - 33 minutes because no alerting

**Connection to Other Incidents:**
- **Related to INC-810** - Same servers experiencing resource exhaustion from SMS load
- **Underlying issue unresolved** - This was a hotfix attempt that went wrong

---

## FOLLOW-UP JIRA TICKETS

- **BIT-3168:** Missing alert about ongoing issue from logs
- **BIT-3177:** API in old-dashboard is not covered by synthetics check
- (Implicit) Communicate proper HW requirements for Admin and API servers
- (Implicit) Implement Infrastructure as Code for legacy EC2 configurations
