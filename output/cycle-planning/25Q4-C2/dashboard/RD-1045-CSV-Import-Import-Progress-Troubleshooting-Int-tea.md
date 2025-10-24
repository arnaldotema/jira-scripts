# CSV Import: Import Progress & Troubleshooting (Int team)

**JPD ID:** [RD-1045](https://cloudtalk.atlassian.net//browse/RD-1045)

---

## Summary

WHAT
Dashboard delivery work for  


## Effort

**Story Points:** 22

**Estimated Sprints:** 1

## Discovery Ballpark

0.3

## Release ETA

**Target Sprint:** Sprint 1

**Estimated Date:** 2025-11-19

*(Based on JPD position 1 of 10 in cycle)*

## Technical Complexity

Here is a summary of the key technical details and considerations for the CSV Import Progress and Troubleshooting project:

1. Technical Changes and Implementations:
   - Implement a new CSV Import Report feature in the Dashboard, allowing users to see the status and progress of their CSV imports.
   - Develop a new REST API to retrieve a list of import jobs and detailed information about a specific import job, including real-time progress statistics, configuration, tags, and metadata.
   - Implement functionality to generate and download a CSV file containing all failed import records, including the original data and error messages.
   - Develop a technique to estimate the total number of records in a CSV file quickly, without the need for a full file iteration, to provide accurate progress tracking and estimated completion times.

2. Affected Services and Components:
   - The Dashboard frontend will be updated to display the new CSV Import Report.
   - The Integrations team will build the new REST API endpoints to support the CSV import functionality.
   - The database schema will be extended to store the original CSV row data and failed import records.

3. Complexity and Challenges:
   - Providing a seamless user experience for monitoring and troubleshooting CSV imports, including displaying real-time progress, error details, and allowing pause/resume functionality.
   - Designing an efficient data storage and retrieval solution for the large volumes of import data and failed records.
   - Implementing an accurate and performant CSV row count estimation algorithm to enable progress tracking without impacting import speed.

4. Notable Technical Considerations:
   - The initial implementation will use a REST API and polling, but the team plans to add WebSocket support for better real-time updates in the future.
   - The team will need to carefully consider the tradeoffs between storage efficiency and query complexity when deciding how to store the failed import records.
   - Extensive automated testing, both at the unit and integration levels, will be crucial to ensure the reliability and stability of the CSV import functionality.

Overall, this project aims to significantly improve the user experience for CSV imports, providing better visibility, control, and troubleshooting capabilities for CloudTalk users and support teams.

<details>
<summary>View detailed technical breakdown</summary>

### [DSH-6091: Dashboard CSV FE: Error Handling + Progress Report](https://cloudtalk.atlassian.net//browse/DSH-6091)

**Type:** Story

h1. *WHAT:*

Together with the Integrations team, we are planning to improve CSV import experience.

We need Dashboard’s team help with implementing CSV Import Report. 

The intended outcome: *Users will be able to see the status + high level progress the CSV files they’ve uploaded and view the details of each CSV file that showcases a granular Status of each field + status reason (Error message) on the entry/field level.*

The full architecture proposal with phases can be found [here|https://www.notion.so/cloudtalkio/Bulk-Data-Uploader-Redesign-20d2bccf284f806eb849ee5ab15aad2f?source=copy_link#20d2bccf284f8015bdc3c0b6856cb52c]

DM [~accountid:6136187f391212007049b1d6] in case of any eng. questions
DM [~accountid:712020:465d15a9-0c0d-4b2e-85e2-e2a604f21974] in case of any UX questions.

h1. *WHY*

# Our current CSV experience is suboptimal, which has a negative impact on our ability to close new business as both new and current customers struggle to use it. 
# We had over 45 L1 tickets in the past 60days connected to the confusion about CSV Import. The biggest struggle is with the error reporting connected to 16 tickets (37% of total). ([+CSV Ticket Analysis+|https://docs.google.com/spreadsheets/d/15Ama1YFR3BpKraJwbg1Tw5kHTR_r8aZnqs_qzYpD3Sg/edit?usp=sharing]+)+



{panel:bgColor=#e3fcef}
*FUNCTIONAL REQUIREMENTS*

👉 [Figma Walkthrough|https://www.loom.com/share/a840d842a03d41dfae917471232bef9b?sid=757915ac-7322-4d3c-b482-9de6d0a1b0f2]

# Component matches figma design
# Component has unit test coverage
# Inputs for a high level status preview are:
## Date of import 
## CSV File name
## Owner = User who initiated the import
## Status = Imported / Error / Processing
## Status Detail = All contacts imported / No contacts imported / X out of 1000 imported (Discuss with Marian the inputs)
## View details = a button that navigates user to the detailed import report
# Inputs for detailed import report contains
## Column ID 
## Name of the imported contact
## Status of the import = Success / Failed
## Reasons = Error message for the failed report. List will be provided by the INT team. 
## Two buttons are available on the right side: 
### Pause which temporarily pauses the import. Users can resume it at any time, and the import will start as long as no other import is currently active. (This satisfies the condition that only one sync is allowed per company at a time.)
### Stop import which cancels the import. Cancelling stops the import allt-ogether but doesn’t revert already imported or updated contacts.
## Aggregate report is available on the right side with 
### Chart outlining how many contacts were imported  and how many failed
### Owner
### Status
### Started
### Runtime
{panel}

Figma Link → The overall UX Flow can be found [here|https://www.figma.com/design/usVZ6fcB5FGJJV3DOZdGq7/WIP-Integration?node-id=6439-11109&t=tKgAutZtwP9LBVqX-4]. The parts relevant to this ask can be found in the [Section 1|https://www.figma.com/design/usVZ6fcB5FGJJV3DOZdGq7/Import-CSV-and-Gsheets?node-id=6439-11366&t=1mrkNRynYZ7Vug4n-4] + [Section 2|https://www.figma.com/design/usVZ6fcB5FGJJV3DOZdGq7/Import-CSV-and-Gsheets?node-id=6439-11384&t=1mrkNRynYZ7Vug4n-4] + [Section 3|https://www.figma.com/design/usVZ6fcB5FGJJV3DOZdGq7/Import-CSV-and-Gsheets?node-id=6555-8467&t=b4LZhHK4TP90nSdc-4]

---

### [DSH-6091 (comment by daniel malachovsky)](https://cloudtalk.atlassian.net//browse/DSH-6091 (comment by daniel malachovsky))

**Type:** Story

 technical question:How do we load the data for imports in processing status? FE will poll BE in interval, or there will be some websocket?


---

### [DSH-6091 (comment by daniel malachovsky)](https://cloudtalk.atlassian.net//browse/DSH-6091 (comment by daniel malachovsky))

**Type:** Story

Sort of ED:
- 2 simple tables with pagination
- Right section with donut chart similar to the one on Campaign detail
- (probably) new toggle component for filtering all/failed rows. We have similar one in Analytics, but not sure if we have one in Dashboard
Rough estimate is 8SP with just unit tests. E2E may be done separately in Appium?


---

### [DSH-6091 (comment by Marian Nociar)](https://cloudtalk.atlassian.net//browse/DSH-6091 (comment by Marian Nociar))

**Type:** Story

Hi , in the initial phase there will only be a REST interface, so I’d expect hot reload or API polling.I’m aware this isn’t an ideal solution, so later on I’d like to add support for WebSockets as well.


---

### [INT-3380: Import Jobs List Endpoint](https://cloudtalk.atlassian.net//browse/INT-3380)

**Type:** Story

h1. WHO

CloudTalk users (via the dashboard interface) who need to view and monitor bulk import operations for their company.

h1. WHAT

Create a REST API endpoint {{GET /v1/imports?limit=50&cursor=abc123}} that returns a paginated list of import jobs for company.

h1. WHY

* *User Visibility*: Users need to see their import history and current job status

* *Monitoring*: Support teams need to monitor import operations across companies

* *Dashboard Integration*: Frontend needs data to display import jobs list page

h1. Automated test notes

_What tests are we going to automate or mention why it was not automated at all_

h1. Acceptance criteria

* C‌over business logic with unit tests and/or e2e tests

---

### [INT-3381: GET Import Job Details Endpoint](https://cloudtalk.atlassian.net//browse/INT-3381)

**Type:** Story

h1. WHO

CloudTalk users (via the dashboard interface) who need to view detailed information about a specific bulk import job

h1. WHAT

Create a REST API endpoint {{GET /v1/imports/jobs/{importId}}} that returns comprehensive details of a single import job, including real-time progress statistics, configuration, tags, and metadata.

h1. WHY

* *Detailed Monitoring*: Users need to see progress and status of individual import operations

* *Troubleshooting*: Support teams need detailed job information to diagnose issues

* *Progress Tracking*: Users want to monitor real-time progress of running imports

* *Configuration Review*: Users need to see what settings were used for a specific import

* *Dashboard Integration*: Frontend needs data for the import job details page

h1. Automated test notes

* Unit tests for the use case logic (job retrieval, data transformation)

* Integration tests for the HTTP handler (path parameter validation, response format)

h1. Acceptance criteria

* AC1
* AC2
* AC3

‌

---

### [INT-3381 (comment by Marian Nociar)](https://cloudtalk.atlassian.net//browse/INT-3381 (comment by Marian Nociar))

**Type:** Story

{
  "data": {
    "id": "123",
    "type": "import_job",
    "attributes": {
      "resourceType": "csv",
      "resourceName": "contacts_january.csv",
      "resourceId": "s3://bucket/files/abc123.csv",
      "status": "running",
      "resolution": null,
      "entity_type": "contact",
      "userEmail": "manager@company.com",
      "processedRows": 1000,
      "successCount": 950,
      "failureCount": 50,
      "config": {
        "mapping": [
          {
            "attribute": "first_name",
            "index": "0",
            "header": "FirstName"
          }
        ]
      },
      "tags": ["january_batch", "high_priority"]
    }
  },
  "request_id": "req-uuid-456"
}

---

### [INT-3382: Generate Failed Records CSV Export](https://cloudtalk.atlassian.net//browse/INT-3382)

**Type:** Story

h1. WHO

CloudTalk Users who need to download and review failed import records with original data and error details to fix issues and re-import corrected data.

h1. WHAT

Implement functionality to generate and download a CSV file containing all failed records from an import job, including original row data and error messages. This includes:

* Database schema changes to store original CSV row data

* CSV generation with original data + error columns

* {{GET /v1/imports/jobs/{importId}/failed-records}} endpoint to generate and download failed records

h1. WHY

* *Data Recovery*: Users can fix errors in the original data and re-import

* *User Experience*: Eliminates need to manually cross-reference logs with original files

* *Efficiency*: Batch error correction instead of individual record fixes

h1. Automated test notes

* Unit tests for CSV generation logic (formatting, escaping, headers)

* E2E tests for CSV download endpoint (content-type, file attachment)

h1. Acceptance criteria

* AC1
* AC2
* AC3

‌

---

### [INT-3382 (comment by Marian Nociar)](https://cloudtalk.atlassian.net//browse/INT-3382 (comment by Marian Nociar))

**Type:** Story

## Extend existing import_logs table
Add an original_row_data column to the existing import_logs table.
Pros:
- Simple implementation - single table for all log data
- No additional joins needed for queries
Cons:
- Storage inefficiency
- Increased table size
## New Table for Failed Records
Create a dedicated table for failed record data
CREATE TABLE import_failed_records (
    id BIGSERIAL PRIMARY KEY,
    import_log_id BIGINT NOT NULL REFERENCES import_logs(id) ON DELETE CASCADE,
    original_row_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_import_failed_records_log_id ON import_failed_records(import_log_id);Pros:
- Storage efficient
- Table size grows proportionally to actual failures
Cons:
- Slightly more complex query
- Requires JOIN to get complete failed records


---

### [INT-3383: Record Count Estimation for Progress Tracking](https://cloudtalk.atlassian.net//browse/INT-3383)

**Type:** Story

h1. WHO

CloudTalk Users (and Dashboard Frontend) that need accurate progress tracking and estimated completion times for bulk import operations without the performance cost of counting all rows upfront.

h1. WHAT

Implement CSV row count estimation logic that predicts the total number of records with reasonable confidence while maintaining fast execution speed, enabling us to provide this information almost instantly after import initiation.

The proposed approach involves analyzing the size of the first X records (100-1000 samples) and extrapolating the total count based on the overall file size.

h1. WHY

* *Progress Tracking*: Users need to see accurate import progress percentages
* *Time Estimation*: Provide realistic ETAs for import completion
* *Performance*: Avoid expensive full-file iteration for large CSVs (>100MB)
* *User Experience*: Show progress immediately when import starts

h1. Automated test notes

* Unit tests

h1. Acceptance criteria

# *Estimation accuracy:*
GIVEN a CSV file is analyzed for row count estimation
WHEN the estimation is compared to the actual row count
THEN achieve ±10% accuracy for estimated size vs reality
# *Performance Requirement:*
GIVEN CSV files of various sizes need row count estimation
WHEN the analysis is performed
THEN analysis shouldn't take more than 3 seconds to provide estimation

‌

---

</details>

## Dependencies

*No external dependencies identified yet.*

