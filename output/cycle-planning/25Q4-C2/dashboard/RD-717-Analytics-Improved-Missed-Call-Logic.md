# Analytics | Improved Missed Call Logic

**JPD ID:** [RD-717](https://cloudtalk.atlassian.net//browse/RD-717)

---

## Summary

WHAT
Fix inflated and confusing missed call metrics. Ensure missed calls are counted accurately based on outcome, not just ringing behavior.Pain Point: One incoming call that rings multiple agents or numbers is being counted as multiple missed calls, even if someone eventually answered. 💬 Quote (Jackie Warrick): "It's showing as Missed, missed, missed. That's three missed calls. Agent four picked it up. It actually wasn't a missed, like a truly missed call where no one was available."
💬 Quote...

## Effort

**Story Points:** 13

**Estimated Sprints:** 1

## Discovery Ballpark

0.3

## Release ETA

**Target Sprint:** Sprint 13

**Estimated Date:** 2026-05-05

*(Based on JPD position 7 of 10 in cycle)*

## Technical Complexity

Here is a summary of the technical changes and considerations for the JPD RD-717 - Analytics | Improved Missed Call Logic:

1. Technical Changes and Implementations:
   - Revise the backend logic and UI display for missed call categorization to follow a new decision flow and introduce clearer definitions for each type of missed call (DSH-5839).
   - Implement the new missed call logic to only mark a call as "Missed" if no one in the routing path picked it up. Calls answered by someone in the routing path should not be counted as missed.
   - Add new missed call reasons, such as "Call abandoned during playback," "Call abandoned during IVR," and "Call was hung up early."
   - Revise the visualizations and totals in the Call Log, Agent, and Group reports to reflect the new missed call reasons and allow filtering by them.
   - Add a new "Reason" column in the call log table and exports to provide more details on the missed call type.

2. Affected Services and Components:
   - The backend services responsible for processing and categorizing missed calls.
   - The frontend components and UI elements for displaying the missed call data and reports.
   - The APIs that provide the missed call data for the reports.

3. Complexity and Challenges:
   - Handling edge cases, such as when a call is routed to a group, initially missed, and then answered on a second attempt. This requires the ability to suppress earlier missed call records and exclude the answering agent from missed counts.
   - Ensuring consistency between the various UI elements (e.g., status icon, tooltip, call type, talking time, call steps) to avoid confusion and maintain user trust in the reporting.
   - Addressing any potential discrepancies in the missed calls count across the Agent and Group reports (DSH-6367).

4. Notable Technical Considerations:
   - Thorough testing to validate the new missed call logic and ensure it aligns with customer expectations and reporting needs.
   - Potential impact on existing customer data and reporting, requiring careful data migration and reconciliation.
   - Potential performance and scalability considerations, as the new missed call logic and reporting may involve more complex calculations and data processing.
   - Potential integration with other systems or APIs that consume the missed call data.

Overall, this work aims to improve the accuracy and clarity of missed call reporting, which is essential for customer trust and decision-making. The technical complexity arises from the need to handle edge cases, ensure UI consistency, and maintain performance and scalability as the missed call logic and reporting are enhanced.

<details>
<summary>View detailed technical breakdown</summary>

### [DSH-5839: Missed Call Categorization Logic & UI Based on New Schema](https://cloudtalk.atlassian.net//browse/DSH-5839)

**Type:** Story



{panel:bgColor=#deebff}
*WHAT*

Current missed call metrics are misleading and inflated. A single incoming call that rings multiple agents or numbers is currently counted as multiple missed calls, even if the call was eventually answered by someone in the routing path.

Example: 💬 _Quote from Jackie Warrick:_
"It's showing as Missed, missed, missed. That's three missed calls. Agent four picked it up. It actually wasn't a missed, like a truly missed call where no one was available."

This leads to user confusion and loss of trust in reporting.

{panel}

{panel:bgColor=#e3fcef}
*HOW*
We need to revise the backend logic and UI display for missed call categorization to follow the new decision flow (see attached schema). The updated logic introduces clearer definitions for each type of missed call and resolves current ambiguity in reporting.
{panel}

*Acceptance Criteria*

# *Implement new missed call logic:*
#* A call is only marked as Missed if no one in the routing path picked it up. If someone in the routing path answers the call (even if not the first agent), it should not be counted as missed.
#* What remains unchanged: exclude calls outside business hours from the missed call count: these should be tracked separately as it is today.
# *Add new missed call reasons:*
#*  Call abandoned during playback
#** _The caller hung up while listening to a recorded message (e.g., a greeting or announcement), before reaching an agent or interacting with the system._
#* Call abandoned during IVR
#** _The caller hung up while navigating the IVR menu._
#* Call was hand up early
#** _The caller ended the call within the first 5 seconds._
# *Revise visualizations and totals in Call log Report*
#* "Missed Calls (Inbound)" card:
#** Clicking the card opens a detailed breakdown by sub-reason (number and percentage of calls).
#** Include an "All" option and allow filtering by individual sub-reasons.
#** Update the call table to reflect the active filter.
#** Add a new “Reason” column in the call log table.
#* "Resolved Missed Calls" card: Add a “Reason” column.
#* "Unresolved Missed Calls" card: Add a “Reason” column.
# *Revise visualizations and totals Agent & Group Reports*
#* Ensure the "Missed Calls (Inbound)" card behaves the same as in the Call Log Report:
#** Breakdown by reason
#** Filtering
#** Updated table columns
#* Update the names of the cards accordingly "Group missed calls (Inbound)" and "Agent missed calls (Inbound)"
# *Exports*
## Add an extra column to exports for the missed call reason.
# *APIS*
## Discuss current coverage: What is returned today?



{panel:bgColor=#eae6ff}
EDGE CASE TO CONSIDER:

* A call is routed to *Group A*, no one picks up.
* Later in the flow, it’s routed *again to Group A*.
* An agent picks it up during this second attempt.
* Result:
** The call is counted as *missed at group level* (from the first attempt) *and* as *answered* (from the second).
** At agent level, *every agent in Group A*, including the one who eventually answered, gets a *missed call* from the first leg.
** Within call log we fix the behavior as part of this bug: [https://cloudtalk.atlassian.net/browse/DSH-5828|https://cloudtalk.atlassian.net/browse/DSH-5828|smart-link] 

h3. *Expected Behavior*

* *At the group level*:
→ The call should be marked as *answered by the group*, since it was ultimately handled by a group member. No green tick “Resolved by“ should appear since the whole process happens as part of the same call.
* *At the agent level*:
** Agents who were *alerted in the first round but didn’t answer* = *1 missed call each*.
** The agent who *answered in the second attempt* = *should not receive a missed call* at all.
** No green tick “Resolved by“ should appear since the whole process happens as part of the same call.

*Why This Is the Right Logic*

# *Avoids double-counting* and over-penalizing groups that ultimately serve the customer.
# Matches how supervisors understand performance: “Did the group answer or not?”
# Prevents misleading analytics (e.g., agents marked as underperforming even when they answered).
# Aligns with expectations from *group routing logic*, where *only one answer counts* as resolution.

h3. This would require:

* Ability to *suppress earlier missed call record* once a later successful attempt is recorded.
* Logic to *exclude the answering agent* from missed counts, even if they were alerted earlier.
{panel}

{panel:bgColor=#fffae6}
Note: There were a few Support Tickets reported that _seem_ to be solved with the implementation of this User Story. Please test those reported issues when testing the AC of this story. (see them linked) 
{panel}

Design: [https://www.figma.com/design/4Cm1MRoC0xv2l0im2BZ0FZ/WIP-Analytics?node-id=5087-28628|https://www.figma.com/design/4Cm1MRoC0xv2l0im2BZ0FZ/WIP-Analytics?node-id=5087-28628|smart-link] 

---

### [DSH-6188: Call type icon/tooltip show “Missed / resolved by CFD” on answered calls (FE mismatch)](https://cloudtalk.atlassian.net//browse/DSH-6188)

**Type:** Bug

*What happened?*

{quote}For some inbound calls that were *answered*, the *Call Log table* shows a *red “missed” icon* and a tooltip *“resolved by Call Flow Designer.”*

However, the *Type column* correctly indicates *Answered*, *talking time* is present, and *Call Steps* confirm the call was routed through a group and ultimately answered by an agent.



This appears to be a *frontend classification/rendering issue* (icon + tooltip) rather than missing or incorrect backend data.{quote}

*How to reproduce? Step by step.*

{quote}# *Impersonate* company *274701*.
# Open *Analytics → Call Log*.
# Filter by *Call ID* 993230973 or 996349889.
# Observe the *status icon* (shows Missed) and *tooltip* (“resolved by Call Flow Designer”).
# Compare with other UI signals for the same call:

#* *Type column* = Answered.
#* *Talking time* is present.
#* *Call Steps*: call routed through group; skipped agents; answered by an agent.
# 
# (Optional) Inspect the *Network* panel for the call details payload to confirm final call status = answered.{quote}

*Expected behavior?*

{quote}* The *status icon* must reflect the *final call outcome* (Answered vs. Missed) consistently with the Type column and call details.
* The *“resolved by Call Flow Designer”* tooltip should *only* appear for *missed legs* (agents who didn’t pick up) or for calls whose *final status is Missed*—*not* on calls that were answered.{quote}

*Additional data:*

* *Company ID:* 274701
* *MRR at risk:* *$939.50*
* *Call IDs:* 993230973, 996349889
* *Environment:* Production
* *Attachments:* Customer screenshots showing icon/tooltip vs. talking time & steps

h2. *Scope / Impact*

* *UI consistency and trust*: Confusing for customers and support; suggests a missed call when it wasn’t.
* Likely affects *all tenants* whenever a call has *missed legs before an answered leg* (e.g., group ringing with multiple agents).

---

### [DSH-6367: Missed calls count discrepancy on agent/group reports in analytics](https://cloudtalk.atlassian.net//browse/DSH-6367)

**Type:** Bug

*What happened?*

{quote}* Agent report for ADMIN only (because non-admins have always prefilled Agent/Group ids based on their access policies) w/o selected Agents shows 4 missed calls but 0 on all reasons and empty call log at the bottom
* !Screenshot 2025-10-17 at 9.25.26.png|width=1121,height=1271,alt="Screenshot 2025-10-17 at 9.25.26.png"!
The same for Group report
!Screenshot 2025-10-17 at 9.26.43.png|width=1018,height=1238,alt="Screenshot 2025-10-17 at 9.26.43.png"!

* When Agent(s) or Group(s) are selected in the filter, data are shown properly.{quote}

*How to reproduce? Step by step.*

{quote}Haven’t tried, just saw on my {{dev}} CID 100773{quote}

*Expected behavior?*

{quote}Either have missed calls 0 or relevant non-zero data in breakdown and call log.

Requires a bit of investigation as well before fix but imo not worthy to create dedicated spike.

Include fixed behavior in test coverage like in [https://cloudtalk.atlassian.net/browse/DSH-6298|https://cloudtalk.atlassian.net/browse/DSH-6298|smart-link] {quote}

*Additional data:*

Company ID: 100773

Environment: dev

Build version: statistics-api 4.2.0

---

</details>

## Dependencies

*No external dependencies identified yet.*

