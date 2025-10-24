const axios = require('axios');
require('dotenv').config();

// Jira API configuration
const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

// JQL query for DSH project bugs and tickets resolved <= Jan 1st 2025
const JQL_QUERY = encodeURIComponent('project = Dashboard and issuetype in (bug, Ticket) and resolved >= startOfYear() ORDER BY parent ASC');

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
                    text += ' ';
                    break;
                case 'bulletList':
                    // Don't add extra newlines for lists as listItems will handle it
                    break;
                case 'listItem':
                    text = '• ' + text + ' ';
                    break;
                case 'hardBreak':
                    text = ' ';
                    break;
            }
            
            return text;
        }
        
        return '';
    }

    const plainText = adf.content.map(extractText).join('');
    // Clean up multiple spaces and trim
    return plainText.replace(/\s+/g, ' ').trim();
}

// Function to extract comments text
function extractCommentsText(comments) {
    if (!comments || !comments.comments) return '';
    
    return comments.comments.map(comment => {
        // Handle both string and ADF format comments
        if (typeof comment.body === 'string') {
            return comment.body;
        } else {
            return convertADFToPlainText(comment.body);
        }
    }).join(' ').trim();
}

async function fetchAllJiraTickets() {
    let allTickets = [];
    let nextPageToken = null;
    const maxResults = 100; // Jira's default and recommended page size
    
    console.log('🔍 Fetching DSH bugs and tickets resolved <= Jan 1st 2025...\n');
    
    while (true) {
        try {
            const credentials = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
            
            let url = `${JIRA_BASE_URL}rest/api/3/search/jql?jql=${JQL_QUERY}&maxResults=${maxResults}&fields=key,summary,description,issuetype,status,resolution,resolutiondate,comment`;
            if (nextPageToken) {
                url += `&nextPageToken=${encodeURIComponent(nextPageToken)}`;
            }
            
            const response = await axios({
                method: 'get',
                url: url,
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
                summary: issue.fields.summary || '',
                description: convertADFToPlainText(issue.fields.description) || '',
                comments: extractCommentsText(issue.fields.comment) || '',
                resolutiondate: issue.fields.resolutiondate,
                status: issue.fields.status.name,
                resolution: issue.fields.resolution ? issue.fields.resolution.name : 'Unresolved'
            }));

            allTickets = allTickets.concat(tickets);

            // Log progress with a nice progress indicator
            const progressChars = Math.min(20, Math.floor(allTickets.length / 10));
            const progressBar = '█'.repeat(progressChars) + '░'.repeat(20 - progressChars);
            process.stdout.write(`\r📊 Progress: [${progressBar}] ${allTickets.length} tickets fetched`);

            // Check if we've got all issues (when isLast is true or no more tickets)
            if (response.data.isLast || tickets.length === 0) {
                console.log('\n');
                break;
            }

            // Set next page token for next iteration
            nextPageToken = response.data.nextPageToken;

            // Optional: Add a small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error) {
            console.error('\n❌ Error fetching Jira tickets:', error.message);
            throw error;
        }
    }

    return allTickets;
}

function findKeywordContext(text, keywords, maxLength = 100) {
    const lowerText = text.toLowerCase();
    for (const keyword of keywords) {
        const index = lowerText.indexOf(keyword.toLowerCase());
        if (index !== -1) {
            const start = Math.max(0, index - 30);
            const end = Math.min(text.length, index + keyword.length + 30);
            let context = text.substring(start, end);
            
            // Add ellipsis if we truncated
            if (start > 0) context = '...' + context;
            if (end < text.length) context = context + '...';
            
            // Limit total length
            if (context.length > maxLength) {
                context = context.substring(0, maxLength - 3) + '...';
            }
            
            return context;
        }
    }
    return '';
}

function analyzeKeywords(tickets) {
    console.log('🔍 Analyzing keywords in tickets...\n');
    
    const voiceKeywords = ['voice'];
    const analyticsKeywords = ['analytics', 'cip', 'call-information-processing', '[AN]'];
    
    let voiceCount = 0;
    let analyticsCount = 0;
    let totalTickets = tickets.length;
    
    const voiceTickets = [];
    const analyticsTickets = [];
    
    tickets.forEach(ticket => {
        const searchText = `${ticket.summary} ${ticket.description} ${ticket.comments}`.toLowerCase();
        
        // Check for voice keywords
        const hasVoice = voiceKeywords.some(keyword => searchText.includes(keyword.toLowerCase()));
        if (hasVoice) {
            voiceCount++;
            
            // Find where the keyword was mentioned
            let context = '';
            let source = '';
            
            // Check summary first
            if (ticket.summary.toLowerCase().includes('voice')) {
                context = findKeywordContext(ticket.summary, voiceKeywords, 80);
                source = 'Summary';
            }
            // Then description
            else if (ticket.description.toLowerCase().includes('voice')) {
                context = findKeywordContext(ticket.description, voiceKeywords, 80);
                source = 'Description';
            }
            // Finally comments
            else if (ticket.comments.toLowerCase().includes('voice')) {
                context = findKeywordContext(ticket.comments, voiceKeywords, 80);
                source = 'Comments';
            }
            
            voiceTickets.push({
                ...ticket,
                keywordContext: context,
                keywordSource: source
            });
        }
        
        // Check for analytics/CIP keywords
        const hasAnalytics = analyticsKeywords.some(keyword => searchText.includes(keyword.toLowerCase()));
        if (hasAnalytics) {
            analyticsCount++;
            
            // Find where the keyword was mentioned
            let context = '';
            let source = '';
            let foundKeyword = '';
            
            // Find which keyword and where
            for (const keyword of analyticsKeywords) {
                if (ticket.summary.toLowerCase().includes(keyword.toLowerCase())) {
                    context = findKeywordContext(ticket.summary, [keyword], 80);
                    source = 'Summary';
                    foundKeyword = keyword;
                    break;
                } else if (ticket.description.toLowerCase().includes(keyword.toLowerCase())) {
                    context = findKeywordContext(ticket.description, [keyword], 80);
                    source = 'Description';
                    foundKeyword = keyword;
                    break;
                } else if (ticket.comments.toLowerCase().includes(keyword.toLowerCase())) {
                    context = findKeywordContext(ticket.comments, [keyword], 80);
                    source = 'Comments';
                    foundKeyword = keyword;
                    break;
                }
            }
            
            analyticsTickets.push({
                ...ticket,
                keywordContext: context,
                keywordSource: source,
                foundKeyword: foundKeyword
            });
        }
    });
    
    return {
        totalTickets,
        voiceCount,
        analyticsCount,
        voicePercentage: totalTickets > 0 ? (voiceCount / totalTickets * 100) : 0,
        analyticsPercentage: totalTickets > 0 ? (analyticsCount / totalTickets * 100) : 0,
        voiceTickets,
        analyticsTickets
    };
}

