# INCIDENT #866 ANALYSIS: Realtime API Responding with 500 Code

## INCIDENT SUMMARY
- **Date:** June 2, 2025 (1 hour, 4 minutes duration)
- **Impact:** Realtime API returning HTTP 500, Phone app not functioning, 0 replicas running
- **Root Cause:** CORS config changed from single-line string to multi-line array without testing, app couldn't parse new format
- **Services Affected:** Realtime API (pods failed to start), also Realtime WS and Campaigns affected but survived
- **Post-Mortem:** https://www.notion.so/INC-866-Realtime-api-respoinding-with-500-code-2062bccf284f8191981defc559390b05

---

## DETAILED ANALYSIS

### What Happened:
1. **Configuration Change:**
   - PR #4971: Changed CORS config format from single-line string to multi-line array
   - **Goal:** Enable E2E tests to run in GitHub Actions
   - **Assumption:** "Trivial change" → deployed to all environments simultaneously (dev, stage, prod)

2. **Failure Cascade:**
   - Realtime API pods tried to start with new CORS config format
   - **App couldn't parse multi-line array** → startup failed
   - Kubernetes saw pods as "unhealthy" → **terminated old pods**
   - Attempted to start new pods → they also failed
   - Result: **0 replicas running** → 100% downtime for Realtime API

3. **Interesting Detail:**
   - **Realtime WS and Campaigns also received same config change** but didn't break
   - Only Realtime API failed → suggests different CORS parsing implementation

4. **Detection:**
   - Realtime API started responding with HTTP 500
   - Phone app stopped functioning (depends on Realtime API)

5. **Resolution:**
   - Revert PR #4999 → rollback to single-line string CORS config
   - Pods successfully started with old config

---

## PROBLEMATIC AREAS & PREVENTION ANALYSIS

### 1. TESTING GAPS ⚠️

#### a) No Testing on Dev/Stage Before Production:
- **Test Gap:** Config change deployed to all environments simultaneously
- **Root Cause:** "Assumed too trivial to require such testing"
- **Specific Test Needed:**
  ```
  Staged Rollout Process:
  1. Deploy to dev environment
  2. Run automated smoke tests (health check, CORS validation)
  3. If pass: Deploy to staging
  4. Run full integration tests
  5. If pass: Deploy to production
  6. Monitor for 15 minutes
  ```
- **Evidence:** Post-mortem explicitly states "not tested on dev, stage"

#### b) No Automated Health Check Tests:
- **Test Gap:** No automated validation that CORS config is parseable
- **Specific Test Needed:**
  ```
  Unit Test: "CORS config parsing"
  - Test input: Single-line string (legacy format)
  - Test input: Multi-line array (new format)
  - Assert: Both formats parse successfully
  - Assert: App starts without errors
  ```
- **Repository:** `realtime-api` codebase
- **Evidence:** App failed to parse new CORS format → no unit tests for config parsing

#### c) Integration Test Missing:
- **Test Gap:** No integration test validating Realtime API startup with different CORS configs
- **Specific Test Needed:**
  ```
  Integration Test: "Realtime API startup with CORS config"
  - Set CORS env var to multi-line array
  - Start Realtime API container
  - Assert: Container starts successfully
  - Assert: Health check endpoint returns 200
  - Assert: CORS headers present in response
  ```
- **Evidence:** Would have caught the parsing failure before production

#### d) E2E Test Not Comprehensive:
- **Context:** Change was made to enable E2E tests in GitHub Actions
- **Test Gap:** E2E tests didn't validate the CORS config change itself
- **Specific Test Needed:**
  ```
  E2E Test: "Phone app with Realtime API CORS"
  - Deploy Realtime API with new CORS config
  - Phone app makes request to Realtime API
  - Assert: CORS headers correct
  - Assert: Request succeeds
  ```
- **Evidence:** E2E tests were the goal, but didn't validate the config change that enabled them

---

### 2. ALERTING GAPS 🚨

#### a) No Alert for Pod Restart Loops:
- **Alert Missing:** Kubernetes pods failing to start repeatedly
- **Should Alert When:**
  - Pod restart count > 5 in 5 minutes
  - Deployment has 0 ready replicas
  - Pod CrashLoopBackOff state
