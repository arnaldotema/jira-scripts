# INCIDENT #965 ANALYSIS: Kamailio Deployment Failed in apse-1

## INCIDENT SUMMARY
- **Date:** July 11, 2025 (30 minutes primary impact, 2 days degraded service)
- **Impact:** Customers in apse-1 and apse-2 unable to make/receive calls for 30 mins, then routed to EU with latency for 2 days
- **Root Cause:** Terraform change triggered ASG instance rotation → Ansible deployment bugs → Kamailio stuck in deployment loop
- **Services Affected:** Kamailio-users, Kamailio-trunks (apse-1, apse-2 regions)
- **Post-Mortem:** https://www.notion.so/INC-965-Kamailio-deployment-failed-in-apse-1-2312bccf284f81bb9eabf0692e874064

---

## DETAILED ANALYSIS

### What Happened:
1. **Trigger - Security Fix:**
   - Infra team removed GitHub access key from instance template (security improvement)
   - PR #2047 included changes to Kamailio shell scripts (unnoticed)
   - Change modified launch template → Triggered ASG instance rotation in apse-1 and apse-2

2. **Deployment Failure Loop:**
   - **Problem 1:** Kamailio started immediately on boot, ASG marked as healthy before full deployment
   - **Problem 2:** Ansible deployment included reboot, but reconnection after reboot failed
   - **Result:** ASG terminated old healthy instances, new instances stuck in deployment loop
   - Customers disconnecting/reconnecting repeatedly

3. **Immediate Mitigation:**
   - Alert fired: "50% decrease of registered users" on Kamailio instance
   - Quickly rerouted apse-1 and apse-2 traffic to euc-1 (Europe) via Cloudflare
   - Manually changed Asterisk config to route outbound calls to European Kamailio-trunks

4. **Secondary Issues:**
   - **Twilio regional IP restriction:** Twilio only allowed connections from regional IPs
   - Calls from apse-1/apse-2 routed through EU → Twilio blocked → Failover to other carrier
   - Some destinations unavailable (no carrier failover)
   - Customers experienced higher latency and dialing times for 2 days

5. **Resolution:**
   - Re-ran deployments (succeeded after 1-2 hours)
   - Moved customers back to original regions on Sunday July 13, 8:00 PM

---

## PROBLEMATIC AREAS & PREVENTION ANALYSIS

### 1. TESTING GAPS ⚠️

#### a) No Testing of Terraform Changes in Staging:
- **Test Gap:** Terraform change applied to prod without staging validation
- **Specific Test Needed:**
  ```
  Staged Terraform Deployment:
  1. Apply Terraform changes to staging (apse-1-stage)
  2. Verify: ASG instance rotation completes successfully
  3. Test: Kamailio instances fully deploy
  4. Test: Customers can register and make calls
  5. If all pass: Apply to production
  ```
- **Evidence:** "Voice team approved changed when code has been merged to stage and production" (too late)

#### b) No Testing of Ansible Deployment Reboot:
- **Test Gap:** Ansible deployment reboot not tested in isolation
- **Specific Test Needed:**
  ```
  Integration Test: "Kamailio deployment with reboot"
  - Run Ansible playbook on test instance
  - Assert: Reboot completes successfully
  - Assert: Ansible reconnects after reboot
  - Assert: Kamailio service starts correctly
  - Assert: Instance registers with ASG as healthy
  ```
- **Evidence:** "Deployment includes reboot... ansible was not able to reconnect after restart"
- **Already Tracked:** VOIP-2096 (redesign deployment to remove reboot)

#### c) No ASG Health Check Validation:
- **Test Gap:** No validation that ASG health check accurately reflects deployment status
- **Specific Test Needed:**
  ```
  Integration Test: "ASG health check accuracy"
  - Start Kamailio with default config (not fully deployed)
  - Query ASG health check endpoint
  - Assert: Returns unhealthy until deployment complete
  - Prevents ASG from terminating old instances prematurely
  ```
- **Evidence:** "Kamailio with default configuration is replying to ASG health check as healthy even when it is not fully deployed"

---

### 2. ALERTING GAPS 🚨

#### a) Alert Worked Well:
- **Alert Fired:** "50% decrease of registered users" detected issue immediately
- **Good Alert Design:** Monitors actual user impact, not just service status

