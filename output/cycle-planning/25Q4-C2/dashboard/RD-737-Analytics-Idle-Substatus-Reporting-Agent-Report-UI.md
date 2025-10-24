# Analytics | Idle Sub-status Reporting (Agent Report UI)

**JPD ID:** [RD-737](https://cloudtalk.atlassian.net//browse/RD-737)

---

## Summary

WHAT
Introduce a clearer view of how agents spend their idle time by adding sub-status tracking to the Agent Report.Supervisors will be able to see a breakdown of idle time into categories like Break, Lunch, Meeting, Training, Busy, and Custom - in the UI. This gives teams better visibility into agent availability and how time is used throughout the day.
WHY
Supervisors don’t know what agents are actually doing when they’re idle - it’s a black box. They’ve asked for this in user research, especi...

## Effort

**Story Points:** 15.5

**Estimated Sprints:** 1

## Discovery Ballpark

0.7

## Release ETA

**Target Sprint:** Sprint 5

**Estimated Date:** 2026-01-14

*(Based on JPD position 3 of 10 in cycle)*

## Technical Complexity

Here is a summary of the technical changes and implementation details for the JPD "RD-737 - Analytics | Idle Sub-status Reporting (Agent Report UI)":

1. Technical changes and implementations:
   - Create a new MongoDB collection to store agent statuses, sub-statuses, and related metadata like start/end times and duration (DSH-5527).
   - Enhance the "statistics-realtime" service to process agent status change events and call events to calculate online status and sub-status information (DSH-5527).
   - Introduce new backend API endpoints to retrieve agent idle status logs and online/idle status overviews (DSH-4808, DSH-4806).
   - Expand the existing agent status reporting UI to use the new backend APIs and display additional details like idle time, busy time, break time, etc. (DSH-4808, DSH-4806).

2. Affected services and components:
   - Backend services: statistics-realtime, agent status reporting API
   - Frontend: Agent reporting UI

3. Complexity and challenges:
   - Handling data atomicity and duplicate events when processing agent status changes (DSH-5527).
   - Ensuring the new MongoDB collection can efficiently support the required filtering, querying, and data aggregation needs (DSH-4808, DSH-4806).
   - Integrating the new data sources and API endpoints into the existing agent reporting UI (DSH-4808, DSH-4806).

4. Notable technical considerations:
   - Leveraging the existing agent_statuses and agent_status_change_logs tables, along with the new MongoDB collection, to provide the required reporting capabilities (DSH-4808, DSH-4806).
   - Evaluating the trade-offs between using the agent_statuses table (limited status information) versus the agent_status_change_logs table (more detailed data) for the various reporting requirements (DSH-4808).

Overall, this work involves several backend and frontend changes to enhance the agent status reporting capabilities by introducing a new data storage solution and expanding the existing reporting UI. The main technical challenges lie in ensuring data integrity, efficient querying and aggregation, and seamless integration with the existing system.

<details>
<summary>View detailed technical breakdown</summary>

### [DSH-5527: Agent statuses MongoDB](https://cloudtalk.atlassian.net//browse/DSH-5527)

**Type:** Story

*

---

### [DSH-5527 (comment by Serhii Shevchenko)](https://cloudtalk.atlassian.net//browse/DSH-5527 (comment by Serhii Shevchenko))

**Type:** Story

ED Notes:
- create a new collection in analytics MongoDB, 
- each document to have agent id, status, sub-status, custom status title, its start time, end time and duration
- agent id, status, sub-status, its start time, end time are used for filtering - should be indexed 
- statistics-realtime to enhance processing of agent:status_changed events 
- statistics-realtime to enhance processing of call events (call_created, call_started, call_answere, call_hangedup, call_ended) to calculate online status/sub-status 
- each new event will calculate the end time and duration of the previous status
Open Questions/Notes 
- let’s consider duplicates and atomicity here (ie using event timestamp)
- consider transferred calls flow


---

### [DSH-4808 (comment by Jakub Gawroński)](https://cloudtalk.atlassian.net//browse/DSH-4808 (comment by Jakub Gawroński))

**Type:** Story

On the ui side we already have option to configure such elements by tabs, and also we have in agents report grouping. The thing that we need to adjust are columns itself. Data that is required seems to be  already provided by backend so it should only require ui work


---

### [DSH-4808 (comment by Serhii Shevchenko)](https://cloudtalk.atlassian.net//browse/DSH-4808 (comment by Serhii Shevchenko))

**Type:** Story

BE:
- Online and Idle logs already implemented
- to get On Call logs need to rely on call_on and call_off statuses in agent_statuses table
- to cover Idle Breakdown Tab requirements we need to use agent_status_change_logs tableit has agent_status_id which covers all sub status as well as custom status name  
- introduce endpoint api/metrics/agent-idle-statuses/logs


---

### [DSH-4808 (comment by Duso Argalas)](https://cloudtalk.atlassian.net//browse/DSH-4808 (comment by Duso Argalas))

**Type:** Story

Flag reason: unable to compute idle metrics, database data is not sufficient, see blocking spike


---

### [DSH-4808 (comment by Serhii Shevchenko)](https://cloudtalk.atlassian.net//browse/DSH-4808 (comment by Serhii Shevchenko))

**Type:** Story

Additional ED notes:
- all queries, filtering, and data aggregation are based on the new Mongo collection.
- expanded view to use existing endpoint agent-statuses/logs, but enhance with new filtering options     
- online overview to use new endpoint agent-statuses/online
- idle overview to use new endpoint agent-statuses/idle


---

### [DSH-4806 (comment by Jakub Gawroński)](https://cloudtalk.atlassian.net//browse/DSH-4806 (comment by Jakub Gawroński))

**Type:** Story

On the ui side we already have option to configure such elements by tabs, and also we have in agents report grouping. The thing that we need to adjust are columns itself. 
Also we would need backend input because it seems we don’t have data such 
- Idle Time
- Busy Time
- Break Time
- Lunch Time
- Meeting Time
- Training Time
- Custom Time


---

### [DSH-4806 (comment by Serhii Shevchenko)](https://cloudtalk.atlassian.net//browse/DSH-4806 (comment by Serhii Shevchenko))

**Type:** Story

BE:
- seems to cover requirements we need to changes logic from agent_statuses to agent_status_change_logs, or use both of them.First one has only status idle_on and idle_off, it’s not enough to get breakdown of Idle sub statusesSecond one has agent_status_id which covers all sub status as well as custom status name  
- if so we can use status ids as filter to get data for Overview tab or Idle breakdown  
- introduce endpoint api/metrics/agent-idle-statuses


---

### [DSH-4806 (comment by Serhii Shevchenko)](https://cloudtalk.atlassian.net//browse/DSH-4806 (comment by Serhii Shevchenko))

**Type:** Story

Additional ED notes:
- all queries, filtering, and data aggregation are based on the new Mongo collection.
- expanded view to use existing endpoint agent-statuses/logs, but enhance with new filtering options     
- online overview to use new endpoint agent-statuses/online
- idle overview to use new endpoint agent-statuses/idle


---

</details>

## Dependencies

### [DSH-4806 (comment by Duso Argalas)](https://cloudtalk.atlassian.net//browse/DSH-4806 (comment by Duso Argalas))

**Type:** Story

of computation for idle type statuses end times.Update: After conversaton with app devs it is requested behaviour as feature, we need to find new way how to represent data in database to achieve idle status agregation timesIn AI-756 we will propose a solution

---

