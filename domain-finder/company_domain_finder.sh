#!/bin/bash

################################################################################
# Company Domain Finder
#
# This script processes a CSV file containing company names and enriches it
# with their corresponding domain names. It uses AI to search for domains
# and verifies them using DNS lookups.
#
# Usage: ./company_domain_finder.sh input.csv
################################################################################

set -euo pipefail

# Configuration
readonly BATCH_SIZE=20
readonly TEMP_DIR="$(mktemp -d)"
readonly LOG_FILE="domain_finder_$(date +%Y%m%d_%H%M%S).log"
readonly OUTPUT_SUFFIX="_with_domains"

# Cleanup on exit
trap 'rm -rf "$TEMP_DIR"' EXIT

################################################################################
# Logging Functions
################################################################################

log_info() {
    local message="$1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] INFO: $message" | tee -a "$LOG_FILE"
}

log_error() {
    local message="$1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $message" | tee -a "$LOG_FILE" >&2
}

log_debug() {
    local message="$1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] DEBUG: $message" >> "$LOG_FILE"
}

################################################################################
# Validation Functions
################################################################################

validate_dependencies() {
    local missing_deps=()

    # Check for required commands
    for cmd in curl jq dig; do
        if ! command -v "$cmd" &> /dev/null; then
            missing_deps+=("$cmd")
        fi
    done

    if [ ${#missing_deps[@]} -gt 0 ]; then
        log_error "Missing required dependencies: ${missing_deps[*]}"
        log_error "Please install them and try again."
        exit 1
    fi
}

validate_csv_file() {
    local csv_file="$1"

    if [ ! -f "$csv_file" ]; then
        log_error "File not found: $csv_file"
        exit 1
    fi

    if [ ! -r "$csv_file" ]; then
        log_error "File not readable: $csv_file"
        exit 1
    fi

    # Check if file is empty
    if [ ! -s "$csv_file" ]; then
        log_error "File is empty: $csv_file"
        exit 1
    fi
}

check_anthropic_api_key() {
    if [ -z "${ANTHROPIC_KEY:-}" ]; then
        log_error "ANTHROPIC_KEY environment variable is not set"
        log_error "Please set it with: export ANTHROPIC_KEY='your-api-key'"
        exit 1
    fi
}

################################################################################
# CSV Processing Functions
################################################################################

extract_company_names() {
    local csv_file="$1"
    local output_file="$2"

    # Skip header and extract first column (company names)
    tail -n +2 "$csv_file" | cut -d',' -f1 | sed 's/^"//;s/"$//' > "$output_file"
}

count_csv_rows() {
    local csv_file="$1"
    # Count rows excluding header
    tail -n +2 "$csv_file" | wc -l | tr -d ' '
}

get_csv_header() {
    local csv_file="$1"
    head -n 1 "$csv_file"
}

################################################################################
# AI Domain Search Function
################################################################################

search_domain_with_ai() {
    local company_name="$1"

    log_debug "Searching domain for: $company_name"

    # Prepare API request using jq to build proper JSON
    local json_payload
    json_payload=$(jq -n \
        --arg company "$company_name" \
        '{
            model: "claude-3-haiku-20240307",
            max_tokens: 100,
            messages: [
                {
                    role: "user",
                    content: ("What is the official website domain for the company \"" + $company + "\"? Respond with ONLY the domain name (e.g., example.com) without http://, https://, www., or any additional text. Make your best educated guess based on the company name. Only respond with UNKNOWN if the company name is clearly invalid (like just a number, empty, or random characters).")
                }
            ]
        }')

    local response
    response=$(curl -s --fail-with-body -X POST https://api.anthropic.com/v1/messages \
        -H "content-type: application/json" \
        -H "x-api-key: $ANTHROPIC_KEY" \
        -H "anthropic-version: 2023-06-01" \
        -d "$json_payload")

    if [ $? -ne 0 ]; then
        log_error "API request failed for: $company_name"
        log_debug "API Error Response: $response"
        echo "ERROR"
        return 1
    fi

    # Extract domain from response
    local domain
    domain=$(echo "$response" | jq -r '.content[0].text' | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')

    # Clean up domain (remove any protocols or www)
    domain=$(echo "$domain" | sed 's|^https\?://||;s|^www\.||;s|/$||')

    log_debug "AI suggested domain: $domain"
    echo "$domain"
}

################################################################################
# Domain Verification Functions
################################################################################

verify_domain_dns() {
    local domain="$1"

    log_debug "Verifying domain via DNS: $domain"

    # Check if domain has valid DNS records (A or AAAA records)
    if dig +short A "$domain" @8.8.8.8 | grep -q '^[0-9]'; then
        log_debug "Domain verified (A record found): $domain"
        return 0
    fi

    if dig +short AAAA "$domain" @8.8.8.8 | grep -q ':'; then
        log_debug "Domain verified (AAAA record found): $domain"
        return 0
    fi

    # Try with www prefix
    if dig +short A "www.$domain" @8.8.8.8 | grep -q '^[0-9]'; then
        log_debug "Domain verified with www prefix: $domain"
        return 0
    fi

    log_debug "Domain verification failed: $domain"
    return 1
}

verify_domain_http() {
    local domain="$1"

    log_debug "Verifying domain via HTTP: $domain"

    # Try HTTPS first, then HTTP
    for protocol in https http; do
        for prefix in "" "www."; do
            local url="${protocol}://${prefix}${domain}"
            if curl -s -L -I --max-time 10 "$url" | head -n 1 | grep -q "HTTP.*[23].."; then
                log_debug "Domain responds successfully: $url"
                return 0
            fi
        done
    done

    log_debug "Domain HTTP verification failed: $domain"
    return 1
}

verify_domain() {
    local domain="$1"

    # Skip verification for special values
    if [ "$domain" = "UNKNOWN" ] || [ "$domain" = "ERROR" ] || [ -z "$domain" ]; then
        return 1
    fi

    # Primary verification: DNS
    if verify_domain_dns "$domain"; then
        return 0
    fi

    # Secondary verification: HTTP check
    if verify_domain_http "$domain"; then
        return 0
    fi

    return 1
}

################################################################################
# Batch Processing Functions
################################################################################

process_single_company() {
    local company_name="$1"
    local result_file="$2"
    local output_csv="$3"
    local original_line="$4"

    log_info "Processing: $company_name"

    # Step 1: Search domain using AI
    local domain
    domain=$(search_domain_with_ai "$company_name")

    if [ "$domain" = "ERROR" ]; then
        echo "$company_name,ERROR" >> "$result_file"
        log_error "Failed to search domain for: $company_name"
        # Write to output CSV immediately
        [ -n "$output_csv" ] && [ -n "$original_line" ] && echo "${original_line},ERROR" >> "$output_csv"
        return 1
    fi

    # Step 2: Verify the domain
    if verify_domain "$domain"; then
        echo "$company_name,$domain" >> "$result_file"
        log_info "✓ Found and verified: $company_name -> $domain"
        # Write to output CSV immediately
        [ -n "$output_csv" ] && [ -n "$original_line" ] && echo "${original_line},${domain}" >> "$output_csv"
    else
        echo "$company_name,UNVERIFIED:$domain" >> "$result_file"
        log_info "⚠ Found but not verified: $company_name -> $domain"
        # Write to output CSV immediately
        [ -n "$output_csv" ] && [ -n "$original_line" ] && echo "${original_line},UNVERIFIED:${domain}" >> "$output_csv"
    fi
}

process_batch() {
    local batch_file="$1"
    local result_file="$2"
    local batch_num="$3"
    local output_csv="$4"
    local input_csv="$5"
    local start_line="$6"

    log_info "Processing batch $batch_num (up to $BATCH_SIZE companies)..."

    local count=0
    local line_num=$start_line
    while IFS= read -r company_name; do
        [ -z "$company_name" ] && continue

        count=$((count + 1))

        # Get the original line from input CSV (skip header, line_num is 0-indexed)
        local original_line
        original_line=$(sed -n "$((line_num + 2))p" "$input_csv")

        process_single_company "$company_name" "$result_file" "$output_csv" "$original_line"

        line_num=$((line_num + 1))

        # Small delay to avoid rate limiting
        sleep 1
    done < "$batch_file"

    log_info "Batch $batch_num completed ($count companies processed)"
}

################################################################################
# Output Functions
################################################################################

merge_results_to_csv() {
    local original_csv="$1"
    local results_file="$2"
    local output_csv="$3"

    log_info "Merging results into output CSV..."

    # Get the original header and add domain column
    local header
    header=$(get_csv_header "$original_csv")
    echo "${header},domain" > "$output_csv"

    # Read original CSV and results in parallel
    local line_num=0
    tail -n +2 "$original_csv" | while IFS= read -r original_line; do
        line_num=$((line_num + 1))

        # Get corresponding domain from results
        local domain
        domain=$(sed -n "${line_num}p" "$results_file" | cut -d',' -f2-)

        # Combine original line with domain
        echo "${original_line},${domain}" >> "$output_csv"
    done

    log_info "Output saved to: $output_csv"
}

################################################################################
# Main Processing Function
################################################################################

main() {
    local input_csv="$1"

    log_info "Starting Company Domain Finder"
    log_info "Input file: $input_csv"

    # Validate environment and input
    validate_dependencies
    check_anthropic_api_key
    validate_csv_file "$input_csv"

    # Prepare file paths
    local base_name
    base_name=$(basename "$input_csv" .csv)
    local output_csv="${base_name}${OUTPUT_SUFFIX}.csv"
    local companies_file="$TEMP_DIR/companies.txt"
    local results_file="$TEMP_DIR/results.csv"

    # Extract company names
    log_info "Extracting company names..."
    extract_company_names "$input_csv" "$companies_file"

    local total_companies
    total_companies=$(count_csv_rows "$input_csv")
    log_info "Total companies to process: $total_companies"

    # Initialize output CSV with header
    local header
    header=$(get_csv_header "$input_csv")
    echo "${header},domain" > "$output_csv"
    log_info "Initialized output CSV: $output_csv"

    # Process in batches
    local batch_num=0
    local line_count=0
    local batch_start_line=0

    while IFS= read -r company_name; do
        [ -z "$company_name" ] && continue

        # Create batch file
        if [ $((line_count % BATCH_SIZE)) -eq 0 ]; then
            batch_num=$((batch_num + 1))
            local batch_file="$TEMP_DIR/batch_${batch_num}.txt"
            batch_start_line=$line_count
            : > "$batch_file"
        fi

        echo "$company_name" >> "$batch_file"
        line_count=$((line_count + 1))

        # Process batch when full
        if [ $((line_count % BATCH_SIZE)) -eq 0 ] || [ "$line_count" -eq "$total_companies" ]; then
            process_batch "$batch_file" "$results_file" "$batch_num" "$output_csv" "$input_csv" "$batch_start_line"
        fi
    done < "$companies_file"

    # No need to merge - we've been writing incrementally
    log_info "Incremental writing complete - all results in: $output_csv"

    log_info "Processing complete!"
    log_info "Results saved to: $output_csv"
    log_info "Log file: $LOG_FILE"
}

################################################################################
# Entry Point
################################################################################

if [ $# -ne 1 ]; then
    echo "Usage: $0 <input.csv>"
    echo ""
    echo "Description:"
    echo "  Processes a CSV file with company names in the first column"
    echo "  and enriches it with their corresponding domain names."
    echo ""
    echo "Requirements:"
    echo "  - ANTHROPIC_KEY environment variable must be set"
    echo "  - Required tools: curl, jq, dig"
    echo ""
    echo "Example:"
    echo "  export ANTHROPIC_KEY='your-api-key'"
    echo "  $0 companies.csv"
    exit 1
fi

main "$1"
