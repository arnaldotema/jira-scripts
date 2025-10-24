# INCIDENT #979 ANALYSIS: 408 Request Timeout Kamailio When Attempting to Route Calls via Twilio

## INCIDENT SUMMARY
- **Date:** July 19, 2025 (1 hour, 43 minutes duration)
- **Impact:** Four European companies unable to make outbound calls via Twilio (408 timeout errors)
- **Root Cause:** **External/3rd party** - Twilio stopped responding to SIP INVITE messages (suspected AWS network or Twilio issue)
- **Services Affected:** Kamailio-trunks, Asterisk (EUC1 region)
- **Post-Mortem:** https://www.notion.so/INC-979-408-Request-timeout-kamailio-when-attempting-to-route-calls-via-Twilio-2462bccf284f81538559d308c77a154f

---

## DETAILED ANALYSIS

### What Happened:
1. **Symptom:**
   - Outbound calls via Twilio failing with 408 Request Timeout
   - Kamailio-trunks sending SIP INVITE to Twilio → No response
   - Only affected EUC1 region, only Twilio carrier

2. **Investigation:**
   - **Twilio confirmed:** Calls never reached their systems
   - **Network analysis:** Two issues identified:
     - Twilio not responding to INVITEs from CloudTalk IPs (35.156.191.128, 35.156.191.129)
     - **Suspected IP fragmentation issue:**
       1. CloudTalk sends INVITE (1460 bytes) → Success
       2. Twilio sends 407 (authentication required) → Success
       3. CloudTalk sends INVITE with auth header (1800 bytes) → **Twilio stops responding**

3. **Workaround:**
   - Tested: Changed Asterisk server setting for test account → Calls worked
   - Removed Twilio from EUC1 region routing (deleted row in `trunks_regions` table, id=123)
   - Rerouted affected companies to US region
   - Calls immediately started working

4. **Root Cause Analysis:**
   - **Suspected:** AWS network issue OR Twilio internal issue
   - **Evidence:** Fragmentation of large SIP packets (1800 bytes) may have triggered issue
   - **Uncertainty:** Unable to definitively identify if AWS or Twilio at fault

---

## PROBLEMATIC AREAS & PREVENTION ANALYSIS

### 1. TESTING GAPS ⚠️

#### a) No Carrier-Specific Outbound Monitoring:
- **Test Gap:** Voice monitoring only tests routes with carrier failover, not single-carrier routes
- **Specific Test Needed:**
  ```
  Enhanced Voice Monitoring:
  - Test outbound calls via EACH carrier individually (rotate carriers)
  - Test call to destination only routable by Twilio
  - Test call to destination only routable by Voxbone
  - Rotate through all carriers randomly
  - Alert if any single carrier fails
  - Run every 5 minutes
  ```
- **Evidence:** "We are not monitoring routes which are routed by only one carrier"
- **Already Tracked:** VOIP-2204

#### b) No Large SIP Packet Testing:
- **Test Gap:** No testing of SIP packets exceeding MTU (causing fragmentation)
- **Specific Test Needed:**
  ```
  Integration Test: "SIP packet fragmentation handling"
  - Generate SIP INVITE with large headers (>1500 bytes)
  - Send via Kamailio to all carriers
  - Assert: Carriers respond correctly despite fragmentation
  - Test UDP and TCP transports
  ```
- **Evidence:** "Twilio stopped responding" after 1800-byte INVITE with auth headers

#### c) No Synthetic Tests for Critical Destinations:
- **Test Gap:** No monitoring of calls to destinations only routable by one carrier
- **Specific Test Needed:**
  ```
  Synthetic Test: "Critical destination reachability"
  - Identify destinations only routable by Twilio
  - Test call every 15 minutes
  - Alert if failure
  ```

---

### 2. ALERTING GAPS 🚨

#### a) Customer-Detected Issue:
- **Alert Missing:** No proactive detection - customers reported issue first
- **Root Cause:** Voice monitoring uses carrier failover → didn't detect single-carrier failure
- **Better Monitoring:**
  - Test each carrier individually (VOIP-2204)
  - Alert on carrier-specific failure rate
  - Monitor SIP 408 timeouts by carrier

#### b) No Carrier Health Monitoring:
- **Alert Missing:** No monitoring of carrier response times/timeouts
- **Should Alert When:**
  - Carrier response time > 5 seconds
  - 408 timeouts from specific carrier > 5%
  - Carrier completely unreachable
- **Implementation:**
  - Export Kamailio metrics: `kamailio_carrier_timeouts`, `kamailio_carrier_response_time`
  - Alert: `rate(kamailio_carrier_timeouts{carrier="twilio"}[5m]) > 0.05`

