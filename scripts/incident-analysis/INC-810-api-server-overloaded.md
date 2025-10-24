# INCIDENT #810 ANALYSIS: HighCpuLoad95 - Admin and API Server Overloaded

## INCIDENT SUMMARY
- **Date:** April 25-26, 2025 (9 hours, 22 minutes)
- **Impact:** API and Admin servers at 95%+ CPU, billing delayed 2+ hours, API unavailable
- **Root Cause:** Single customer (Company 298427) mass SMS campaign → Twilio rate limiting → retry storm → server overload
- **Services Affected:** Public API (old-dashboard) → APIv3 → Twilio + cascading effects (Redis resque, memory, billing)
- **Post-Mortem:** https://www.notion.so/INC-810-HighCpuLoad95-admin-and-api-server-overloaded-1e32bccf284f814d9cecf1a929154af0

---

## DETAILED ANALYSIS

### What Happened:
1. **Trigger Event:**
   - Company 298427 launched automated SMS broadcast campaign (same message to all contacts)
   - Massive spike in requests to `/api/sms/send.json` (Public API endpoint)

2. **Failure Cascade:**
   - Public API blindly forwarded all requests to APIv3 (no rate limiting enforcement)
   - APIv3 hit Twilio's rate limit → HTTP 429 responses
   - **No backpressure/circuit breaker** → APIv3 kept retrying failed requests
   - APIv3 queue filled up with failed SMS attempts
   - CPU on `ct-prod-eu-api-1` reached 96.6%
   - Cascading alerts: ResqueDelayedJobs, ElasticacheMemoryUtilization, RunningOutOfMemory, HighLoadAverage

3. **Detection:**
   - **Alert:** `HighCpuLoad95` on April 25, 10:00 PM
   - Multiple connected alerts fired simultaneously
   - Initially classified as P4, upgraded to P2 on April 28

4. **Additional Discovery:**
   - **Bonus Issue:** SSL certificate expired for Voxbone SMS provider (discovered during investigation)

---

## PROBLEMATIC AREAS & PREVENTION ANALYSIS

### 1. TESTING GAPS ⚠️

#### a) Load Testing Missing:
- **Test Gap:** No load testing for SMS burst scenarios
- **Specific Test Needed:**
  ```
  Load Test: "SMS API under tenant burst traffic"
  - Simulate single tenant sending 1000 SMS/min
  - Monitor: API CPU, memory, response times, Twilio queue depth
  - Assert:
    - Rate limiter kicks in at configured threshold
    - Graceful degradation (429 returned to client)
    - No cascading resource exhaustion
    - Other tenants unaffected
  ```