- **Implementation:**
  - Kubernetes metrics: `kube_pod_container_status_restarts_total`
  - Alert: `rate(kube_pod_container_status_restarts_total[5m]) > 1`
  - Already visible in k8s dashboard, but no alerting

#### b) No Alert for Deployment Rollout Failure:
- **Alert Missing:** Deployment unable to reach desired replica count
- **Should Alert When:**
  - `kube_deployment_status_replicas_available == 0` for > 2 minutes
  - After deployment, ready replicas < desired replicas
- **Implementation:**
  - Prometheus alert on deployment status
  - Critical alert: Service has 0 available replicas

#### c) No Alert for Health Check Failures:
- **Alert Missing:** Liveness/Readiness probes failing
- **Should Alert When:** Kubernetes probes consistently failing
- **Implementation:**
  - Track probe failure rate
  - Alert if all pods failing health checks

---

### 3. DEPLOYMENT STRATEGY ISSUES 🚀

#### a) No Staged Rollout (All Environments at Once):
- **Current:** Config change deployed to dev, stage, prod simultaneously
- **Problem:** "Trivial change" assumption → no gradual rollout
- **Better Strategy:**
  ```
  Progressive Deployment:
  1. Deploy to dev → validate 30 minutes
  2. Deploy to staging → validate 1 hour
  3. Deploy to production with canary (10% traffic)
  4. Monitor for 15 minutes
  5. If metrics good: Full rollout
  6. If issues: Automated rollback
  ```
- **Evidence:** Lessons learned: "even trivial change should go gradually through dev → stage → prod"

#### b) No Canary Deployment in Production:
- **Current:** All Realtime API pods updated simultaneously
- **Problem:** 100% of pods failed → 0 replicas available
- **Better Approach:**
  - **Canary:** Update 1 pod first, monitor for errors
  - If canary pod fails to start → keep old pods running
  - Kubernetes native: Use rolling update with `maxUnavailable: 0`

#### c) No Automated Rollback:
- **Current:** Manual revert via PR #4999
- **Problem:** Recovery required engineer to identify issue, create PR, merge, deploy
- **Better Approach:**
  - **Automated rollback:** If deployment fails to reach desired replicas within 5 minutes → auto-revert
  - **ArgoCD health check:** ArgoCD sees degraded health → rollback to previous revision
  - **Reduce MTTR:** Automated rollback would reduce recovery time from 1 hour to <5 minutes

---

### 4. INFRASTRUCTURE/CONFIG ISSUES ⚙️

#### a) App Reported "Ready" Despite Misconfiguration:
- **Root Cause #2:** "Services should not be in ready state if there is misconfiguration"
- **Problem:** Kubernetes saw pods as "ready" even though CORS config was invalid
- **Why This Matters:** Kubernetes terminated healthy old pods because new pods appeared "ready"
- **Better Approach:**
  ```
  Startup Validation:
  1. Parse all config (CORS, DB connection, Redis, etc.)
  2. If any config invalid: Log error and exit (don't report ready)
  3. Kubernetes sees CrashLoopBackOff → keeps old pods running
  4. Health check endpoint only returns 200 after config validated
  ```
- **Repository:** `realtime-api` - Improve startup config validation
- **Evidence:** "App should not be in ready state if there is misconfiguration"

#### b) CORS Config Format Not Backward Compatible:
- **Problem:** Changed from single-line string to multi-line array without backward compatibility
- **Why It Failed:**
  - Old code expected: `CORS_ORIGINS="https://app.cloudtalk.io,https://phone.cloudtalk.io"`
  - New config provided: Multi-line YAML array
  - Parser couldn't handle new format
- **Better Approach:**
  - **Support both formats:** Parse single-line OR multi-line
  - **Deprecation period:** Support both for 2 releases, then remove old format
  - **Config validation:** Fail fast on startup if format unrecognized

#### c) Different Services Handle Config Differently:
- **Observation:** Realtime WS and Campaigns received same config change but didn't fail
- **Problem:** Inconsistent config parsing across services
- **Better Approach:**
  - **Shared config library:** All services use same CORS parser
  - **Standardized config format:** Define config schema, validate against it
  - **Documentation:** Clear docs on config format expectations