#### b) Missing Deployment Progress Monitoring:
- **Alert Missing:** No alert for stuck ASG deployments
- **Should Alert When:**
  - ASG instance replacement takes > 15 minutes
  - Instance stuck in "pending" or "terminating" state > 10 minutes
  - New instances fail health checks repeatedly
- **Implementation:** Monitor ASG metrics, alert on abnormal replacement times

#### c) No Alert for Cross-Region Failover:
- **Alert Missing:** No notification when traffic routed out of region
- **Should Alert When:** Cloudflare routing changed (apse-1 → euc-1)
- **Benefit:** Operations aware of degraded service (latency) even if calls working

---

### 3. DEPLOYMENT STRATEGY ISSUES 🚀

#### a) Deployed on Friday:
- **Current:** Change deployed Friday afternoon
- **Problem:** "Do not deploy on Friday. This issue has been already communicated multiple times."
- **Better Strategy:**
  - **Change freeze:** No production deployments Friday after 12:00 PM
  - **CI/CD enforcement:** Block Friday deployments (require override approval)
  - **Weekend on-call:** If deploy Friday, ensure full team available

#### b) No Blue-Green or Canary for ASG Changes:
- **Current:** All instances rotated simultaneously in region
- **Problem:** 100% of region affected at once
- **Better Strategy:**
  ```
  Rolling ASG Deployment:
  1. Rotate 1 instance (canary)
  2. Monitor for 15 minutes: health checks, user registrations, call success
  3. If healthy: Rotate next instance
  4. Continue until all instances replaced
  5. If failure: Stop rotation, keep old instances
  ```
- **Benefit:** Would have caught deployment issue on first instance, not all instances

#### c) Insufficient PR Review:
- **Current:** Infra team merged PR affecting Voice team code without Voice team review
- **Problem:** "Missing PR review by voice team on voice component changed by another team"
- **Better Strategy:**
  - **CODEOWNERS:** GitHub CODEOWNERS file requires Voice team approval for Kamailio changes
  - **Mandatory review:** CI blocks merge without team owner approval
  - **Cross-team review:** Reviewer must understand impact on other teams
- **Already Implemented:** "Mandatory review for code owners in terraform repository"

---

### 4. INFRASTRUCTURE/CONFIG ISSUES ⚙️

#### a) Kamailio Starts Immediately on Boot:
- **Root Cause:** "Kamailio template image is configured in way that it starts kamailio service automatically after boot-up"
- **Problem:** ASG sees service running → marks healthy → terminates old instance → new instance not actually ready
- **Better Approach:**
  - Remove Kamailio from systemd auto-start
  - Ansible deployment starts Kamailio only after full config applied
  - Health check verifies full deployment, not just service running
- **Already Tracked:** VOIP-2096

#### b) Ansible Reboot Causes Reconnection Failure:
- **Root Cause:** "Deployment includes reboot of the instance after deployment is finished and ansible was not able to reconnect after restart"
- **Problem:** Reboot in deployment creates instability
- **Better Approach:**
  - **Remove reboot from deployment** (VOIP-2096)
  - Test reboots separately in staging
  - Use `wait_for_connection` Ansible module with timeout/retries
  - Or: Use AMI baking instead of runtime configuration

#### c) Twilio Regional IP Restrictions:
- **Root Cause:** Twilio trunks configured to only accept connections from regional IPs
- **Problem:** When failover to EU, Twilio blocks calls → forced to use backup carrier
- **Better Approach:**
  - **Global IP whitelist:** All CloudTalk IPs allowed on all trunks (VOIP-2100)
  - Enables cross-region failover without carrier change
  - "Create one general IP list with all CloudTalk IPs and assign it to all trunks"

#### d) Terraform Change Visibility:
- **Problem:** "Terraform does not report about all actions related to changes"
- **Risk:** Reviewers miss that ASG instance rotation will occur
- **Better Approach:**
  - **Terraform plan review:** Mandatory review of full plan output
  - **Change summary:** Automated comment on PR: "⚠️ This will trigger ASG rotation in apse-1, apse-2"
  - **Pre-apply checklist:** Confirm understanding of all resource changes

---

### 5. PROCESS / HUMAN ERROR GAPS 👥