- **Repository:** Load test suite (likely doesn't exist for Public API/APIv3)
- **Evidence:** System had no safeguards against tenant burst traffic

#### b) Rate Limiter Testing Insufficient:
- **Test Gap:** Public API has 60 req/min rate limit, but not tested under real load
- **Specific Test Needed:**
  ```
  Integration Test: "Rate limiter enforcement"
  - Send 100 SMS requests in 30 seconds from single API key
  - Assert:
    - First 30 requests succeed (60/min rate)
    - Subsequent requests return 429
    - No requests forwarded to APIv3 after limit hit
    - Twilio never sees excess traffic
  ```
- **Current State:** Rate limiter exists but was either bypassed or ineffective
- **Evidence:** All requests reached APIv3, which then hit Twilio limit (shouldn't happen if Public API rate limit worked)

#### c) Retry Logic Testing Missing:
- **Test Gap:** No tests for APIv3 behavior when downstream (Twilio) returns 429
- **Specific Test Needed:**
  ```
  Integration Test: "Graceful handling of downstream rate limits"
  - Mock Twilio to return 429
  - Send SMS via APIv3
  - Assert:
    - APIv3 returns 429 to caller (no retry)
    - OR: Enqueue to delayed queue with exponential backoff
    - No CPU spike from retry storm
    - Circuit breaker opens after N failures
  ```
- **Repository:** `call-processing` or APIv3 codebase
- **Evidence:** APIv3 kept retrying → "did not take into account rate limitations"

#### d) SSL Certificate Expiry Testing:
- **Test Gap:** No automated validation of external provider certificates
- **Specific Test Needed:**
  ```
  E2E Test: "SMS provider connectivity health check"
  - Run daily: Attempt test SMS via each provider (Twilio, Voxbone)
  - Assert: SSL handshake succeeds, test message sent
  - Alert if certificate expiry < 30 days
  ```
- **Evidence:** Voxbone SSL certificate expired, discovered only during incident investigation

---

### 2. ALERTING GAPS 🚨

#### a) Tenant-Level Anomaly Detection:
- **Alert Missing:** No alerting for unusual traffic patterns from single tenant
- **Should Alert When:**
  - Single tenant exceeds 10x normal SMS volume
  - Single tenant represents >50% of total API traffic
  - Sudden spike in requests from one company
- **Implementation:**
  - Track per-tenant request rates in Datadog APM (already visible in traces)
  - Alert: `avg(last_5m):rate(requests{service:public-api}) by {company_id} > threshold`
  - **Already tracked:** Company 298427 visible in Datadog traces, but no proactive alert

#### b) Twilio Queue Depth Monitoring:
- **Alert Missing:** No monitoring of Twilio message queue depth
- **Should Alert When:** Twilio queue for CloudTalk account exceeds capacity
- **Implementation:**
  - Poll Twilio API for queue metrics
  - Alert before hitting rate limit (proactive, not reactive)
  - Twilio provides queue stats via API

#### c) Better Resource Alerts (Already Fired, But Needs Improvement):
- **Alerts Fired:** `HighCpuLoad95`, `ResqueDelayedJobs`, memory alerts
- **Problem:** Multiple related alerts → unclear root cause
- **Better Approach:**
  - **Parent alert:** "API overload detected"
  - **Child alerts:** CPU, memory, queue depth auto-link to parent
  - Single incident dashboard instead of 8 separate alerts

---

### 3. ARCHITECTURE WEAKNESSES 🏗️

#### a) Missing Rate Limiting Architecture:
- **Current State:** Rate limiter exists (60 req/min) but ineffective
- **Problem:** Enforcement point unclear (per API key? per company? per endpoint?)
- **Better Architecture:**
  ```
  Multi-tier Rate Limiting:
  1. Public API (old-dashboard): 60 req/min per API key (exists but not working)
  2. APIv3: 1000 SMS/hour per company (MISSING - tracked as APPS-1382)
  3. Circuit breaker: Stop forwarding to Twilio after 10 consecutive 429s
  4. Tenant isolation: CPU/memory quotas per company
  ```
- **Evidence:** Post-mortem says "Introduce per-tenant SMS throttling" as long-term fix

#### b) No Message Queue for SMS:
- **Current State:** Synchronous API call: Public API → APIv3 → Twilio
- **Problem:** Burst traffic overwhelms synchronous processing
- **Better Architecture:**
  ```
  Asynchronous SMS Queue:
  1. Public API → SQS queue (immediate 200 response to caller)
  2. SMS worker consumes queue with rate limit
  3. Dead letter queue for failed messages
  4. Retry with exponential backoff
  5. Circuit breaker when Twilio unavailable
  ```
- **Benefits:** Decouples client from Twilio availability, natural backpressure
- **Evidence:** Post-mortem recommends "centralized SMS dispatch queue"

#### c) No Circuit Breaker Pattern:
- **Current State:** APIv3 kept retrying Twilio despite repeated 429s
- **Problem:** Retry storm amplified load instead of backing off
- **Better Pattern:**
  ```
  Circuit Breaker:
  - After 10 consecutive Twilio 429s: OPEN circuit
  - Return 503 to callers (or enqueue for later)
  - After 60 seconds: HALF-OPEN (try 1 request)
  - If success: CLOSE circuit (resume normal)
  - Prevents retry storms
  ```
- **Repository:** Should be in APIv3 (call-processing or similar)

#### d) No Tenant Isolation:
- **Current State:** One tenant's bad behavior affects all tenants
- **Problem:** Company 298427 consumed all API resources
- **Better Approach:**
  - **Resource quotas:** CPU/memory limits per tenant in Kubernetes
  - **Priority queues:** VIP tenants get separate processing queue
  - **Auto-throttling:** Automatically slow down misbehaving tenants

---

### 4. DEPLOYMENT/INFRA ISSUES ⚙️

#### a) Auto-Scaling Configuration:
- **Current State:** Fixed instance size `c5.xlarge`, manually scaled to `c5.4xlarge` during incident
- **Problem:** No automatic response to load spikes
- **Better Approach:**
  - **Horizontal Pod Autoscaling (HPA):** Add API pods when CPU >70%
  - **Vertical scaling:** Automatic instance size increase
  - **Pre-emptive:** Scale up when SMS queue depth exceeds threshold
- **Evidence:** Manual intervention required (infra engineer scaled instance)

#### b) Resource Limits Not Set:
- **Current State:** APIv3 can consume unlimited CPU/memory
- **Problem:** Runaway process affects entire server
- **Better Approach:**
  - Kubernetes resource limits: `limits.cpu: 2, limits.memory: 4Gi`
  - OOM killer prevents memory exhaustion
  - Multiple API pods instead of single large instance

---

### 5. MONITORING/OBSERVABILITY GAPS 📊

#### a) SMS-Specific Dashboard Missing:
- **Alert Fired:** Generic CPU alert, not SMS-specific
- **Should Have:**
  - Real-time SMS dashboard: requests/min, Twilio queue depth, error rates by tenant
  - **Per-tenant graphs:** Company 298427 spike would be immediately visible
  - Twilio rate limit proximity meter
- **Evidence:** Engineers discovered company 298427 via log analysis (reactive, not proactive)

#### b) SSL Certificate Expiry Monitoring:
- **Problem:** Voxbone certificate expired (separate issue discovered during incident)
- **Should Have:**
  - Daily check of all external provider certificates
  - Alert when expiry < 30 days
  - Automated certificate rotation
- **Evidence:** Certificate error only found in logs during investigation

---

## CATEGORIZATION SUMMARY

| Prevention Method | Specific Measures | Priority |
|-------------------|------------------|----------|
| **TESTING** | ✅ Load test for SMS burst traffic<br>✅ Rate limiter enforcement test<br>✅ Retry logic with 429 responses test<br>✅ SSL certificate health check (daily E2E) | **HIGH** |
| **ALERTING** | ✅ Tenant-level anomaly detection (per-company traffic)<br>✅ Twilio queue depth monitoring<br>✅ Correlated alert groups (reduce noise) | **HIGH** |
| **ARCHITECTURE** | ✅ Per-tenant rate limiting at APIv3 (APPS-1382)<br>✅ Asynchronous SMS queue with backpressure<br>✅ Circuit breaker for Twilio calls<br>✅ Tenant resource isolation (CPU/memory quotas) | **CRITICAL** |
| **DEPLOYMENT** | ✅ Horizontal Pod Autoscaling (HPA) for API pods<br>✅ Kubernetes resource limits<br>✅ Auto-scaling based on queue depth | **MEDIUM** |
| **MONITORING** | ✅ SMS-specific dashboard (per-tenant metrics)<br>✅ SSL certificate expiry monitoring<br>✅ Twilio rate limit proximity alerts | **HIGH** |

---

## KEY TAKEAWAYS

**Primary Prevention Opportunities:**
1. **Architecture is the biggest issue** - Synchronous API design with no queueing/backpressure enabled tenant to DOS entire platform
2. **Rate limiting exists but doesn't work** - 60 req/min limit was bypassed or ineffective (needs testing)
3. **No circuit breaker** - Retry storm amplified problem instead of backing off gracefully
4. **Tenant isolation missing** - One bad actor affected all customers (multi-tenancy weakness)

**Evidence from Architecture:**
- **Public API (old-dashboard PHP)**: Likely in legacy codebase, rate limiter may be configured but not enforced
- **APIv3 (CakePHP)**: Synchronous SMS sending, no queue, no circuit breaker
- **No SQS queue** visible in architecture diagram for SMS processing (unlike integrations which use SQS)

**Why This Incident is Unique:**
- Not a bug, but **architectural weakness** under burst load
- Rate limiter existed but failed → **needs integration tests**
- Monitoring caught it, but **no proactive tenant anomaly detection**
- Fix is not code change but **re-architecture** (queue + circuit breaker + isolation)

---

## FOLLOW-UP JIRA TICKETS

- **APPS-1382:** Created Jira story to address the SMS rate limiter (determine whether to address Messaging Service or APIv3)
- **APPS-1373:** APIv3: sending SMS using VoxBone is not working
- **APPS-1372:** Check voxbone certificate in api-v3
- **INFRA-2489:** Change AWS ec2 instance ct-prod-eu-api-1 size to c5.4xlarge
- **INFRA-2490:** Decrease php resque redis back to cache.t4g.small