---

### 5. PROCESS / HUMAN ERROR GAPS 👥

#### a) "Trivial Change" Assumption:
- **Human Error:** Developer assumed CORS config change was trivial → skipped testing
- **Problem:** No config change is truly trivial in production
- **Prevention:**
  - **Mandatory staged rollout:** All changes (even config) must go dev → stage → prod
  - **Change checklist:** Before merging PR, confirm: Tested on dev? Tested on stage?
  - **Peer review:** Reviewer challenges "trivial" assumptions

#### b) Lack of Config Change Knowledge:
- **Human Error:** "Dev didn't have knowledge that migrating from one line string could break app"
- **Problem:** Config parsing implementation not documented or understood
- **Prevention:**
  - **Config documentation:** Document all env var formats, parsing logic
  - **Code comments:** Annotate CORS parsing code with expected formats
  - **Knowledge sharing:** Cross-team review for config changes affecting multiple services

#### c) No Rollout Plan:
- **Problem:** Change deployed to all environments without monitoring plan
- **Prevention:**
  - **Deployment runbook:** For each deployment, define: monitoring metrics, rollback procedure
  - **Gradual rollout mandate:** CI/CD enforces dev → stage → prod progression

---

## CATEGORIZATION SUMMARY

| Prevention Method | Specific Measures | Priority |
|-------------------|------------------|----------|
| **TESTING** | ✅ Unit tests for CORS config parsing (both formats)<br>✅ Integration test: Realtime API startup with new config<br>✅ E2E test validating CORS functionality<br>✅ Mandatory dev/stage testing before production | **CRITICAL** |
| **ALERTING** | ✅ Pod restart loop alerting<br>✅ Deployment rollout failure (0 replicas)<br>✅ Health check probe failure alerting | **HIGH** |
| **DEPLOYMENT** | ✅ Staged rollout: dev → stage → prod (mandatory)<br>✅ Canary deployment in production (1 pod first)<br>✅ Automated rollback on failed deployment<br>✅ ArgoCD health-based rollback | **CRITICAL** |
| **INFRASTRUCTURE** | ✅ Startup config validation (fail fast if misconfigured)<br>✅ Backward-compatible config parsing<br>✅ Shared config library across services<br>✅ Health check only returns ready after validation | **HIGH** |
| **PROCESS** | ✅ Eliminate "trivial change" assumption<br>✅ Mandatory deployment checklist<br>✅ Config change documentation<br>✅ Cross-team review for multi-service changes | **MEDIUM** |

---

## KEY TAKEAWAYS

**Primary Prevention Opportunities:**
1. **Staged rollout would have caught this in dev** - No config change should go directly to all environments
2. **Startup validation is critical** - App reported "ready" despite being misconfigured → Kubernetes killed healthy pods
3. **Unit tests for config parsing** - Simple test would catch incompatible format change
4. **Automated rollback** - Manual revert took 1 hour, automated could be <5 minutes

**Evidence from Architecture:**
- **Realtime API**: Kubernetes service in `realtime-api` repo
- **ArgoCD deployment**: PR #4971 (breaking change), PR #4999 (rollback)
- **Phone app dependency**: Critical path for calling functionality

**Why This Incident is Unique:**
- **100% availability loss** - 0 replicas running (complete service outage)
- **Config-only change** - No code deployed, just config
- **Assumption-driven** - "Trivial change" bypassed standard process
- **Kubernetes amplified impact** - Terminated healthy pods when new pods appeared "ready"

**Connection to Other Incidents:**
- **Similar to INC-856** - Configuration change without proper testing
- **But worse** - Complete service outage (0 replicas) vs degraded performance

---

## FOLLOW-UP ACTIONS

- Implement mandatory staged rollout (dev → stage → prod) in CI/CD
- Add startup config validation to `realtime-api` (fail fast on invalid config)
- Implement unit tests for CORS config parsing
- Add Kubernetes alerting for pod restart loops and 0 replica deployments
- Configure ArgoCD automatic rollback on unhealthy deployments
- Document all config formats and parsing expectations
- Create shared config parsing library for consistency across services