#### c) No Packet Fragmentation Monitoring:
- **Alert Missing:** No visibility into IP fragmentation issues
- **Should Alert When:**
  - High rate of fragmented packets on trunk interfaces
  - Packets being dropped due to DF (Don't Fragment) flag
- **Implementation:** Monitor network interface for fragmentation statistics

---

### 3. DEPLOYMENT STRATEGY ISSUES 🚀

**N/A for this incident - No deployment triggered this issue**

---

### 4. INFRASTRUCTURE/CONFIG ISSUES ⚙️

#### a) UDP Unreliable for Carrier Interconnection:
- **Current:** Using UDP for SIP signaling with Twilio
- **Problem:** UDP doesn't guarantee delivery, no retry logic, fragmentation issues
- **Evidence:** "We believe switch to TCP for all possible carriers can mitigate this issue"
- **Better Approach:**
  - **Migrate to TCP/TLS** for all carrier connections (VOIP-2203)
  - TCP provides: reliable delivery, automatic retransmission, no fragmentation issues
  - TLS adds: encryption, authentication
- **Already Tracked:** VOIP-2203

#### b) SIP Packet Fragmentation:
- **Problem:** Large SIP INVITE packets (1800 bytes) may exceed MTU → fragmentation
- **Why Large:** Authentication headers add significant size
- **Better Approach:**
  - **Reduce SIP packet size:** Optimize headers, use shorter values
  - **Increase MTU:** If possible, increase network MTU beyond standard 1500
  - **Use TCP:** TCP handles fragmentation transparently at transport layer

#### c) Lack of Carrier Redundancy per Region:
- **Problem:** Some destinations only routable by single carrier in region
- **Risk:** If that carrier fails, no failover available
- **Better Approach:**
  - **Multi-carrier agreements:** Ensure at least 2 carriers can route each destination
  - **Automatic failover:** If primary carrier fails, immediately failover to backup
  - **Cross-region failover:** If no carrier in region works, route via different region (already done as mitigation)

#### d) Manual Database Changes for Carrier Management:
- **Current:** Manually deleted row from `trunks_regions` table to disable Twilio
- **Problem:** Requires database access, no audit trail, error-prone
- **Better Approach:**
  - **Admin UI:** Interface to enable/disable carriers per region
  - **API endpoint:** Programmatic carrier management
  - **Audit log:** Track who disabled which carrier and when
  - **Temporary disable:** Option to auto-re-enable after X hours

---

### 5. PROCESS / OPERATIONAL GAPS 🛠️

#### a) No Write Access for Voice Team:
- **Problem:** Voice team couldn't disable Twilio carrier quickly (required infra team access)
- **Impact:** Delayed mitigation
- **Resolution:** "All voice team members should have write access for trunk_regions table" - **Already fixed**

#### b) No Runbook for Carrier Disablement:
- **Problem:** Ad-hoc process to disable carrier, not documented
- **Better Process:**
  - **Runbook:** "How to disable carrier for region" with SQL commands
  - **Slack command:** `/disable-carrier twilio euc1` (automated)
  - **Documentation:** Post-mortem mentions "add the action done to a runbook"

#### c) No Carrier SLA Monitoring:
- **Problem:** No tracking of carrier reliability/performance
- **Better Process:**
  - **Carrier scorecard:** Track uptime, failure rate, response time per carrier
  - **Quarterly review:** Evaluate carrier performance, renegotiate contracts
  - **Automatic carrier rotation:** Route more traffic to reliable carriers

---

## CATEGORIZATION SUMMARY

| Prevention Method | Specific Measures | Priority |
|-------------------|------------------|----------|
| **TESTING** | ✅ Enhanced voice monitoring: Test each carrier individually (VOIP-2204)<br>✅ Integration test: SIP packet fragmentation handling<br>✅ Synthetic tests for critical single-carrier destinations | **CRITICAL** |
| **ALERTING** | ✅ Carrier-specific failure rate monitoring<br>✅ SIP 408 timeout alerting by carrier<br>✅ Packet fragmentation monitoring | **HIGH** |
| **DEPLOYMENT** | N/A - No deployment caused this | N/A |
| **INFRASTRUCTURE** | ✅ Migrate to TCP/TLS for all carriers (VOIP-2203)<br>✅ Optimize SIP packet size (reduce fragmentation)<br>✅ Multi-carrier redundancy per destination<br>✅ Admin UI for carrier management (vs manual DB changes) | **HIGH** |
| **PROCESS** | ✅ Write access for Voice team (already fixed)<br>✅ Runbook for carrier disablement<br>✅ Carrier SLA monitoring and scorecard | **MEDIUM** |

---

## KEY TAKEAWAYS

**Primary Prevention Opportunities:**
1. **Enhanced monitoring would detect this** - Test each carrier individually, not just failover paths (VOIP-2204)
2. **TCP instead of UDP** - Would eliminate fragmentation issues, provide reliable delivery (VOIP-2203)
3. **Multi-carrier redundancy** - Ensure every destination has ≥2 carrier options
4. **Quick carrier disable** - Voice team now has access to disable carriers without waiting for infra

**Evidence from Architecture:**
- **Kamailio-trunks**: SIP proxy connecting to carrier trunks (Twilio, Voxbone, BICS)
- **UDP transport**: Current SIP signaling protocol (unreliable)
- **Regional routing**: `trunks_regions` table defines which carriers available per region

**Why This Incident is Unique:**
- **100% external/3rd party** - Not CloudTalk's fault (Twilio or AWS network)
- **Fragmentation hypothesis** - Large SIP packets may have triggered issue
- **Customer-detected** - Monitoring didn't catch single-carrier failure
- **Quick mitigation** - Disabled carrier, rerouted traffic (1h 43m total)

**Common Patterns with Other Incidents:**
- **Like INC-912** - Unknown root cause (external dependency)
- **Customer-detected** - INC-793, INC-856, INC-934 also customer-reported

---

## FOLLOW-UP JIRA TICKETS

- **VOIP-2203:** Switch to TCP for all possible carriers
- **VOIP-2204:** Improve voice monitoring outbound calls to route each call by only one carrier
- **INFRA-2705:** Notion page with personal DB users
- (Implicit) Create runbook for carrier disablement procedure
- (Implicit) Implement carrier SLA monitoring and scorecard
- (Implicit) Build admin UI for carrier management per region