function displayTable(tickets, title, emoji) {
    if (tickets.length === 0) return;
    
    console.log(`${emoji} ${title.toUpperCase()} DETAILED BREAKDOWN`);
    console.log('═'.repeat(120));
    
    // Table header
    const keyCol = 'Key'.padEnd(12);
    const summaryCol = 'Summary'.padEnd(35);
    const contextCol = 'Context'.padEnd(45);
    const sourceCol = 'Source'.padEnd(12);
    const linkCol = 'Link';
    
    console.log(`${keyCol} │ ${summaryCol} │ ${contextCol} │ ${sourceCol} │ ${linkCol}`);
    console.log('─'.repeat(12) + '─┼─' + '─'.repeat(35) + '─┼─' + '─'.repeat(45) + '─┼─' + '─'.repeat(12) + '─┼─' + '─'.repeat(25));
    
    tickets.forEach(ticket => {
        const key = ticket.key.padEnd(12);
        const summary = (ticket.summary.length > 35 ? ticket.summary.substring(0, 32) + '...' : ticket.summary).padEnd(35);
        const context = (ticket.keywordContext.length > 45 ? ticket.keywordContext.substring(0, 42) + '...' : ticket.keywordContext).padEnd(45);
        const source = ticket.keywordSource.padEnd(12);
        const link = `${process.env.JIRA_BASE_URL}browse/${ticket.key}`;
        
        console.log(`${key} │ ${summary} │ ${context} │ ${source} │ ${link}`);
    });
    
    console.log();
}

function displayResults(analysis) {
    console.log('═'.repeat(120));
    console.log('🎯 DSH PROJECT KEYWORD ANALYSIS RESULTS');
    console.log('═'.repeat(120));
    console.log();
    
    // Summary stats
    console.log('📊 SUMMARY STATISTICS');
    console.log('─'.repeat(40));
    console.log(`📋 Total tickets analyzed: ${analysis.totalTickets}`);
    console.log(`🎤 Voice-related tickets: ${analysis.voiceCount} (${analysis.voicePercentage.toFixed(1)}%)`);
    console.log(`📈 Analytics/CIP tickets: ${analysis.analyticsCount} (${analysis.analyticsPercentage.toFixed(1)}%)`);
    console.log();
    
    // Visual percentage bars
    console.log('📊 VISUAL BREAKDOWN');
    console.log('─'.repeat(40));
    
    const voiceBar = '█'.repeat(Math.floor(analysis.voicePercentage / 2)) + '░'.repeat(50 - Math.floor(analysis.voicePercentage / 2));
    const analyticsBar = '█'.repeat(Math.floor(analysis.analyticsPercentage / 2)) + '░'.repeat(50 - Math.floor(analysis.analyticsPercentage / 2));
    
    console.log(`🎤 Voice:      [${voiceBar}] ${analysis.voicePercentage.toFixed(1)}%`);
    console.log(`📈 Analytics:  [${analyticsBar}] ${analysis.analyticsPercentage.toFixed(1)}%`);
    console.log();
    
    // Detailed tables
    displayTable(analysis.voiceTickets, 'Voice-Related Tickets', '🎤');
    displayTable(analysis.analyticsTickets, 'Analytics/CIP Tickets', '📈');
    
    // Keywords searched
    console.log('🔍 KEYWORDS SEARCHED');
    console.log('─'.repeat(40));
    console.log('🎤 Voice: "voice"');
    console.log('📈 Analytics/CIP: "analytics", "cip", "call-information-processing", "[AN]"');
    console.log('💡 Search is case-insensitive and covers summary, description, and comments');
    console.log();
    
    console.log('═'.repeat(120));
    console.log('✅ Analysis complete!');
    console.log('═'.repeat(120));
}

// Main execution
async function main() {
    try {
        console.log('🚀 Starting DSH Keyword Analysis');
        console.log('═'.repeat(50));
        console.log();
        
        const tickets = await fetchAllJiraTickets();
        console.log(`✅ Successfully fetched ${tickets.length} tickets\n`);
        
        const analysis = analyzeKeywords(tickets);
        displayResults(analysis);
        
    } catch (error) {
        console.error('❌ Script failed:', error);
        process.exit(1);
    }
}

main();
