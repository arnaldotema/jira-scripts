# INCIDENT #793 ANALYSIS: Missing Analytics Data for US Customers

## INCIDENT SUMMARY
- **Date:** April 13-15, 2025 (38 hours duration)
- **Impact:** 17.4k inbound calls missing in analytics (US region)
- **Root Cause:** Webdis binary stopped on all US Asterisk servers after failed Ansible deployment
- **Services Affected:** Asterisk → Redis → Call Information Processing (CIP) → Analytics
- **Post-Mortem:** https://www.notion.so/INC-793-Missing-analytics-data-for-US-customers-1d72bccf284f81bf8d1eeef1a02b2856

---

## DETAILED ANALYSIS

### What Happened:
1. **Deployment Failure Chain:**
   - Terraform executed Ansible playbook `asterisk-configure` to deploy new Asterisk image (VOIP-1390 fix)
   - First deployment failed on several instances due to missing logical volume (timing issue - AWS hadn't mounted `/var/log` yet)
   - Engineer re-ran playbooks manually, but supervisor service didn't start webdis binary (missing config at startup time)
   - Without webdis running, Asterisk couldn't write call_logs to regional Redis
   - CIP service couldn't process calls → **Missing analytics data**

2. **Detection Failure:**
   - Asterisk logs showed webdis errors → sent to Elasticsearch → **NO monitoring on these logs**
   - CIP error logs showed "There are no redis logs" → Datadog alert existed but **alert threshold too high (false positives)**
   - First customer ticket: April 14, 9:30 PM (**22 hours after issue started**)
   - Issue detected by customer reports, not internal monitoring

---

## PROBLEMATIC AREAS & PREVENTION ANALYSIS

### 1. TESTING GAPS ⚠️

#### a) Integration Tests Missing:
- **Test Gap:** No integration test validating Asterisk → Webdis → Redis → CIP pipeline
- **Specific Test Needed:**
  ```
  Test: "Asterisk call_log persistence to Redis via Webdis"
  - Start Asterisk instance
  - Initiate test call
  - Verify webdis binary is running (process check)
  - Verify call_log written to regional Redis
  - Verify CIP can read from Redis
  - Assert: Call appears in analytics within 5 minutes
  ```
- **Repository:** `asterisk-config` or dedicated integration test suite
- **Evidence:** Post-mortem explicitly states webdis status had no monitoring - integration test would catch this

#### b) Deployment Testing Insufficient:
- **Test Gap:** No automated verification that Ansible playbook completed successfully
- **Specific Test Needed:**
  ```
  Post-deployment smoke test:
  - Verify all required binaries running (asterisk, webdis, supervisor)
  - Verify all mount points exist (/var/log)
  - Verify can write to Redis
  - Health check endpoint returns 200
  ```
- **Current State:** Manual log checking mentioned in lessons learned ("Always check logs if no alerting")
- **Evidence:** Engineer missed that second deployment was canceled - no automated verification

#### c) E2E Test Missing:
- **Test Gap:** No end-to-end test covering US region call → analytics pipeline
- **Specific Test Needed:**
  ```
  E2E Regional Test (per region):
  - Place test call in US region
  - Wait 10 minutes
  - Query Statistics API for call record
  - Assert: Call data complete with all steps
  - Run every 30 minutes per region
  ```
- **Repository:** Could be in `call-information-processing` or `statistics-api`

---

### 2. ALERTING GAPS 🚨

#### a) Missing Service Health Monitoring:
- **Alert Missing:** Webdis process health check
- **Should Alert When:** Webdis process not running on Asterisk instance
- **Implementation:**
  - Export webdis process status via asterisk-exporter (Prometheus)
  - Alert: `absent(webdis_running{instance=~".*"}) == 1`
  - Already created as follow-up: VOIP-1858
- **Current State:** NO monitoring existed (confirmed in post-mortem)

#### b) CIP Error Alert Threshold Too High:
- **Alert Exists But:** Too many false positives, so threshold set too high to be useful
- **Root Cause of False Positives:**
  - Incomplete call logs from unanswered automated calls (VOIP-1863)
  - Incomplete logs when SIP proxy returns internal error (VOIP-1851)
- **Should Be:** Fix underlying issues causing incomplete logs, then lower alert threshold
- **Already Tracked:** DSH-5195 (CIP alerting improvement)

#### c) Log-Based Alerting Missing:
- **Alert Missing:** Asterisk error logs not monitored
- **Should Alert When:** Error rate spikes in Elasticsearch logs
- **Blocker:** Cost concerns for Datadog log monitoring
- **Alternative Solution:** Custom Prometheus exporter to convert log errors to metrics (VOIP-1850)

#### d) Deployment Success Monitoring:
- **Alert Missing:** Failed Ansible playbook execution
- **Should Alert When:**
  - Ansible playbook exits with non-zero code
  - AWX job shows failure/cancellation
  - Post-deployment health checks fail

---

### 3. DEPLOYMENT STRATEGY ISSUES 🚀

#### a) Better Rollout Strategy:
- **Current:** All US Asterisk instances deployed simultaneously
- **Problem:** Timing issues when AWS mounts volumes at scale (30 instances)
- **Better Strategy:**
  - **Canary Deployment:** Deploy to 1-2 instances first, verify 30 minutes, then proceed
  - **Blue-Green:** Deploy new instances, verify health, switch traffic
  - **Rolling Update:** Deploy in batches of 5 instances with verification between batches
- **Detection Benefit:** Canary would have caught webdis failure on first 1-2 instances before affecting all 30

#### b) Deployment Verification:
- **Current:** Manual log checking (if engineer remembers)
- **Should Have:** Automated post-deployment verification
  - Run smoke tests after each batch
  - Verify process health (supervisor, webdis, asterisk)
  - Verify can process test call end-to-end
  - **Fail deployment if verification fails**

#### c) Deployment Observability:
- **Problem:** AWX log size prevents seeing outcome of parallel jobs
- **Should Have:**
  - Increase AWX log size (VOIP-1856)
  - Better job status dashboard
  - Slack notifications for deployment failures
  - **Already tracked:** VOIP-1867

---

### 4. INFRASTRUCTURE/CONFIG ISSUES ⚙️

#### a) Timing Issues (AWS Volume Mounting):
- **Root Cause:** Ansible playbook runs before AWS finishes mounting `/var/log` volume
- **Better Approach:**
  - Add retry logic in Ansible playbook: wait for mount point (timeout 60s)
  - Pre-flight check: verify all volumes mounted before running playbook
  - Use cloud-init completion signal instead of immediate Ansible execution

#### b) Service Dependency Management:
- **Problem:** Supervisor tried to start webdis before config was ready
- **Better Approach:**
  - Ansible task ordering: ensure config written BEFORE starting supervisor
  - Webdis systemd unit with config file dependency: `Requires=webdis.conf`
  - Health check: restart webdis if not responding after 30s

#### c) Human Error (Single Engineer Deployment):
- **Problem:** One engineer missed canceled second deployment
- **Better Approach:**
  - **Pair deployments:** Always have 2 engineers for production deployments
  - Deployment checklist with sign-offs
  - Automated deployment script that enforces verification steps
  - **Already in lessons learned**

---

## CATEGORIZATION SUMMARY

| Prevention Method | Specific Measures | Priority |
|-------------------|------------------|----------|
| **TESTING** | ✅ Integration test: Asterisk→Webdis→Redis→CIP pipeline<br>✅ Post-deployment smoke tests (process health)<br>✅ E2E regional test (call→analytics) | **HIGH** |
| **ALERTING** | ✅ Webdis process health monitoring (VOIP-1858)<br>✅ Fix CIP false positives, lower threshold (DSH-5195)<br>✅ Asterisk error log monitoring via Prometheus exporter (VOIP-1850)<br>✅ Deployment failure alerts | **HIGH** |
| **DEPLOYMENT** | ✅ Canary/Blue-Green deployment strategy<br>✅ Automated post-deployment verification<br>✅ Increase AWX log size (VOIP-1856, VOIP-1867)<br>✅ Pair programming for deployments | **MEDIUM** |
| **INFRASTRUCTURE** | ✅ AWS volume mount retry logic in Ansible<br>✅ Supervisor/webdis dependency ordering<br>✅ Service health checks with auto-restart | **MEDIUM** |

---

## KEY TAKEAWAYS

**Primary Prevention Opportunities:**
1. **Integration test would have caught this immediately** - No test validates the Asterisk→Webdis→Redis→CIP pipeline
2. **Canary deployment would have limited blast radius** - Would have failed on first 1-2 instances, not all 30
3. **Webdis health monitoring is critical** - This is a single point of failure with NO monitoring (now tracked as VOIP-1858)
4. **CIP alerting needs fixing** - Alert exists but unusable due to false positives from other bugs

**Evidence from Repos:**
- `asterisk-config`: No integration tests visible
- `call-information-processing`: Alerting exists but threshold too high
- `sip-service` (Kamailio): Producing incomplete logs causing false positives

---

## FOLLOW-UP JIRA TICKETS

- **VOIP-1858:** Asterisk-exporter - implement check if webdis and regional webdis binaries are running
- **VOIP-1856:** Check AWX log size parameters
- **VOIP-1867:** Test deployment of 30 asterisk instances at the same time on stage
- **VOIP-1850:** Check possible solutions to convert log alerts to prometheus metrics
- **DSH-5195:** Improve CIP alerting
- **VOIP-1863:** Fix incomplete call logs for unanswered automated calls
- **VOIP-1865:** Fix incomplete logs for SIP proxy internal error responses
- **VOIP-1851:** Continue fixing missing call logs related to internal error responses
- **VOIP-1864:** Monitoring improvements for voice services (epic)
