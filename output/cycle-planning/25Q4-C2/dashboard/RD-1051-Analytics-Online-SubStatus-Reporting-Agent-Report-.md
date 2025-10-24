# Analytics | Online Sub-Status Reporting (Agent Report + Real-time UI)

**JPD ID:** [RD-1051](https://cloudtalk.atlassian.net//browse/RD-1051)

---

## Summary

WHAT
Introduce a new “Hold” sub-status (under the existing “Online” agent status).This status will track when agents are placing callers on hold and for how long, so supervisors, admins, and analysts can measure average hold time and other related KPIs.
This data should be available in:
- Agent Report 
Similar initiative as  
WHY
It’s not just “nice to have,” but directly tied to employee performance evaluations, internal accountability, and performance-based compensation models.
Customer Reques...

## Effort

**Story Points:** 11

**Estimated Sprints:** 1

## Discovery Ballpark

0.5

## Release ETA

**Target Sprint:** Sprint 7

**Estimated Date:** 2026-02-11

*(Based on JPD position 4 of 10 in cycle)*

## Technical Complexity

Here is a summary of the technical changes and considerations for the Analytics | Online Sub-Status Reporting (Agent Report + Real-time UI) project:

The key technical work involves adding support for tracking new "on hold" and "off hold" events initiated by agents in the phone app. This data needs to be captured in the backend statistics-realtime service, which will then emit updated agent status events to the frontend statistics-frontend service. 

The frontend will need to be updated to display the new "on hold" status for agents in the real-time UI. This will likely involve integrating the new status change events from the backend and updating the relevant UI components.

The complexity here is primarily around coordinating the changes across multiple services and ensuring the new functionality is thoroughly tested, both in unit tests and integration tests. The team will need to make sure the existing agent status workflows are not disrupted by the new "on hold" status.

The main technical challenge will be ensuring the new status events are properly handled end-to-end, from the phone app down to the real-time UI. The team will need to carefully validate the new Kafka messages, the backend processing, and the frontend updates to make sure the reporting is accurate and reliable for stakeholders.

<details>
<summary>View detailed technical breakdown</summary>

### [DSH-6291 (comment by Roman Hartig)](https://cloudtalk.atlassian.net//browse/DSH-6291 (comment by Roman Hartig))

**Type:** Story

ED
- prereq from DSH-6197: on/off hold events initiated by agent in phone app are being tracked in the system and relevant Kafka msgs are sent to scenario-events topic
- BE statistics-realtime
- add support for new Kafka messages in a consumer to emit already existing agent-status ws event with new status (+ make status_id optional) for FE
- FE statistics-frontend
- update agent status based on agent-status onhold/offhold events
- unit test coverage
- QA statistics-frontend integration tests for other agent statuses already exist so it’s worth to include also new hold status here


---

</details>

## Dependencies

### [DSH-6291 (comment by Roman Hartig)](https://cloudtalk.atlassian.net//browse/DSH-6291 (comment by Roman Hartig))

**Type:** Story

epic. After the epic is groomed we can ED & groom this one.

---

