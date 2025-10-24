# INCIDENT #934 ANALYSIS: SSO Does Not Work

## INCIDENT SUMMARY
- **Date:** June 23, 2025 (8 hours, 33 minutes duration - during peak business hours)
- **Impact:** All SSO users (Google login) unable to log in across Desktop, Dashboard, Phone apps
- **Root Cause:** SSL certificate for SSO authentication expired at 15:24 CET, no automated renewal
- **Services Affected:** Desktop, Dashboard Frontend, Dashboard, Phone (all frontend apps using SSO)
- **Post-Mortem:** https://www.notion.so/INC-934-SSO-does-not-work-21c2bccf284f8171a104cf11deb032d0

---

## DETAILED ANALYSIS

### What Happened:
1. **Certificate Expiration:**
   - SSO authentication certificate expired on Monday, June 23, 2025 at 15:24 CET
   - Certificate was manually issued with fixed expiry date
   - No automated renewal process in place

2. **Impact:**
   - Users relying on SSO (e.g., Google login) unable to log in
   - Affected **only new logins** - users already logged in continued working
   - Impact during **peak business hours** (3:24 PM - 11:57 PM CET)

3. **Detection Failure:**
   - **No alert fired** - Prometheus alert misconfigured
   - Alert had **24h pending time** AND **only active during working hours**
   - Issue first reported by Martin Malych via Slack at 10:48 PM (**7 hours after expiry**)
   - **No incident created initially** - process not followed, delayed resolution

4. **Root Causes:**
   - Certificate created manually, not tracked in Infrastructure as Code (IaC)
   - No automated renewal (ACM auto-renewal not used)
   - Monitoring alert ineffective (24h pending + working hours only)
   - No clear ownership for certificate lifecycle management

5. **Resolution:**
   - **Hotfix:** Imported renewed certificate manually (11:30 PM)
   - **Permanent fix:** Replaced with AWS ACM auto-renewing certificate (next day, 11:33 AM)
   - **Alert improvement:** Reduced pending time from 24h → 1h

---

## PROBLEMATIC AREAS & PREVENTION ANALYSIS

### 1. TESTING GAPS ⚠️

#### a) No Testing for Certificate Expiry Scenarios:
- **Test Gap:** No automated tests simulating certificate expiration
- **Specific Test Needed:**
  ```
  E2E Test: "SSO login with expired certificate"
  - Set system clock forward 1 year (or use test cert expiring soon)
  - Attempt SSO login
  - Assert: Clear error message ("Certificate expired")
  - Assert: Alert fires immediately
  - Run weekly in staging
  ```
- **Benefit:** Would validate alert configuration works correctly

#### b) No Synthetic Monitoring for SSO Login:
- **Test Gap:** No automated SSO login test running continuously
- **Specific Test Needed:**
  ```
  Synthetic Test: "SSO Google login health check"
  - Every 5 minutes: Attempt SSO login with test account
  - Assert: Login succeeds, user authenticated
  - Alert if failure
  ```
- **Evidence:** Would have detected outage within 5 minutes instead of 7 hours
- **Repository:** Could use Datadog Synthetics or similar

---

### 2. ALERTING GAPS 🚨

#### a) Certificate Expiry Alert Misconfigured:
- **Alert Existed But Broken:** Prometheus alert for certificate expiry had fatal flaws
- **Problem 1:** 24-hour pending time (cert expires before alert fires)
- **Problem 2:** Only active during working hours (cert expired at 3:24 PM, alert would fire next day)
- **Correct Configuration:**
  ```
  Certificate Expiry Alert:
  - Warning: Certificate expires in < 30 days (pending: 1h)
  - Critical: Certificate expires in < 7 days (pending: 1h)
  - Emergency: Certificate expires in < 24 hours (pending: 15 min, 24/7)
  - Check interval: Every hour, always (not just working hours)
  ```
- **Already Fixed:** Pending time reduced to 1h (but should be even lower for critical certs)

#### b) No Certificate Inventory/Dashboard:
- **Alert Missing:** No centralized view of all certificates and expiry dates
- **Should Have:**
  - Dashboard listing all certificates (ACM, manual, third-party)
  - Days until expiry for each
  - Renewal status (auto-renewing vs manual)
  - Alert if any manual certificates exist (should all be ACM)

#### c) No SSO Health Monitoring:
- **Alert Missing:** No monitoring of SSO login success rate
- **Should Alert When:**
  - SSO login failure rate > 5%
  - Absolute failures > 10/hour
  - Any authentication errors logged
- **Implementation:**
  - Monitor CT-Auth service logs for SSO errors
  - Track login attempts vs successes
  - **Would have detected within minutes**

---

### 3. DEPLOYMENT STRATEGY ISSUES 🚀

#### a) Manual Certificate Creation (Not IaC):
- **Current:** Certificate created manually, not tracked in Infrastructure as Code
- **Problem:** "Done outside the process and not in IaC"
- **Better Strategy:**
  ```
  IaC-Managed Certificates:
  - All certificates defined in Terraform/CloudFormation
  - Use AWS ACM for auto-renewal
  - PR review required for any certificate changes
  - Audit trail: Git history shows who created what and when
  ```
- **Evidence:** "We did not know about this as it was done outside the process"

#### b) No Automated Certificate Rotation:
- **Current:** Manually issued certificate with fixed expiry
- **Problem:** Human error - forgot to renew
- **Better Approach:**
  - **AWS ACM:** Automatically renews 60 days before expiry
  - **Let's Encrypt:** Auto-renewal with certbot
  - **No manual certificates for production**

