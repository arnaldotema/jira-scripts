# Analytics | Offline Status Reporting (Agent Report UI)

**JPD ID:** [RD-1098](https://cloudtalk.atlassian.net//browse/RD-1098)

---

## Summary

WHAT
Add Offline status tracking into the Agent Status Breakdown in Analytics. This ensures that when agents switch to “Offline,” their status is properly captured and displayed in reports, alongside other statuses (e.g., Online, Idle, On Call).
Similar initiative as  and  
WHY
Currently, offline time is not tracked correctly. If an agent sets themselves to “Offline” and then closes/reopens the app, their time is logged incorrectly as “Online.” This creates a misleading picture of agent availabi...

## Effort

**Story Points:** 8

**Estimated Sprints:** 1

## Discovery Ballpark

0.2

## Release ETA

**Target Sprint:** Sprint 9

**Estimated Date:** 2026-03-11

*(Based on JPD position 5 of 10 in cycle)*

## Technical Complexity

Here is a non-technical summary of the key points from the provided technical details:

1. The technical changes and implementations required include:
   - Ensuring that agents' business hours are checked whenever their status changes, and not logging status changes that occur outside of business hours.
   - Storing the offline status of agents in the MongoDB database, along with the start time of the offline status, and adjusting the start time based on business hours if necessary.
   - Caching the request for getting company settings, and storing the business hours configuration along with the agent status data.

2. The main services or components affected are:
   - The agent status reporting UI and backend
   - The MongoDB database used to store agent status information

3. What makes this work complex:
   - Accurately handling and storing the offline status of agents, taking into account business hours and potential split time periods.
   - Ensuring that the agent status is correctly displayed in the Call Steps section, without incorrectly showing offline agents as "Busy (missed)".

4. Notable technical challenges and considerations:
   - Determining the root cause of the issue where offline agents are being incorrectly displayed as "Busy (missed)" in the Call Steps section.
   - Ensuring that the agent status classification and display are consistent across the different UI and reporting components.

Overall, this work involves updates to the agent status reporting functionality, with a focus on accurately handling and storing offline agent status while ensuring consistent display across the application.

<details>
<summary>View detailed technical breakdown</summary>

### [DSH-6157 (comment by Roman Hartig)](https://cloudtalk.atlassian.net//browse/DSH-6157 (comment by Roman Hartig))

**Type:** Story

- business hours should be checked whenever agent status happens and not logged if it’s outside
- handle time

---

### [DSH-6157 (comment by Serhii Shevchenko)](https://cloudtalk.atlassian.net//browse/DSH-6157 (comment by Serhii Shevchenko))

**Type:** Story

- assume that the statuses are stored in MongoDB we also need to store offline status
- offline status must be stored in all cases, and the start time must be adjusted according to business hours or even split into two time periods if necessary
- business hours should be checked whenever agent offline status calculation happens
- request for getting company settings should be cashed 
- business hours configuration has to be stored along with agent status data
- handle company time

---

### [DSH-6189: Offline Agents Shown as Busy in Call Steps [ticket]](https://cloudtalk.atlassian.net//browse/DSH-6189)

**Type:** Bug

*What happened?*

{quote}Agents who are *offline* are incorrectly displayed as *Busy (missed)* in the Call Steps section of Call Details.{quote}

*How to reproduce? Step by step.*

{quote}# Produce an inbound call to a group with agents set to *Offline* (queue rule = “Always”).
# Open Call Details → Call Steps.
# Observe that offline agents are logged as *Busy*, instead of *Offline*.{quote}

*Expected behavior?*

{quote}Offline agents should always appear as *Offline* in Call Steps. Only agents who are available but miss the call should be marked as *Busy (missed)*.{quote}

*Additional data:*

* *Company ID*: 280197
* *MRR at risk*: €234,00
* *Call IDs*: 985282287, 985248149
* *Affected Agent*: Emmanuel Alviz (Ext 1003 / ID: 380171)



*Evidence*:

* In *Agent Status Breakdown (Agent Report)*, Emmanuel shows as *Offline* for the entire period.
** In *Call Steps*, the same agent is incorrectly marked as *Busy (missed)*.
** Screenshots attached.
* !:DSH-6185.png|width=1424,height=1811,alt=":DSH-6185.png"!


*Hypothesis (possible root cause)*

* Likely a *CIP classification issue*: offline agents in ring groups are being treated as “reachable but not answering,” mapped to *Busy*.
* FE may only be rendering the status from CIP, so the bug is probably in *backend classification*, not UI.
* Needs review in CIP’s handling of agents excluded due to being offline.

*Environment*

* Tested with endpoints enabled/disabled → same result.
* Replicated internally on account 168807.



‌

---

</details>

## Dependencies

*No external dependencies identified yet.*

