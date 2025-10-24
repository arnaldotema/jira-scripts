# Onboarding | UI Improvements for Analytics

**JPD ID:** [RD-995](https://cloudtalk.atlassian.net//browse/RD-995)

---

## Summary

WHAT
This is a follow-up of  We aim to introduce a set of quick-win UI enhancements to the Analytics interface that can elevate the perceived quality and visual polish without a full redesign. These changes will target low-effort, high-impact elements such as:
- Navigation revamp
- Refined spacing and layout adjustments
- Restyling of the metric cards
The initiative is not intended to modify core user flows or architecture but to enhance the aesthetics and cohesiveness of the Dashboard.
WHY
Desp...

## Effort

**Story Points:** 17.5

**Estimated Sprints:** 1

## Discovery Ballpark

Not specified

## Release ETA

**Target Sprint:** Sprint 15

**Estimated Date:** 2026-06-02

*(Based on JPD position 8 of 10 in cycle)*

## Technical Complexity

Here is a 3-paragraph summary of the technical changes, affected services/components, complexity, and notable challenges for the Analytics UI Improvements:

The key technical changes required for this project involve updating the header navigation in the Analytics section of the product. This includes matching the styling and component approach used in the Dashboard header, ensuring responsive behavior across devices, and adding page names and descriptions. The goal is to provide a consistent, intuitive user experience for navigating the various Analytics features like Call Log, Agent Reports, Real-Time monitoring, and AI-powered analytics (Tickets DSH-6038, DSH-5956).

The main components and services affected are the Analytics header, navigation, and page content. While the overall implementation does not seem to require any backend or functional logic changes, there may be some complexity in ensuring a seamless integration with the existing Dashboard UI components and styling. The team will need to carefully evaluate design consistency and shared component opportunities between the Analytics and Dashboard modules.

A notable technical challenge is the amount of new content and copy that needs to be incorporated across the various Analytics pages. The team will need to work closely with product and design to finalize the messaging and ensure it provides clear explanations of each feature's purpose and functionality to the end users. Additionally, the responsive behavior and layout adaptations across mobile, tablet, and desktop views will require thorough testing and QA.

<details>
<summary>View detailed technical breakdown</summary>

### [DSH-6038: Update Header Navigation in Analytics](https://cloudtalk.atlassian.net//browse/DSH-6038)

**Type:** Story

*Summary:*

Update the Analytics header navigation to match the Dashboard header styles. 

*Acceptance Criteria:*

* Responsive behavior works correctly across devices (mobile, tablet, desktop)
* The name of the page with description is added
* Navigation links and routing remain unchanged

*Notes:*

* Use the same styling and component approach as the Dashboard header navigation 
* Confirm with design if any Analytics-specific elements require custom treatment


*Copy for the pages:*

* *Call log:* Explore all call activity in one place. Identify trends, spot anomalies, and drill into individual calls to better understand communication flows.
* *Agent report:* See how each agent is performing, track trends over time, and identify coaching opportunities.
* *VoiceAgent report:* Get a detailed view of voice agent activity across all call types. Monitor performance, identify trends, and ensure every conversation meets your standards.
* *Group report:* Understand how different teams contribute to your call operations. Compare performance across groups and align resources where they’re needed most.
* *Messages*: Gain visibility into your messaging traffic. Track sent and received messages to ensure communication remains timely and effective.
* *Real time:* Monitor what’s happening right now. Stay on top of agent availability, active calls, and queue status as they happen.
* *Wallboard:* Keep teams aligned with real-time stats displayed on a shared screen. Designed for visibility in busy support or sales environments.
* *Tags*: Break down call data by key themes or workflows. Tags help you organize and analyze conversations based on what matters most to your business.
* *AI* *analytics*: Unlock insights from call content with AI. Automatically detect topics, summarize conversations, and surface key information without manual review.

---

### [DSH-5956 (comment by Arnaldo Tema)](https://cloudtalk.atlassian.net//browse/DSH-5956 (comment by Arnaldo Tema))

**Type:** Story

seems to involve the rewrite and implementation of new components. we should consider sharing these with Dashboard. No BE of functional logic in place. I’m unable to si

---

</details>

## Dependencies

*No external dependencies identified yet.*