---

### 4. INFRASTRUCTURE/CONFIG ISSUES ⚙️

#### a) Cognito Domain Not in IaC:
- **Problem:** SSO domain configuration not tracked in Infrastructure as Code
- **Risk:** Manual changes not audited, easy to forget
- **Better Approach:**
  - Define Cognito user pool and domain in Terraform
  - Certificate managed by Terraform (using ACM)
  - All changes via PR with review

#### b) No Certificate Lifecycle Management:
- **Current:** No clear ownership or process for certificate renewal
- **Problem:** "Lack of clear ownership for cert rotation and lifecycle management"
- **Better Approach:**
  - **Certificate registry:** Document all certificates, owners, renewal process
  - **Quarterly review:** Audit all certificates, ensure auto-renewal enabled
  - **Team ownership:** Infrastructure team owns all certificate lifecycle

#### c) Mixed Certificate Sources:
- **Problem:** "We already got rid of most manual certificates" - but missed this one
- **Better Approach:**
  - **Audit:** Identify ALL remaining manual certificates
  - **Migration plan:** Convert all to ACM within 90 days
  - **Policy:** No new manual certificates allowed (enforce in IaC)

---

### 5. PROCESS / HUMAN ERROR GAPS 👥

#### a) Incident Process Not Followed:
- **Problem:** Martin reported via Slack, **no incident created**
- **Impact:** Delayed response - no on-call engineer paged
- **Better Process:**
  - **Training:** All employees know how to create incidents (Slack command, incident.io)
  - **Automated incident creation:** Bot detects keywords ("login broken", "SSO down") and auto-creates incident
  - **Mandatory for P2+:** Any user-facing outage must be incident

#### b) 7-Hour Detection Gap:
- **Problem:** Certificate expired at 3:24 PM, reported at 10:48 PM (7 hours)
- **Why So Late:**
  - Users already logged in unaffected (only new logins failed)
  - No monitoring/alerting
  - Reported by employee trying to log in after hours
- **Better Detection:**
  - Synthetic SSO login test (every 5 minutes)
  - SSO login failure rate monitoring
  - Customer support ticket monitoring (would have seen complaints)

#### c) No Certificate Expiry Review:
- **Problem:** Certificate expiring soon, no one checked
- **Better Process:**
  - **Weekly review:** Infrastructure team reviews upcoming certificate expiries
  - **Automated report:** Slack notification listing certificates expiring < 60 days
  - **Quarterly audit:** All certificates reviewed, manual ones flagged

---

## CATEGORIZATION SUMMARY

| Prevention Method | Specific Measures | Priority |
|-------------------|------------------|----------|
| **TESTING** | ✅ E2E test for certificate expiry scenarios<br>✅ Synthetic monitoring: SSO login every 5 minutes | **HIGH** |
| **ALERTING** | ✅ Fix certificate expiry alert (1h pending, 24/7, multi-tier thresholds)<br>✅ Certificate inventory dashboard<br>✅ SSO login failure rate monitoring | **CRITICAL** |
| **DEPLOYMENT** | ✅ All certificates in IaC (Terraform)<br>✅ Use AWS ACM for auto-renewal<br>✅ No manual certificates policy | **CRITICAL** |
| **INFRASTRUCTURE** | ✅ Cognito domain in IaC<br>✅ Certificate lifecycle management process<br>✅ Audit and migrate remaining manual certificates | **HIGH** |
| **PROCESS** | ✅ Incident creation training for all employees<br>✅ Automated incident creation from keywords<br>✅ Weekly certificate expiry review<br>✅ Quarterly certificate audit | **MEDIUM** |

---

## KEY TAKEAWAYS

**Primary Prevention Opportunities:**
1. **Monitoring was completely ineffective** - Alert had 24h pending + working hours only → useless
2. **Synthetic SSO login test would detect in 5 minutes** - Instead took 7 hours (customer-reported)
3. **AWS ACM auto-renewal prevents this entirely** - No reason to use manual certificates
4. **IaC enforcement** - Certificate created manually outside process → invisible until it broke

**Evidence from Architecture:**
- **CT-Auth service**: Handles SSO authentication (JavaScript/TypeScript)
- **Cognito**: AWS Cognito user pool for SSO
- **Certificate**: SSL cert for Cognito custom domain (manual, not ACM)
- **All frontend apps affected**: Desktop, Dashboard, Phone (all use CT-Auth for SSO)

**Why This Incident is Unique:**
- **100% preventable** - AWS ACM provides free auto-renewal
- **Silent failure** - Only affected new logins, existing sessions unaffected
- **Peak hours impact** - 3:24 PM - 11:57 PM (business hours)
- **Process failure** - Incident not created initially, delayed response

**Similar Pattern to Other Incidents:**
- **Like INC-856 & INC-866** - Manual configuration change without IaC
- **Like INC-793** - Lack of proactive monitoring/alerting

---

## FOLLOW-UP ACTIONS

- ✅ **Already Done:** Replaced with AWS ACM auto-renewing certificate
- ✅ **Already Done:** Reduced Prometheus alert pending time to 1h
- (Implicit) Audit all remaining manual certificates, migrate to ACM
- (Implicit) Define Cognito domain in Terraform/IaC
- (Implicit) Implement synthetic SSO login monitoring
- (Implicit) Create certificate inventory dashboard
- (Implicit) Train employees on incident creation process
- (Implicit) Implement SSO login failure rate monitoring
