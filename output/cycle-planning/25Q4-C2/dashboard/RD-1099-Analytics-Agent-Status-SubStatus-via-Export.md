# Analytics | Agent Status & Sub-Status via Export

**JPD ID:** [RD-1099](https://cloudtalk.atlassian.net//browse/RD-1099)

---

## Summary

WHAT
Enhance Agent Reporting by expanding CSV exports and the Analytics API to include detailed agent statuses and sub-statuses. This provides supervisors, admins, and analysts with both: 
- aggregated data (summary exports)
- granular data (distribution exports) 
Follow-up initiative of  and   and  
WHY
- Operational Insights: Supervisors require aggregated and granular data to track agent productivity and adherence.
- Accountability & Transparency: Sub-status tracking ensures fair performance ...

## Effort

**Story Points:** 8

**Estimated Sprints:** 1

## Discovery Ballpark

0.3

## Release ETA

**Target Sprint:** Sprint 11

**Estimated Date:** 2026-04-07

*(Based on JPD position 6 of 10 in cycle)*

## Technical Complexity

Here is a summary of the key technical details for the non-technical audience:

The engineering team is working on enhancing the Agent Report in the analytics system to provide more detailed visibility into agent status and sub-status data. This will involve two main changes:

1. Creating a new "Agent Status Distribution" CSV export (DSH-6229) that will provide a time-based breakdown of each agent's statuses and sub-statuses over a selected timeframe. This will include details like agent name, status (Online, Idle, Offline), sub-status, start/end times, and duration. This will enable deeper analysis of agent availability patterns.

2. Updating the existing "CSV Summary" export (DSH-6230) in the Agent Report to include additional columns showing the total time spent by agents in each status (Offline, Online) and sub-status (Idle Busy, Idle Break, Online On Call, etc.). This will give supervisors and analysts a higher-level summary view of agent performance.

The key technical work involves updating the backend reporting APIs to support these new export options, which will require changes to the data models, aggregation logic, and export endpoints. The team also needs to ensure the exports can handle large datasets without performance issues.

Overall, this work aims to provide more comprehensive analytics and insights to help supervisors, administrators, and analysts better understand and optimize agent productivity and availability. The technical changes, while complex, are focused on enhancing the reporting capabilities of the system.

<details>
<summary>View detailed technical breakdown</summary>

### [DSH-6229: Agent Status Distribution | CSV Export](https://cloudtalk.atlassian.net//browse/DSH-6229)

**Type:** Story

h3. *Description*

We need to introduce a new export option in the *Agent Report* that provides a *time-based breakdown of each agent’s statuses* (including sub-statuses) within a selected timeframe.

This export will help supervisors, admins, and analysts analyze agent availability patterns outside the UI, enabling deeper audits, accountability tracking, and integration into external BI tools.

The *Agent status distribution CSV* should be available from the *Export menu* in the Agent Report.

*Each row in the CSV must include:*

* Agent name
* Status (Online, Idle, Offline)
* Sub-status 
** For Idle > Custom sub-status, display custom + personalized label
* Start time 
* End time
* Time in status (in seconds)

[Designs|https://www.figma.com/design/4Cm1MRoC0xv2l0im2BZ0FZ/WIP-Analytics?node-id=5819-26263&t=8KGYBpveL38uw6Cl-0]


h3. *Acceptance Criteria*

# *Export Availability*
#* A new export option *“Agent status distribution CSV”* is available under the Export menu in Agent Report.
# *File Format*
#* File type: {{.csv}}
#* Column headers: {{Agent Name | Status | Sub-Status | Start Time | End Time | Time in Status (s)}}
# *Content & Data*
#* Each row represents a *single status interval* for an agent.
#* Both *status* and *sub-status* must be displayed (if sub-status exists, otherwise leave blank).
#* Duration must be provided in *seconds*.
#* Supports *custom sub-status labels*.
# *Filters & Time Range*
#* Export respects existing filters in the Agent Report.
#* Only the data visible for the selected timeframe is exported.
# *Permissions & Visibility*
#* Follows current visibility rules
# *Performance*
#* Export must handle large datasets without timeouts

---

### [DSH-6229 (comment by Kristina Shatts)](https://cloudtalk.atlassian.net//browse/DSH-6229 (comment by Kristina Shatts))

**Type:** Story

### Frontend
- Add a new report item and initiate a call with the new report type.
### Backend
- Add a new report type to the /export endpoint and publish an event using this new type.
- Consume the event with the new report type and update the following references:
- export-sources.service.ts#L57
- export-sources.service.ts#L35
- Retrieve data for the report from the new MongoDB collection.(Note: The aggregation for this collection should be implemented beforehand.)


---

### [DSH-6230: Update CSV Summary with Sub-Status Columns | Agent Report Export](https://cloudtalk.atlassian.net//browse/DSH-6230)

**Type:** Story

h3. *Description*

The *CSV Summary export* in Agent Report should be updated to include additional columns showing *time spent in statuses and sub-statuses*.

This will provide supervisors, admins, and analysts with a quick aggregated view of agent performance without requiring the detailed distribution export.

*New columns to be added:*

* *Time in Status:*
** Offline during business hours
** Online
* *Time in Sub-statuses (Idle + Online):*
** Idle Busy
** Idle Break
** Idle Lunch
** Idle Training
** Idle Custom -(one column per each)-
** Online On Call
** Online On Hold
** Online Wrap-up time (already exists, keep as-is)



h3. *Acceptance Criteria*

# *Export Availability*
#* The *CSV Summary export option* remains available from the Export menu in Agent Report - just rename it
# *File Format*
#* File type: {{.csv}}
#* Existing summary columns remain unchanged.
#* Add new columns for time spent in each status/sub-status.
#* Column order should follow logical grouping: Status columns → Sub-status columns.
# *Content & Data*
#* Each new column shows *total time spent (in seconds)* in that sub-status or status during the selected timeframe.
#* If an agent does not use a sub-status (e.g., Idle Lunch), the value is *0*.
#* Custom sub-statuses must each get their own dedicated column.
# *Filters & Time Range*
#* Export respects the same filters as the Agent Report. 
# *Permissions & Visibility*
#* Follows current visibility rules. 
# *Performance*
#* Export generation time must remain similar to current CSV Summary performance.

---

### [DSH-6230 (comment by Kristina Shatts)](https://cloudtalk.atlassian.net//browse/DSH-6230 (comment by Kristina Shatts))

**Type:** Story

- Add aggregation with a new collection(should be implemented in a separate ticket beforehand 
- We currently have aggregation by agents based on call steps. https://github.com/CloudTalk-io/statistics-api/blob/main/src/export/processor/export-sources.service.ts#L155 We need to combine this with aggregation based on agent statuses and calculate the total time.


---

</details>

## Dependencies

*No external dependencies identified yet.*

