const axios = require('axios');
const { parseISO, differenceInHours, formatISO } = require('date-fns');

// --- Config ---
require('dotenv').config();

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY;
const MIN_HOURS = 1;
const MAX_HOURS = 24 * 7 * 3;

function buildJQL() {
  return `
    project = "${JIRA_PROJECT_KEY}" AND
    resolved >= 2025-04-01
    ORDER BY created DESC
  `.replace(/\s+/g, ' ').trim();
}

async function fetchIssues(startAt = 0, maxResults = 50) {
  const url = `${JIRA_BASE_URL}/rest/api/3/search`;
  const params = {
    jql: buildJQL(),
    fields: '*all',
    maxResults,
    startAt,
    expand: 'changelog'
  };

  try {
    const res = await axios.get(url, {
      params,
      headers: {
        Authorization: `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`,
        Accept: 'application/json'
      }
    });

    return res.data;
  } catch (err) {
    console.error('[ERROR] Jira API request failed:', err.response?.data);
    throw err;
  }
}

async function getAllIssues() {
  let all = [];
  let startAt = 0;
  let total = 0;

  do {
    const page = await fetchIssues(startAt);
    all = all.concat(page.issues);
    startAt += page.issues.length;
    total = page.total;
  } while (startAt < total);

  return all;
}

function getFirstInProgressDate(changelog) {
  const transitions = [];

  for (const history of changelog.histories) {
    for (const item of history.items) {
      if (item.field === 'status' && item.toString === 'In Progress') {
        transitions.push(history.created);
      }
    }
  }

  if (transitions.length === 0) return null;
  return transitions.sort()[0]; // earliest transition to "In Progress"
}

function extractStoryPoints(issue) {
  return issue.fields?.customfield_10124 || null;
}

function getAssignee(issue) {
  return issue.fields.assignee?.displayName || 'Unassigned';
}

function computeResults(issues) {
  const rows = [];

  for (const issue of issues) {
    const sp = extractStoryPoints(issue);
    const inProgressDate = getFirstInProgressDate(issue.changelog);
    const resolvedDate = issue.fields.resolutiondate;
    const assignee = getAssignee(issue);

    if (!sp || !inProgressDate || !resolvedDate) continue;

    const deltaHours = differenceInHours(parseISO(resolvedDate), parseISO(inProgressDate));
    if (deltaHours < MIN_HOURS || deltaHours > MAX_HOURS) continue;

    rows.push({
      key: issue.key,
      link: `${JIRA_BASE_URL}/browse/${issue.key}`,
      storyPoints: sp,
      assignee: assignee,
      inProgress: formatISO(parseISO(inProgressDate)),
      resolved: formatISO(parseISO(resolvedDate)),
      hours: deltaHours
    });
  }

  return rows;
}

function computeAveragePerStoryPoint(rows, assigneeFilter = null) {
  const bucket = {};
  const filteredRows = assigneeFilter 
    ? rows.filter(row => row.assignee === assigneeFilter)
    : rows;

  for (const row of filteredRows) {
    const sp = row.storyPoints;
    if (!bucket[sp]) bucket[sp] = [];
    bucket[sp].push(row.hours);
  }

  const avg = {};
  for (const sp in bucket) {
    const times = bucket[sp];
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    avg[sp] = {
      count: times.length,
      avgHours: +mean.toFixed(2)
    };
  }
  

  return avg;
}

(async () => {
  try {
    console.log('Fetching Jira issues...');
    const issues = await getAllIssues();
    const results = computeResults(issues);
    console.table(results, ['key', 'storyPoints', 'assignee', 'inProgress', 'resolved', 'hours']);
    
    // Overall averages
    const avgPerSP = computeAveragePerStoryPoint(results);
    console.log('Avg hours per Story Point:');
    console.table(avgPerSP);

    // Per-assignee averages
    const assignees = [...new Set(results.map(r => r.assignee))];
    for (const assignee of assignees) {
      const assigneeAvg = computeAveragePerStoryPoint(results, assignee);
      console.log(`\nAvg hours per Story Point (${assignee}):`);
      console.table(assigneeAvg);
    }

  } catch (err) {
    console.error('[FATAL] Script failed.');
    process.exit(1);
  }
})();