#### a) Insufficient PR Review:
- **Human Error:** Reviewer "double checked" but missed Kamailio changes
- **Problem:** Large PR with changes across multiple components
- **Prevention:**
  - **Small PRs:** Limit PR size, one component per PR
  - **CODEOWNERS enforcement:** Automated checks require team owner approval
  - **Checklist:** Reviewer must confirm: "I understand all ASG changes and their impact"

#### b) Voice Team Not Involved in Review:
- **Problem:** Voice code changed by Infra team without Voice team awareness
- **Prevention:**
  - **Cross-team communication:** Slack notification when CODEOWNERS required
  - **Review SLA:** Team owners have 24h to review, or PR blocked
  - **Already Implemented:** Mandatory code owner review

#### c) Deployment on Friday:
- **Problem:** Despite "communicated multiple times", still deployed on Friday
- **Prevention:**
  - **Technical enforcement:** CI/CD blocks Friday deploys (require VP override)
  - **Deployment calendar:** Team calendar shows allowed deployment windows
  - **Post-mortem follow-up:** Track "Friday deployment" pattern across incidents

---

## CATEGORIZATION SUMMARY

| Prevention Method | Specific Measures | Priority |
|-------------------|------------------|----------|
| **TESTING** | ✅ Staged Terraform deployment (staging → production)<br>✅ Integration test: Ansible deployment with reboot<br>✅ Integration test: ASG health check accuracy | **HIGH** |
| **ALERTING** | ✅ ASG deployment progress monitoring<br>✅ Cross-region failover notifications<br>✅ (Existing alert worked well: 50% user decrease) | **MEDIUM** |
| **DEPLOYMENT** | ✅ Friday deployment freeze (technical enforcement)<br>✅ Rolling ASG updates (canary approach)<br>✅ CODEOWNERS mandatory review (already implemented)<br>✅ Terraform plan review checklist | **CRITICAL** |
| **INFRASTRUCTURE** | ✅ Remove Kamailio auto-start, start via Ansible (VOIP-2096)<br>✅ Remove reboot from deployment (VOIP-2096)<br>✅ Twilio global IP whitelist (VOIP-2100)<br>✅ Improved health check (deployment status, not service status) | **HIGH** |
| **PROCESS** | ✅ Small PRs (one component per PR)<br>✅ Cross-team communication for CODEOWNERS<br>✅ Terraform plan review checklist | **MEDIUM** |

---

## KEY TAKEAWAYS

**Primary Prevention Opportunities:**
1. **CODEOWNERS enforcement prevents this** - Voice team review required for Kamailio changes (now implemented)
2. **Blue-green ASG deployment limits blast radius** - Canary instance would fail, not all instances
3. **Remove deployment reboot** - Ansible reconnection failure caused deployment loop (VOIP-2096)
4. **Friday deployment ban** - Pattern seen multiple times, needs technical enforcement

**Evidence from Architecture:**
- **Kamailio**: SIP proxy (users and trunks) in multiple regions (apse-1, apse-2, euc-1)
- **ASG**: Auto-scaling groups manage Kamailio instances
- **Ansible**: Configuration management for Kamailio deployment
- **Cloudflare**: Traffic routing for regional failover

**Why This Incident is Unique:**
- **Cross-team coordination failure** - Infra changed Voice code without Voice review
- **Cascading failures** - Deployment bug → ASG health check bug → Twilio IP restriction
- **Multi-region impact** - apse-1 and apse-2 both affected
- **Long tail degradation** - 30min outage + 2 days latency

**Common Patterns with Other Incidents:**
- **Like INC-793** - Deployment without proper staging/testing
- **Like INC-866** - "Trivial change" assumption (security fix) caused major impact
- **Like INC-934** - Manual configuration (Twilio IP whitelist) not in IaC

---

## FOLLOW-UP JIRA TICKETS

- **VOIP-2096:** Kamailio deployment reboot is taking minutes instead of seconds (redesign deployment, remove auto-start, remove reboot)
- **VOIP-2100:** Twilio IP whitelist does not allow connection from different regions (create global IP list)
- (Implicit) Implement Friday deployment freeze in CI/CD
- (Implicit) Implement rolling ASG updates with canary approach
- (Implicit) Terraform plan review checklist for ASG changes
