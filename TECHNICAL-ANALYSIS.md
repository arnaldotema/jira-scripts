# Jira Technical Complexity Analysis Tool

## Quick Start

```bash
cd /Users/arnaldotema/git/jira-scripts
node scripts/jira-technical-complexity.js DSH-5026 DSH-6226 DSH-6276 DSH-6274

# Or use the shortcut:
./scripts/analyze-tickets.sh DSH-5026 DSH-6226 DSH-6276 DSH-6274
```

## What It Does

This script fetches Jira tickets and provides:

1. **Detailed Technical Breakdown** - For each ticket:
   - Full description with context
   - Status, priority, story points
   - Acceptance criteria
   - Related issues and subtasks
   - Links to view in Jira

2. **Relationship Analysis** - When analyzing multiple tickets:
   - Common threads (umbrella tickets)
   - Technical scope comparison
   - Shared components and layers
   - Overlap detection

3. **Implementation Guidance**:
   - Identifies potential duplicate work
   - Coordination notes (database, UI, API layers)
   - Recommended implementation order

## Usage

```bash
node scripts/jira-technical-complexity.js <TICKET-1> [TICKET-2] [TICKET-3] ...
```

**Examples:**

```bash
# Single ticket analysis
node scripts/jira-technical-complexity.js DSH-5026

# Multiple tickets with relationship analysis
node scripts/jira-technical-complexity.js DSH-5026 DSH-6226 DSH-6276 DSH-6274

# Mix of DSH and RD tickets
node scripts/jira-technical-complexity.js DSH-6304 RD-737 RD-1051
```

## Configuration

Uses the `.env` file in the root directory with:
- `JIRA_BASE_URL` - Your Jira instance URL
- `JIRA_EMAIL` - Your Jira email
- `JIRA_API_TOKEN` - Your Jira API token

## Output Format

The script provides markdown-formatted output optimized for:
- Human readability
- Technical clarity
- Copy-paste into documentation
- Sharing with team members

### Output Sections

1. **Technical Complexity Analysis**
   - Individual ticket details with full context
   - Technical requirements extracted
   - Related issues mapped

2. **Technical Synthesis & Relationships** (for multiple tickets)
   - Overview of common themes
   - Scope breakdown by ticket
   - Relationship mapping
   - Overlap analysis with recommendations
   - Implementation coordination notes
   - Suggested implementation order

## Tips

- Use this before sprint planning to understand ticket relationships
- Run on groups of tickets that seem related to identify coordination needs
- Share output with team to align on technical approach
- Use the "Implementation Coordination Notes" to inform architecture decisions
