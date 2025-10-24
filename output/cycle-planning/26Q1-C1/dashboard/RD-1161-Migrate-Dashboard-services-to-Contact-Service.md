# Migrate Dashboard services to Contact Service

**JPD ID:** [RD-1161](https://cloudtalk.atlassian.net//browse/RD-1161)

---

## Summary

Migrate all Dashboard services that still rely on direct DB access to the new Contact Service to improve performance, scalability, and governance of contacts data.
Problem
- Contact-related DB tables (contacts, contact_numbers, contact_emails, etc.) are heavily queried and joined in Dashboard services.
- This causes high latency in customer-facing flows (median 30s load times, projected 60s in 12 months).
- Maintaining the legacy table is unsustainable and expensive.

Goals / Acceptance Criteria...

## Effort

**Story Points:** 0

**Estimated Sprints:** 0

## Discovery Ballpark

Not specified

## Release ETA

**Target Sprint:** Sprint 10

**Estimated Date:** 2026-05-20

*(Based on JPD position 6 of 6 in cycle)*

## Technical Complexity

No technical complexity information found in ED sections.

## Dependencies

No dependencies information found in ED sections.

