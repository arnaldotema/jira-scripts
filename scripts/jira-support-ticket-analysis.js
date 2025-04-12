const axios = require('axios');
require('dotenv').config();

// Jira API configuration
const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

// JQL query
const JQL_QUERY = encodeURIComponent('project = DSH AND issuetype in (Ticket, Bug) AND created >= "2024-12-01" ORDER BY created DESC');

// Add this function to convert ADF to plain text
function convertADFToPlainText(adf) {
    if (!adf || !adf.content) return '';

    function extractText(node) {
        if (!node) return '';
        
        if (node.text) return node.text;
        
        if (node.content) {
            let text = node.content.map(extractText).join('');
            
            // Handle special cases
            switch (node.type) {
                case 'paragraph':
                    text += '\n\n';
                    break;
                case 'bulletList':
                    // Don't add extra newlines for lists as listItems will handle it
                    break;
                case 'listItem':
                    text = '• ' + text + '\n';
                    break;
                case 'hardBreak':
                    text = '\n';
                    break;
            }
            
            return text;
        }
        
        return '';
    }

    const plainText = adf.content.map(extractText).join('');
    // Clean up multiple newlines and trim
    return plainText.replace(/\n\n\n+/g, '\n\n').trim();
}

async function fetchAllJiraTickets() {
    let allTickets = [];
    let startAt = 0;
    const maxResults = 100; // Jira's default and recommended page size
    
    while (true) {
        try {
            const credentials = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
            
            const response = await axios({
                method: 'get',
                url: `${JIRA_BASE_URL}/rest/api/3/search?jql=${JQL_QUERY}&maxResults=${maxResults}&startAt=${startAt}`,
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.data || !response.data.issues) {
                throw new Error('Invalid response format from Jira API');
            }

            const tickets = response.data.issues.map(issue => ({
                issueType: issue.fields.issuetype.name,
                key: issue.key,
                created: issue.fields.created,
                summary: issue.fields.summary,
                assignee: issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned',
                reporter: issue.fields.reporter ? issue.fields.reporter.displayName : 'Unknown',
                priority: issue.fields.priority ? issue.fields.priority.name : 'None',
                status: issue.fields.status.name,
                resolution: issue.fields.resolution ? issue.fields.resolution.name : 'Unresolved',
                updated: issue.fields.updated,
                description: convertADFToPlainText(issue.fields.description)
            }));

            allTickets = allTickets.concat(tickets);

            // Log progress
            console.log(`Fetched ${tickets.length} tickets (Total: ${allTickets.length} of ${response.data.total})`);

            // Check if we've got all issues
            if (tickets.length === 0 || allTickets.length >= response.data.total) {
                break;
            }

            // Increment startAt for next page
            startAt += maxResults;

            // Optional: Add a small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error) {
            console.error('Error fetching Jira tickets:', error.message);
            throw error;
        }
    }

    return allTickets;
}

// Modify the CSV writer to properly handle newlines
function saveToCSV(tickets) {
  const createCsvStringifier = require('csv-writer').createObjectCsvStringifier;
  const fs = require('fs');

  const csvStringifier = createCsvStringifier({
    header: [
      {id: 'issueType', title: 'Issue Type'},
      {id: 'key', title: 'Key'},
      {id: 'created', title: 'Created'},
      {id: 'summary', title: 'Summary'},
      {id: 'assignee', title: 'Assignee'},
      {id: 'reporter', title: 'Reporter'},
      {id: 'priority', title: 'Priority'},
      {id: 'status', title: 'Status'},
      {id: 'resolution', title: 'Resolution'},
      {id: 'updated', title: 'Updated'},
      {id: 'description', title: 'Description'}
    ],
    fieldDelimiter: ',',
    recordDelimiter: '\n',
    alwaysQuote: true // This ensures proper escaping of fields with newlines
  });

  // Process tickets to escape any problematic characters
  const processedTickets = tickets.map(ticket => ({
    ...ticket,
    // Ensure description newlines are preserved but properly escaped
    description: ticket.description.replace(/[\r\n]+/g, '\n')
  }));

  const csvString = csvStringifier.stringifyRecords(processedTickets);
  const headerString = csvStringifier.getHeaderString();
  
  fs.writeFileSync('jira-tickets.csv', headerString + csvString);
  console.log('Data saved to jira-tickets.csv');
}

// Main execution
async function main() {
    try {
        console.log('Fetching Jira tickets...');
        const tickets = await fetchAllJiraTickets();
        console.log(`Successfully fetched ${tickets.length} tickets`);
        saveToCSV(tickets);
    } catch (error) {
        console.error('Script failed:', error);
        process.exit(1);
    }
}

main();