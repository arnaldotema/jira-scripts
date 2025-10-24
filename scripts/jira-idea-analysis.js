const axios = require('axios');
const { parseISO, formatISO } = require('date-fns');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

// --- Config ---
require('dotenv').config();

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

// BambooHR Config
const BAMBOOHR_API_KEY = process.env.BAMBOOHR_API_KEY;

// Board IDs for velocity calculation
const SCRUM_BOARDS = {
  'Dashboard': 56,
  'Back Office + Internal Tools': 100
};

// Team sizes for Person Sprints calculation
const TEAM_SIZES = {
  'Dashboard': 6,
  'Back Office + Internal Tools': 4
};

// --- Config Loading Functions ---

function loadConfig() {
  try {
    const configPath = path.join(__dirname, '..', 'config', 'teams.yaml');
    const fileContents = fs.readFileSync(configPath, 'utf8');
    return yaml.load(fileContents);
  } catch (error) {
    console.error('[ERROR] Failed to load config file:', error.message);
    return null;
  }
}

// --- BambooHR Functions ---

async function fetchTimeOffData(subdomain, startDate, endDate) {
  if (!BAMBOOHR_API_KEY) {
    console.warn('[WARN] BambooHR API key not found. Skipping PTO calculations.');
    return [];
  }

  try {
    // Convert DD-MM-YYYY to YYYY-MM-DD format for BambooHR API
    const formatDateForAPI = (dateStr) => {
      const [day, month, year] = dateStr.split('-');
      return `${year}-${month}-${day}`;
    };

    const formattedStartDate = formatDateForAPI(startDate);
    const formattedEndDate = formatDateForAPI(endDate);

    // Try the time off requests endpoint first
    const url = `https://api.bamboohr.com/api/gateway.php/${subdomain}/v1/time_off/requests`;
    
    const response = await axios.get(url, {
      auth: {
        username: BAMBOOHR_API_KEY,
        password: 'x'
      },
      params: {
        start: formattedStartDate,
        end: formattedEndDate,
        status: 'approved'
      },
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    return response.data || [];
  } catch (error) {
    // Try alternative endpoint if the first one fails
    try {
      const formatDateForAPI = (dateStr) => {
        const [day, month, year] = dateStr.split('-');
        return `${year}-${month}-${day}`;
      };

      const formattedStartDate = formatDateForAPI(startDate);
      const formattedEndDate = formatDateForAPI(endDate);

      // Alternative endpoint - time off balances/requests
      const url = `https://api.bamboohr.com/api/gateway.php/${subdomain}/v1/time_off/requests?action=view&type=all`;
      
      const response = await axios.get(url, {
        auth: {
          username: BAMBOOHR_API_KEY,
          password: 'x'
        },
        headers: {
          'Accept': 'application/json'
        }
      });

      // Filter results by date range if we get data
      const allRequests = response.data || [];
      if (Array.isArray(allRequests)) {
        return allRequests.filter(request => {
          const requestStart = new Date(request.start || request.startDate);
          const requestEnd = new Date(request.end || request.endDate);
          const rangeStart = new Date(formattedStartDate);
          const rangeEnd = new Date(formattedEndDate);
          
          return requestStart <= rangeEnd && requestEnd >= rangeStart;
        });
      }
      
      return [];
    } catch (secondError) {
      console.warn('[WARN] Failed to fetch BambooHR data:', error.response?.data || error.message);
      console.warn('[DEBUG] Also tried alternative endpoint:', secondError.response?.data || secondError.message);
      return [];
    }
  }
}

function getWorkingDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  let workingDays = 0;
  
  let currentDate = new Date(start);
  while (currentDate <= end) {
    const dayOfWeek = currentDate.getDay();
    // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      workingDays++;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return workingDays;
}

function calculatePTOImpact(timeOffData, teamMembers, quarterStart, quarterEnd) {
  const totalWorkingDays = getWorkingDays(quarterStart, quarterEnd);
  let totalPTODays = 0;

  // Calculate total PTO days for all team members during the quarter
  for (const member of teamMembers) {
    const memberPTO = timeOffData.filter(request => {
      // Match by employee name from BambooHR data structure
      const employeeName = request.name || request.employee?.displayName || request.employee?.firstName + ' ' + request.employee?.lastName;
      return employeeName === member;
    });

    for (const pto of memberPTO) {
      // Use the correct date fields from BambooHR API
      const ptoStartDate = new Date(pto.start);
      const ptoEndDate = new Date(pto.end);
      const quarterStartDate = new Date(quarterStart);
      const quarterEndDate = new Date(quarterEnd);
      
      // Calculate overlap between PTO period and quarter period
      const overlapStart = new Date(Math.max(ptoStartDate.getTime(), quarterStartDate.getTime()));
      const overlapEnd = new Date(Math.min(ptoEndDate.getTime(), quarterEndDate.getTime()));
      
      if (overlapStart <= overlapEnd) {
        const ptoDays = getWorkingDays(overlapStart, overlapEnd);
        totalPTODays += ptoDays;
      }
    }
  }

  // Calculate capacity reduction as percentage
  const capacityReduction = totalPTODays / (teamMembers.length * totalWorkingDays);
  return Math.min(capacityReduction, 1); // Cap at 100% reduction
}

function parseDateDDMMYYYY(dateStr) {
  const [day, month, year] = dateStr.split('-');
  return new Date(year, month - 1, day); // month is 0-indexed
}

// Create auth header
const getAuthHeader = () => ({
  Authorization: `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`,
  Accept: 'application/json'
});

/**
 * Extract issue key from various input formats
 */
function extractIssueKey(input) {
  const trimmed = input.trim();
  
  // Handle full Jira URLs like https://cloudtalk.atlassian.net/browse/RD-731
  if (trimmed.includes('/browse/')) {
    const match = trimmed.match(/\/browse\/([A-Z]+-\d+)/);
    if (match) {
      return match[1];
    }
  }
  
  // Handle direct issue keys like RD-731
  if (trimmed.match(/^[A-Z]+-\d+$/)) {
    return trimmed;
  }
  
  // Handle just numbers like 731 (assume RD project)
  if (trimmed.match(/^\d+$/)) {
    return `RD-${trimmed}`;
  }
  
  // If none of the above, try to extract any pattern that looks like an issue key
  const issueKeyMatch = trimmed.match(/([A-Z]+-\d+)/);
  if (issueKeyMatch) {
    return issueKeyMatch[1];
  }
  
  // Fallback: assume it's a number and prefix with RD-
  if (trimmed.match(/^\d+$/)) {
    return `RD-${trimmed}`;
  }
  
  return trimmed; // Return as-is if we can't parse it
}

/**
 * Parse command line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const ideaIds = [];
  const quarters = [];
  const teams = [];
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-ids' && args[i + 1]) {
      // Parse comma-separated IDs and extract issue keys
      const ids = args[i + 1].split(',').map(id => extractIssueKey(id));
      ideaIds.push(...ids);
      i++; // Skip the next argument since we consumed it
    } else if (args[i] === '-q' && args[i + 1]) {
      // Parse comma-separated quarters and format them
      const qs = args[i + 1].split(',').map(q => formatQuarter(q.trim()));
      quarters.push(...qs);
      i++; // Skip the next argument since we consumed it
    } else if (args[i] === '-teams' && args[i + 1]) {
      // Parse comma-separated team names
      const teamList = args[i + 1].split(',').map(team => team.trim());
      teams.push(...teamList);
      i++; // Skip the next argument since we consumed it
    }
  }
  
  return { ideaIds, quarters, teams };
}

/**
 * Format quarter input to standard format
 */
function formatQuarter(input) {
  // Convert inputs like "q425c1" to "Q4'25.C1"
  const cleaned = input.toUpperCase().replace(/[^Q0-9C'\.]/g, '');
  
  // Handle formats like Q425C1, Q4'25C1, etc.
  const match = cleaned.match(/Q(\d)(\d{2})C(\d)/);
  if (match) {
    const [, quarter, year, cycle] = match;
    return `Q${quarter}'${year}.C${cycle}`;
  }
  
  // If already in correct format, return as-is
  if (cleaned.match(/Q\d'\d{2}\.C\d/)) {
    return cleaned;
  }
  
  return input; // Return original if we can't parse it
}

/**
 * Fetch Ideas by quarters
 */
async function fetchIdeasByQuarters(quarters, teams = ['Dashboard', 'Back Office + Internal Tools']) {
  console.log(`Fetching ALL Ideas for quarters: ${quarters.join(', ')}`);
  console.log(`Filtering by teams: ${teams.join(', ')}`);
  const ideas = [];
  
  try {
    // Build JQL query to find all Ideas with matching quarter values
    // Since the quarter fields are multi-select dropdowns, we need to search for each quarter value
    const quarterConditions = [];
    
    for (const quarter of quarters) {
      // Search in both Committed In and Roadmap Cycle fields using IN operator for multi-select fields
      quarterConditions.push(`customfield_10620 in ("${quarter}")`);
      quarterConditions.push(`customfield_10621 in ("${quarter}")`);
    }
    
    const jql = `issuetype = "Idea" AND (${quarterConditions.join(' OR ')})`;
    
    console.log(`JQL Query: ${jql}`);
    
    const url = `${JIRA_BASE_URL}/rest/api/3/search/jql`;
    const requestBody = {
      jql: jql,
      fields: [
        'summary',
        'customfield_10124',  // Story Points
        'issuelinks',
        'project',
        'customfield_10596',  // Lead Team
        'issuetype',
        'customfield_10620',  // Committed In
        'customfield_10621'   // Roadmap Cycle
      ],
      maxResults: 100
    };
    
    const response = await axios.post(url, requestBody, {
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data.issues && response.data.issues.length > 0) {
      for (const issue of response.data.issues) {
        const committedIn = issue.fields.customfield_10620 || [];
        const roadmapCycle = issue.fields.customfield_10621 || [];
        
        // Extract quarter values from arrays
        const committedQuarters = Array.isArray(committedIn) 
          ? committedIn.map(item => item.value) 
          : [];
        const roadmapQuarters = Array.isArray(roadmapCycle) 
          ? roadmapCycle.map(item => item.value) 
          : [];
        
        const allQuarters = [...committedQuarters, ...roadmapQuarters];
        const leadTeam = issue.fields.customfield_10596?.value || 'Unknown';
        
        // Filter by team
        if (teams.includes(leadTeam)) {
          ideas.push(issue);
        }
      }
    }
    
    console.log(`\nSuccessfully fetched ${ideas.length} Ideas for analysis\n`);
    return ideas;
    
  } catch (error) {
    console.error('[ERROR] Failed to fetch Ideas by quarters:', error.response?.data || error.message);
    console.log('\nFalling back to empty results...\n');
    return [];
  }
}

/**
 * Fetch specific Ideas by their IDs
 */
async function fetchIdeasByIds(ideaIds, teams = ['Dashboard', 'Back Office + Internal Tools']) {
  console.log(`Fetching ${ideaIds.length} specific Ideas: ${ideaIds.join(', ')}`);
  console.log(`Filtering by teams: ${teams.join(', ')}`);
  
  const ideas = [];
  
  for (const issueKey of ideaIds) {
    try {
      const url = `${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}`;
      const params = {
        fields: 'summary,customfield_10124,issuelinks,project,customfield_10596,issuetype,customfield_10620,customfield_10621'
      };

      console.log(`Fetching ${issueKey}...`);
      
      const response = await axios.get(url, {
        params,
        headers: getAuthHeader()
      });
      
      const issue = response.data;
      
      // Verify it's an Idea
      if (issue.fields.issuetype.name === 'Idea') {
        const leadTeam = issue.fields.customfield_10596?.value || 'Unknown';
        
        // Filter by team
        if (teams.includes(leadTeam)) {
          ideas.push(issue);
        }
      }
      
    } catch (error) {
      // Silently ignore errors
    }
  }
  
  console.log(`\nSuccessfully fetched ${ideas.length} Ideas for analysis\n`);
  return ideas;
}

/**
 * Main fetch function that routes to appropriate method
 */
async function fetchIdeas(ideaIds, quarters, teams = ['Dashboard', 'Back Office + Internal Tools']) {
  if (quarters && quarters.length > 0) {
    return await fetchIdeasByQuarters(quarters, teams);
  } else if (ideaIds && ideaIds.length > 0) {
    return await fetchIdeasByIds(ideaIds, teams);
  } else {
    console.error('[ERROR] No Idea IDs or quarters provided.');
    console.error('Usage: node jira-idea-analysis.js -ids 732,731,730');
    console.error('   or: node jira-idea-analysis.js -q q425c1,q425c2');
    process.exit(1);
  }
}

/**
 * Get linked items from an Idea issue
 */
function getLinkedItems(issue) {
  const linkedItems = [];
  
  if (issue.fields.issuelinks) {
    for (const link of issue.fields.issuelinks) {
      // Check for inward links (items linked TO this idea)
      if (link.inwardIssue && link.type.name === 'Polaris work item link') {
        linkedItems.push(link.inwardIssue.key);
      }
      // Check for outward links (items this idea links TO)
      if (link.outwardIssue && link.type.name === 'Polaris work item link') {
        linkedItems.push(link.outwardIssue.key);
      }
    }
  }
  
  return linkedItems;
}

/**
 * Fetch issue details including story points and child items
 */
async function fetchIssueDetails(issueKey) {
  const url = `${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}`;
  const params = {
    fields: 'issuetype,customfield_10124,project,summary',
    expand: 'children'
  };

  try {
    const response = await axios.get(url, {
      params,
      headers: getAuthHeader()
    });
    return response.data;
  } catch (error) {
    console.error(`[ERROR] Failed to fetch issue ${issueKey}:`, error.response?.data);
    return null;
  }
}

/**
 * Get child issues of an epic
 */
async function getEpicChildren(epicKey) {
  // Try different JQL patterns for Epic children
  const jqlOptions = [
    `"Epic Link" = ${epicKey}`,
    `"Epic Link" = "${epicKey}"`,
    `parent = ${epicKey}`
  ];
  
  for (const jql of jqlOptions) {
    try {
      const url = `${JIRA_BASE_URL}/rest/api/3/search/jql`;
      const response = await axios.post(url, {
        jql,
        fields: ['customfield_10124', 'summary', 'issuetype', 'resolved'],
        maxResults: 100
      }, {
        headers: {
          ...getAuthHeader(),
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.issues && response.data.issues.length > 0) {
        // Filter out resolved items - only include items where 'resolved' is empty/null
        const allIssues = response.data.issues;
        const unresolvedIssues = allIssues.filter(issue => 
          !issue.fields.resolved // resolved field is null/empty for unresolved items
        );
        
        const resolvedCount = allIssues.length - unresolvedIssues.length;
        if (resolvedCount > 0) {
          console.log(`[INFO] Epic ${epicKey}: Found ${allIssues.length} child items, excluding ${resolvedCount} resolved items (counting only ${unresolvedIssues.length} unresolved)`);
        }
        
        return unresolvedIssues;
      }
    } catch (error) {
      // Try next JQL pattern
      continue;
    }
  }
  
  // Also try the Agile API for Epic issues
  try {
    const url = `${JIRA_BASE_URL}/rest/agile/1.0/epic/${epicKey}/issue`;
    const response = await axios.get(url, {
      params: {
        fields: 'customfield_10124,summary,issuetype,resolved',
        maxResults: 100
      },
      headers: getAuthHeader()
    });
    
    if (response.data.issues && response.data.issues.length > 0) {
      // Filter out resolved items - only include items where 'resolved' is empty/null
      const allIssues = response.data.issues;
      const unresolvedIssues = allIssues.filter(issue => 
        !issue.fields.resolved // resolved field is null/empty for unresolved items
      );
      
      const resolvedCount = allIssues.length - unresolvedIssues.length;
      if (resolvedCount > 0) {
        console.log(`[INFO] Epic ${epicKey}: Found ${allIssues.length} child items, excluding ${resolvedCount} resolved items (counting only ${unresolvedIssues.length} unresolved)`);
      }
      
      return unresolvedIssues;
    }
  } catch (error) {
    // Ignore error, return empty array
  }
  
  return [];
}

/**
 * Calculate story points for an issue
 */
async function calculateStoryPoints(issueKey) {
  const issue = await fetchIssueDetails(issueKey);
  if (!issue) return 0;

  const storyPoints = issue.fields.customfield_10124;
  
  // If issue has story points, return them
  if (storyPoints && storyPoints > 0) {
    return storyPoints;
  }

  // If it's an epic without story points, sum up children
  if (issue.fields.issuetype.name === 'Epic') {
    const children = await getEpicChildren(issueKey);
    let totalPoints = 0;
    
    for (const child of children) {
      const childPoints = child.fields.customfield_10124 || 0;
      totalPoints += childPoints;
    }
    
    return totalPoints;
  }

  return 0;
}

/**
 * Get team velocity from scrum board
 */
async function getTeamVelocity(teamName, date = null) {
  const boardId = SCRUM_BOARDS[teamName];
  if (!boardId) {
    return 1; // Default velocity to avoid division by zero
  }

  try {
    // Get velocity report from the board
    const url = `${JIRA_BASE_URL}/rest/greenhopper/1.0/rapid/charts/velocity`;
    const params = {
      rapidViewId: boardId
    };

    const response = await axios.get(url, {
      params,
      headers: getAuthHeader()
    });

    const velocityData = response.data.velocityStatEntries;
    
    if (!velocityData || Object.keys(velocityData).length === 0) {
      return 1;
    }

    // Get the last 3 sprints and calculate average based on completed story points
    const sprintEntries = Object.values(velocityData).slice(-3);
    
    if (sprintEntries.length > 0) {
      const totalCompleted = sprintEntries.reduce((sum, sprint) => 
        sum + (sprint.completed?.value || 0), 0);
      const avgVelocity = totalCompleted / sprintEntries.length;
      
      return Math.max(avgVelocity, 1); // Ensure minimum velocity of 1
    }

    return 1; // Default velocity
  } catch (error) {
    return 1; // Default velocity
  }
}

/**
 * Get team name from Lead Team field
 */
function getTeamName(issue) {
  const leadTeamField = issue.fields.customfield_10596;
  
  // Lead Team field returns an object with a 'value' property
  const teamValue = leadTeamField?.value;
  
  if (teamValue === 'Dashboard') return 'Dashboard';
  if (teamValue === 'Back Office + Internal Tools') return 'Back Office + Internal Tools';
  
  // Fallback: try to determine from project key
  const projectKey = issue.fields.project.key;
  if (projectKey === 'DSH') return 'Dashboard';
  if (projectKey === 'BIT') return 'Back Office + Internal Tools';
  
  return 'Unknown';
}

/**
 * Display custom table with clickable links and colors
 */
function displayCustomTable(results) {
  // Sort results by team (Dashboard first, then Back Office + Internal Tools, then Unknown)
  const sortedResults = [...results].sort((a, b) => {
    const teamOrder = {
      'Dashboard': 1,
      'Back Office + Internal Tools': 2,
      'Unknown': 3
    };
    
    const aOrder = teamOrder[a.team] || 4;
    const bOrder = teamOrder[b.team] || 4;
    
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    
    // Within same team, sort by ideaKey
    return a.ideaKey.localeCompare(b.ideaKey);
  });

  // Color codes
  const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    
    // Text colors
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    
    // Background colors
    bgBlue: '\x1b[44m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgCyan: '\x1b[46m'
  };
  
  // Create clickable links using terminal escape sequences
  const createLink = (url, text) => `\u001b]8;;${url}\u001b\\${text}\u001b]8;;\u001b\\`;
  
  // Calculate column widths for new order: Team, Committed, Roadmap, IdeaKey, Summary, Linked, SP, Team Sprints, Person Sprints
  const maxTeamWidth = Math.max(4, ...sortedResults.map(r => r.team.length));
  const maxCommittedWidth = Math.max(9, ...sortedResults.map(r => r.committedIn.length));
  const maxRoadmapWidth = Math.max(8, ...sortedResults.map(r => r.roadmapCycle.length));
  const maxKeyWidth = Math.max(8, ...sortedResults.map(r => r.ideaKey.length));
  const maxSummaryWidth = Math.max(12, Math.min(40, ...sortedResults.map(r => r.ideaSummary.length)));
  
  // Helper function to pad text (accounting for color codes and links)
  const pad = (text, width) => {
    const visibleLength = text.replace(/\u001b\]8;;[^\u001b]*\u001b\\|\u001b\]8;;\u001b\\|\x1b\[[0-9;]*m/g, '').length;
    const padding = Math.max(0, width - visibleLength);
    return text + ' '.repeat(padding);
  };
  
  // Truncate text if too long
  const truncate = (text, maxWidth) => {
    if (text.length <= maxWidth) return text;
    return text.substring(0, maxWidth - 3) + '...';
  };
  
  // Team color mapping
  const getTeamColor = (team) => {
    switch(team) {
      case 'Dashboard': return colors.blue;
      case 'Back Office + Internal Tools': return colors.green;
      default: return colors.gray;
    }
  };
  
  // Story points color based on size
  const getStoryPointsColor = (points) => {
    if (points === 0) return colors.gray;
    if (points <= 13) return colors.green;
    if (points <= 50) return colors.yellow;
    return colors.red;
  };
  
  // Sprint estimation color
  const getSprintColor = (sprints) => {
    if (sprints === 0) return colors.gray;
    if (sprints <= 1) return colors.green;
    if (sprints <= 3) return colors.yellow;
    return colors.red;
  };
  
  // Header with styling
  // Header - new order: Team, Committed, Roadmap, IdeaKey, Summary, Linked, SP, Team Sprints, Person Sprints
  console.log('');
  console.log(colors.bright + colors.cyan + '┌─' + '─'.repeat(maxTeamWidth) + '─┬─' + '─'.repeat(maxCommittedWidth) + '─┬─' + '─'.repeat(maxRoadmapWidth) + '─┬─' + '─'.repeat(maxKeyWidth) + '─┬─' + '─'.repeat(maxSummaryWidth) + '─┬─────────┬──────┬─────────────┬───────────────┐' + colors.reset);
  console.log(colors.bright + colors.cyan + '│ ' + colors.white + pad('Team', maxTeamWidth) + colors.cyan + ' │ ' + colors.white + pad('Committed', maxCommittedWidth) + colors.cyan + ' │ ' + colors.white + pad('Roadmap', maxRoadmapWidth) + colors.cyan + ' │ ' + colors.white + pad('IdeaKey', maxKeyWidth) + colors.cyan + ' │ ' + colors.white + pad('Summary', maxSummaryWidth) + colors.cyan + ' │ ' + colors.white + 'Linked  ' + colors.cyan + '│ ' + colors.white + 'SP   ' + colors.cyan + '│ ' + colors.white + 'Team Sprints' + colors.cyan + '│ ' + colors.white + 'Person Sprints' + colors.cyan + '│' + colors.reset);
  console.log(colors.bright + colors.cyan + '├─' + '─'.repeat(maxTeamWidth) + '─┼─' + '─'.repeat(maxCommittedWidth) + '─┼─' + '─'.repeat(maxRoadmapWidth) + '─┼─' + '─'.repeat(maxKeyWidth) + '─┼─' + '─'.repeat(maxSummaryWidth) + '─┼─────────┼──────┼─────────────┼───────────────┤' + colors.reset);
  
  // Data rows with colors
  sortedResults.forEach((result, index) => {
    const teamColor = getTeamColor(result.team);
    const spColor = getStoryPointsColor(result.totalStoryPoints);
    const tSprintColor = getSprintColor(result.estimatedSprints);
    const pSprintColor = getSprintColor(typeof result.personSprints === 'number' ? result.personSprints / 10 : 0);
    
    // Alternate row background for better readability
    const rowBg = index % 2 === 0 ? '' : colors.dim;
    
    const clickableKey = colors.bright + colors.magenta + createLink(result.ideaUrl, result.ideaKey) + colors.reset;
    const clickableSummary = colors.bright + createLink(result.ideaUrl, truncate(result.ideaSummary, maxSummaryWidth)) + colors.reset;
    
    // Quarter colors
    const committedColor = result.committedIn !== '-' ? colors.yellow : colors.gray;
    const roadmapColor = result.roadmapCycle !== '-' ? colors.yellow : colors.gray;
    
    // New order: Team, Committed, Roadmap, IdeaKey, Summary, Linked, SP, Team Sprints, Person Sprints
    console.log(rowBg + colors.cyan + '│ ' + teamColor + colors.bright + pad(result.team, maxTeamWidth) + colors.reset + colors.cyan + ' │ ' +
                committedColor + pad(result.committedIn, maxCommittedWidth) + colors.reset + colors.cyan + ' │ ' +
                roadmapColor + pad(result.roadmapCycle, maxRoadmapWidth) + colors.reset + colors.cyan + ' │ ' +
                pad(clickableKey, maxKeyWidth) + colors.cyan + ' │ ' +
                pad(clickableSummary, maxSummaryWidth) + colors.cyan + ' │ ' +
                colors.white + pad(result.linkedItems.toString(), 7) + colors.cyan + ' │ ' +
                spColor + colors.bright + pad(result.totalStoryPoints.toString(), 4) + colors.reset + colors.cyan + ' │ ' +
                tSprintColor + colors.bright + pad(result.estimatedSprints.toString(), 11) + colors.reset + colors.cyan + ' │ ' +
                pSprintColor + colors.bright + pad(result.personSprints.toString(), 12) + colors.reset + colors.cyan + ' │' + colors.reset);
  });
  
  console.log(colors.bright + colors.cyan + '└─' + '─'.repeat(maxTeamWidth) + '─┴─' + '─'.repeat(maxCommittedWidth) + '─┴─' + '─'.repeat(maxRoadmapWidth) + '─┴─' + '─'.repeat(maxKeyWidth) + '─┴─' + '─'.repeat(maxSummaryWidth) + '─┴─────────┴──────┴─────────────┴───────────────┘' + colors.reset);
  
  // Legend
  console.log('');
  console.log(colors.dim + 'Legend: ' + 
              colors.green + '●' + colors.reset + colors.dim + ' Low effort  ' +
              colors.yellow + '●' + colors.reset + colors.dim + ' Medium effort  ' +
              colors.red + '●' + colors.reset + colors.dim + ' High effort  ' +
              colors.gray + '●' + colors.reset + colors.dim + ' No work' + colors.reset);
}

/**
 * Display results table with clickable links
 */
function displayResultsTable(results) {
  if (results.length === 0) {
    console.log('No results to display.');
    return;
  }

  // Show custom table with clickable links
  console.log('=== DETAILED TABLE ===');
  displayCustomTable(results);
}

/**
 * Main analysis function
 */
async function analyzeIdeas(ideaIds, quarters, teams = ['Dashboard', 'Back Office + Internal Tools']) {
  try {
    const ideas = await fetchIdeas(ideaIds, quarters, teams);

    const results = [];

    console.log(`\nCalculating results...`);

    for (const idea of ideas) {
      const linkedItems = getLinkedItems(idea);
      
      let totalStoryPoints = 0;
      
      // Calculate story points for each linked item
      for (const linkedKey of linkedItems) {
        const points = await calculateStoryPoints(linkedKey);
        totalStoryPoints += points;
      }
      
      const teamName = getTeamName(idea);
      const velocity = await getTeamVelocity(teamName);
      const estimatedSprints = totalStoryPoints / velocity;
      
      // Calculate Person Sprints
      const teamSize = TEAM_SIZES[teamName];
      const personSprints = teamSize ? +(estimatedSprints * teamSize).toFixed(2) : 'n/a';
      
      // Extract quarter information for display
      const committedIn = idea.fields.customfield_10620 || [];
      const roadmapCycle = idea.fields.customfield_10621 || [];
      
      const committedQuarters = Array.isArray(committedIn) 
        ? committedIn.map(item => item.value).join(', ') 
        : '-';
      const roadmapQuarters = Array.isArray(roadmapCycle) 
        ? roadmapCycle.map(item => item.value).join(', ') 
        : '-';
      
      results.push({
        ideaKey: idea.key,
        ideaSummary: idea.fields.summary,
        ideaUrl: `${JIRA_BASE_URL}/browse/${idea.key}`,
        team: teamName,
        committedIn: committedQuarters || '-',
        roadmapCycle: roadmapQuarters || '-',
        linkedItems: linkedItems.length,
        totalStoryPoints,
        teamVelocity: velocity,
        estimatedSprints: +estimatedSprints.toFixed(2),
        personSprints: personSprints
      });
    }

    return results;
  } catch (error) {
    console.error('[FATAL] Analysis failed:', error);
    throw error;
  }
}

/**
 * Display team summary table with enhanced styling and PTO-aware capacity
 */
async function displayTeamSummaryTable(teamQuarterSummary, config = null, ptoData = []) {
  const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m'
  };

  const entries = Object.entries(teamQuarterSummary);
  
  if (entries.length === 0) {
    console.log(colors.gray + 'No team summary data available.' + colors.reset);
    return;
  }

  // Sort entries by team name first, then by commitment type (Committed before Roadmap)
  entries.sort(([keyA], [keyB]) => {
    // Extract team name and commitment type
    const [teamA, typeA] = keyA.split(' (');
    const [teamB, typeB] = keyB.split(' (');
    
    // First sort by team name
    if (teamA !== teamB) {
      // Put Dashboard first, then Back Office + Internal Tools, then others
      if (teamA === 'Dashboard' && teamB !== 'Dashboard') return -1;
      if (teamB === 'Dashboard' && teamA !== 'Dashboard') return 1;
      if (teamA === 'Back Office + Internal Tools' && teamB !== 'Back Office + Internal Tools') return -1;
      if (teamB === 'Back Office + Internal Tools' && teamA !== 'Back Office + Internal Tools') return 1;
      return teamA.localeCompare(teamB);
    }
    
    // Same team, sort by commitment type (Committed before Roadmap)
    if (typeA.includes('Committed') && typeB.includes('Roadmap')) return -1;
    if (typeA.includes('Roadmap') && typeB.includes('Committed')) return 1;
    return typeA.localeCompare(typeB);
  });

  // Fetch team velocities
  const teamVelocities = {};
  const uniqueTeams = [...new Set(entries.map(([key]) => key.split(' (')[0]))];
  
  for (const teamName of uniqueTeams) {
    try {
      teamVelocities[teamName] = await getTeamVelocity(teamName);
    } catch (error) {
      teamVelocities[teamName] = 'N/A';
    }
  }

  // Calculate column widths
  const maxTeamWidth = Math.max(20, ...entries.map(([key]) => key.length));
  const maxVelocityWidth = 8; // Velocity
  const maxIdeasWidth = 5;
  const maxSPWidth = 6;
  const maxTeamSprintsWidth = 12;
  const maxPersonSprintsWidth = 19; // PS
  const maxPSTargetWidth = 9; // PS Target
  const maxBufferWidth = 17; // Buffer (goal +20%)

  // Helper function to pad text
  const pad = (text, width) => {
    const visibleLength = text.replace(/\u001b\]8;;[^\u001b]*\u001b\\|\u001b\]8;;\u001b\\|\x1b\[[0-9;]*m/g, '').length;
    const padding = Math.max(0, width - visibleLength);
    return text + ' '.repeat(padding);
  };

  // Get team colors
  const getTeamColor = (teamName) => {
    if (teamName.includes('Dashboard')) return colors.blue;
    if (teamName.includes('Back Office + Internal Tools')) return colors.green;
    return colors.gray;
  };

  // Get commitment type colors
  const getCommitmentColor = (teamName) => {
    if (teamName.includes('Committed')) return colors.yellow;
    if (teamName.includes('Roadmap')) return colors.magenta;
    return colors.white;
  };

  // Get effort colors
  const getEffortColor = (sprints) => {
    if (sprints === 0 || sprints === 'n/a') return colors.gray;
    if (sprints <= 1) return colors.green;
    if (sprints <= 3) return colors.yellow;
    return colors.red;
  };

  // Get person sprints colors (green if <= target, red if > target)
  const getPersonSprintsColor = (personSprints, target) => {
    if (personSprints <= target) return colors.green;
    return colors.red;
  };

  // Get buffer colors
  const getBufferColor = (bufferPercent) => {
    if (bufferPercent >= 20) return colors.green;
    if (bufferPercent >= 10) return '\x1b[33m'; // orange
    return colors.red;
  };

  // Header
  console.log('');
  console.log(colors.bright + colors.cyan + '┌─' + '─'.repeat(maxTeamWidth) + '─┬─' + '─'.repeat(maxVelocityWidth) + '─┬─' + '─'.repeat(maxIdeasWidth) + '─┬─' + '─'.repeat(maxSPWidth) + '─┬─' + '─'.repeat(maxTeamSprintsWidth) + '─┬─' + '─'.repeat(maxPersonSprintsWidth) + '─┬─' + '─'.repeat(maxPSTargetWidth) + '─┬─' + '─'.repeat(maxBufferWidth) + '─┐' + colors.reset);
  console.log(colors.bright + colors.cyan + '│ ' + colors.white + pad('Team & Quarter', maxTeamWidth) + colors.cyan + ' │ ' + colors.white + pad('Velocity', maxVelocityWidth) + colors.cyan + ' │ ' + colors.white + pad('Ideas', maxIdeasWidth) + colors.cyan + ' │ ' + colors.white + pad('SP', maxSPWidth) + colors.cyan + ' │ ' + colors.white + pad('Team Sprints', maxTeamSprintsWidth) + colors.cyan + ' │ ' + colors.white + pad('Person Sprints (PS)', maxPersonSprintsWidth) + colors.cyan + ' │ ' + colors.white + pad('PS Target', maxPSTargetWidth) + colors.cyan + ' │ ' + colors.white + pad('Buffer (goal +20%)', maxBufferWidth) + colors.cyan + ' │' + colors.reset);
  console.log(colors.bright + colors.cyan + '├─' + '─'.repeat(maxTeamWidth) + '─┼─' + '─'.repeat(maxVelocityWidth) + '─┼─' + '─'.repeat(maxIdeasWidth) + '─┼─' + '─'.repeat(maxSPWidth) + '─┼─' + '─'.repeat(maxTeamSprintsWidth) + '─┼─' + '─'.repeat(maxPersonSprintsWidth) + '─┼─' + '─'.repeat(maxPSTargetWidth) + '─┼─' + '─'.repeat(maxBufferWidth) + '─┤' + colors.reset);

  // Data rows
  entries.forEach(([teamKey, summary], index) => {
    const rowBg = index % 2 === 0 ? '' : colors.dim;
    const teamColor = getTeamColor(teamKey);
    const commitmentColor = getCommitmentColor(teamKey);
    const teamSprintColor = getEffortColor(summary.totalEstimatedSprints);
    
    // Extract team name and quarter to calculate targets
    const [teamName, quarterTypeWithParen] = teamKey.split(' (');
    const quarterType = quarterTypeWithParen.replace(')', '');
    const teamSize = TEAM_SIZES[teamName] || 0;
    
    // Calculate PS Target with PTO adjustment
    let psTarget = teamSize * 3; // Base calculation: team size * 3 sprints per cycle
    
    // Apply PTO adjustment if we have config and PTO data
    if (config && ptoData.length > 0 && config.teams?.[teamName]) {
      // Extract quarter from quarterType (e.g., "Q4'25.C1 Committed" -> "Q4'25.C1")
      const quarterMatch = quarterType.match(/(Q\d'\d+\.C\d+)/);
      if (quarterMatch) {
        const quarter = quarterMatch[1];
        const quarterKey = quarter.toLowerCase().replace(/['']/g, '').replace(/[.]/g, '');
        
        if (config.quarters?.[quarterKey]) {
          const quarterStart = parseDateDDMMYYYY(config.quarters[quarterKey].start);
          const quarterEnd = parseDateDDMMYYYY(config.quarters[quarterKey].end);
          const teamMembers = config.teams[teamName];
          
          const ptoImpact = calculatePTOImpact(ptoData, teamMembers, quarterStart, quarterEnd);
          const originalTarget = teamSize * 3;
          psTarget = teamSize * 3 * (1 - ptoImpact);
        }
      }
    }
    
    psTarget = Math.round(psTarget * 100) / 100; // Round to 2 decimal places
    
    // Calculate buffer percentage: (psTarget - actualPersonSprints) / psTarget * 100
    // If committed, use actual person sprints, if roadmap show as comparison
    const bufferPercent = psTarget > 0 ? ((psTarget - summary.totalPersonSprints) / psTarget * 100) : 0;
    const bufferText = bufferPercent >= 0 ? `+${bufferPercent.toFixed(0)}%` : `${bufferPercent.toFixed(0)}%`;
    
    // Color logic
    const personSprintColor = getPersonSprintsColor(summary.totalPersonSprints, psTarget);
    const bufferColor = getBufferColor(bufferPercent);
    
    // Format the team name with colors
    const formattedTeamName = teamColor + colors.bright + teamName + colors.reset + ' (' + commitmentColor + colors.bright + quarterType.replace(')', '') + colors.reset + ')';
    
    const teamVelocity = teamVelocities[teamName] || 'N/A';
    const velocityDisplay = teamVelocity === 'N/A' ? 'N/A' : Math.round(teamVelocity * 10) / 10; // Round to 1 decimal
    
    console.log(rowBg + colors.cyan + '│ ' + 
                pad(formattedTeamName, maxTeamWidth) + colors.cyan + ' │ ' +
                colors.white + colors.bright + pad(velocityDisplay.toString(), maxVelocityWidth) + colors.reset + colors.cyan + ' │ ' +
                colors.white + colors.bright + pad(summary.ideas.toString(), maxIdeasWidth) + colors.reset + colors.cyan + ' │ ' +
                colors.white + colors.bright + pad(summary.totalStoryPoints.toString(), maxSPWidth) + colors.reset + colors.cyan + ' │ ' +
                teamSprintColor + colors.bright + pad(summary.totalEstimatedSprints.toString(), maxTeamSprintsWidth) + colors.reset + colors.cyan + ' │ ' +
                personSprintColor + colors.bright + pad(summary.totalPersonSprints.toString(), maxPersonSprintsWidth) + colors.reset + colors.cyan + ' │ ' +
                colors.white + colors.bright + pad(`${psTarget} PS`, maxPSTargetWidth) + colors.reset + colors.cyan + ' │ ' +
                bufferColor + colors.bright + pad(bufferText, maxBufferWidth) + colors.reset + colors.cyan + ' │' + colors.reset);
  });

  // Footer
  console.log(colors.bright + colors.cyan + '└─' + '─'.repeat(maxTeamWidth) + '─┴─' + '─'.repeat(maxVelocityWidth) + '─┴─' + '─'.repeat(maxIdeasWidth) + '─┴─' + '─'.repeat(maxSPWidth) + '─┴─' + '─'.repeat(maxTeamSprintsWidth) + '─┴─' + '─'.repeat(maxPersonSprintsWidth) + '─┴─' + '─'.repeat(maxPSTargetWidth) + '─┴─' + '─'.repeat(maxBufferWidth) + '─┘' + colors.reset);
  
  // Legend
  console.log('');
  console.log(colors.dim + 'Team Legend: ' + 
              colors.blue + '●' + colors.reset + colors.dim + ' Dashboard  ' +
              colors.green + '●' + colors.reset + colors.dim + ' Back Office + Internal Tools' + colors.reset);
  console.log(colors.dim + 'Type Legend: ' + 
              colors.yellow + '●' + colors.reset + colors.dim + ' Committed  ' +
              colors.magenta + '●' + colors.reset + colors.dim + ' Roadmap' + colors.reset);
  console.log(colors.dim + 'Effort Legend: ' + 
              colors.green + '●' + colors.reset + colors.dim + ' Low effort  ' +
              colors.yellow + '●' + colors.reset + colors.dim + ' Medium effort  ' +
              colors.red + '●' + colors.reset + colors.dim + ' High effort' + colors.reset);
  console.log(colors.dim + 'Person Sprints: ' + 
              colors.green + '●' + colors.reset + colors.dim + ' Within target  ' +
              colors.red + '●' + colors.reset + colors.dim + ' Over target' + colors.reset);
  console.log(colors.dim + 'Buffer: ' + 
              colors.green + '●' + colors.reset + colors.dim + ' 20%+ buffer  ' +
              '\x1b[33m●' + colors.reset + colors.dim + ' 10-19% buffer  ' +
              colors.red + '●' + colors.reset + colors.dim + ' <10% buffer' + colors.reset);
}

// Main execution
(async () => {
  try {
    // Parse command line arguments
    const { ideaIds, quarters, teams } = parseArguments();
    
    // Load configuration
    const config = loadConfig();
    
    // Use provided teams or default to Dashboard and Back Office + Internal Tools
    const targetTeams = teams.length > 0 ? teams : ['Dashboard', 'Back Office + Internal Tools'];
    
    // Show usage if no IDs or quarters provided
    if ((!ideaIds || ideaIds.length === 0) && (!quarters || quarters.length === 0)) {
      console.log('=== JIRA IDEA ANALYSIS ===');
      console.log('Usage: node jira-idea-analysis.js [OPTIONS]');
      console.log('');
      console.log('Options:');
      console.log('  -ids <comma-separated-idea-ids>    Analyze specific Ideas by ID');
      console.log('  -q <comma-separated-quarters>      Analyze Ideas by quarter');
      console.log('  -teams <comma-separated-teams>     Filter by specific teams (default: Dashboard, Back Office + Internal Tools)');
      console.log('');
      console.log('ID formats:');
      console.log('  • Full URLs: https://cloudtalk.atlassian.net/browse/RD-732');
      console.log('  • Issue keys: RD-732');
      console.log('  • Numbers: 732 (assumes RD project)');
      console.log('');
      console.log('Quarter formats:');
      console.log('  • q425c1, q425c2 → Q4\'25.C1, Q4\'25.C2');
      console.log('  • Q4\'25.C1 (exact format)');
      console.log('');
      console.log('Examples:');
      console.log('  node jira-idea-analysis.js -ids 732,731,730');
      console.log('  node jira-idea-analysis.js -ids RD-732,RD-731');
      console.log('  node jira-idea-analysis.js -q q425c1,q425c2');
      console.log('  node jira-idea-analysis.js -q "Q4\'25.C1,Q1\'26.C1"');
      console.log('');
      console.log('This script will:');
      console.log('1. Fetch Ideas from Jira (by ID or quarter)');
      console.log('2. Find their linked work items (Epics/Stories)');
      console.log('3. Calculate total story points from linked items');
      console.log('4. Get team velocity from scrum boards');
      console.log('5. Estimate effort in sprints (team + person)');
      process.exit(1);
    }
    
    // Fetch PTO data for the quarters being analyzed
    let ptoData = [];
    if (config && quarters && quarters.length > 0) {
      // Get date range for all quarters
      const quarterDates = quarters.map(q => {
        // Convert formatted quarter back to config key format
        // Q4'25.C1 -> q425c1
        const configKey = q.toLowerCase().replace(/['']/g, '').replace(/[.]/g, '');
        return config.quarters?.[configKey];
      }).filter(Boolean);
      
      if (quarterDates.length > 0) {
        const earliestStart = quarterDates.reduce((min, qd) => 
          new Date(parseDateDDMMYYYY(qd.start)) < new Date(parseDateDDMMYYYY(min.start)) ? qd : min
        ).start;
        const latestEnd = quarterDates.reduce((max, qd) => 
          new Date(parseDateDDMMYYYY(qd.end)) > new Date(parseDateDDMMYYYY(max.end)) ? qd : max
        ).end;
        
        if (config.bamboohr?.subdomain) {
          ptoData = await fetchTimeOffData(config.bamboohr.subdomain, earliestStart, latestEnd);
          
          // Log PTO summary for transparency
          if (ptoData.length > 0) {
            console.log(`\n=== PTO SCHEDULE FOR ${earliestStart} TO ${latestEnd} ===`);
            
            // Group PTO by team for better readability
            const ptoByTeam = {};
            
            for (const team of targetTeams) {
              if (config.teams?.[team]) {
                const teamMembers = config.teams[team];
                const teamPTO = [];
                
                for (const member of teamMembers) {
                  const memberPTO = ptoData.filter(request => {
                    const employeeName = request.name || request.employee?.displayName || request.employee?.firstName + ' ' + request.employee?.lastName;
                    return employeeName === member;
                  });
                  
                  for (const pto of memberPTO) {
                    const ptoStartDate = new Date(pto.start);
                    const ptoEndDate = new Date(pto.end);
                    const quarterStartDate = new Date(parseDateDDMMYYYY(earliestStart));
                    const quarterEndDate = new Date(parseDateDDMMYYYY(latestEnd));
                    
                    // Check if PTO overlaps with quarter
                    const overlapStart = new Date(Math.max(ptoStartDate.getTime(), quarterStartDate.getTime()));
                    const overlapEnd = new Date(Math.min(ptoEndDate.getTime(), quarterEndDate.getTime()));
                    
                    if (overlapStart <= overlapEnd) {
                      const workingDays = getWorkingDays(overlapStart, overlapEnd);
                      teamPTO.push({
                        member,
                        start: pto.start,
                        end: pto.end,
                        days: workingDays,
                        type: pto.type?.name || 'Time Off'
                      });
                    }
                  }
                }
                
                if (teamPTO.length > 0) {
                  ptoByTeam[team] = teamPTO;
                }
              }
            }
            
            // Display PTO by team
            if (Object.keys(ptoByTeam).length > 0) {
              for (const [team, ptoList] of Object.entries(ptoByTeam)) {
                console.log(`\n${team} Team:`);
                ptoList.forEach(pto => {
                  console.log(`  • ${pto.member}: ${pto.days} working days (${pto.start} to ${pto.end}) - ${pto.type}`);
                });
              }
              console.log('');
            } else {
              console.log('No team member PTO found for this period.\n');
            }
          } else {
            console.log('\nNo PTO records found for this period.\n');
          }
        }
      }
    }
    
    const results = await analyzeIdeas(ideaIds, quarters, targetTeams);
    
    displayResultsTable(results);
    
    // Summary by team and quarter breakdown
    const teamQuarterSummary = {};
    
    // Extract unique quarters from the search criteria
    const searchQuarters = quarters && quarters.length > 0 ? quarters : [];
    
    results.forEach(result => {
      // Get quarter information for this result
      const committedQuarters = result.committedIn !== '-' ? result.committedIn.split(', ') : [];
      const roadmapQuarters = result.roadmapCycle !== '-' ? result.roadmapCycle.split(', ') : [];
      
      // For each search quarter, check if this result is committed or roadmap
      searchQuarters.forEach(searchQuarter => {
        const isCommitted = committedQuarters.some(q => q.includes(searchQuarter));
        const isRoadmap = roadmapQuarters.some(q => q.includes(searchQuarter));
        
        if (isCommitted) {
          const key = `${result.team} (${searchQuarter} Committed)`;
          if (!teamQuarterSummary[key]) {
            teamQuarterSummary[key] = {
              ideas: 0,
              totalStoryPoints: 0,
              totalEstimatedSprints: 0,
              totalPersonSprints: 0
            };
          }
          teamQuarterSummary[key].ideas++;
          teamQuarterSummary[key].totalStoryPoints += result.totalStoryPoints;
          teamQuarterSummary[key].totalEstimatedSprints += result.estimatedSprints;
          if (typeof result.personSprints === 'number') {
            teamQuarterSummary[key].totalPersonSprints += result.personSprints;
          }
        }
        
        if (isRoadmap) {
          const key = `${result.team} (${searchQuarter} Roadmap)`;
          if (!teamQuarterSummary[key]) {
            teamQuarterSummary[key] = {
              ideas: 0,
              totalStoryPoints: 0,
              totalEstimatedSprints: 0,
              totalPersonSprints: 0
            };
          }
          teamQuarterSummary[key].ideas++;
          teamQuarterSummary[key].totalStoryPoints += result.totalStoryPoints;
          teamQuarterSummary[key].totalEstimatedSprints += result.estimatedSprints;
          if (typeof result.personSprints === 'number') {
            teamQuarterSummary[key].totalPersonSprints += result.personSprints;
          }
        }
      });
    });
    
    // Format Person Sprints in summary
    Object.keys(teamQuarterSummary).forEach(key => {
      const summary = teamQuarterSummary[key];
      if (summary.totalPersonSprints === 0) {
        summary.totalPersonSprints = 'n/a';
      } else {
        summary.totalPersonSprints = +summary.totalPersonSprints.toFixed(2);
      }
      summary.totalEstimatedSprints = +summary.totalEstimatedSprints.toFixed(2);
    });
    
    console.log('\n=== TEAM SUMMARY ===');
    await displayTeamSummaryTable(teamQuarterSummary, config, ptoData);
    
  } catch (error) {
    console.error('[FATAL] Script failed');
    process.exit(1);
  }
})();
