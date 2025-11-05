#!/bin/bash

################################################################################
# Domain Finder - Second Pass
#
# This script takes the output from the first pass and tries to find domains
# for entries marked as "unknown" or "UNVERIFIED" using creative search methods.
#
# Usage: ./domain_finder_second_pass.sh input_with_domains.csv
################################################################################

set -euo pipefail

# Configuration
readonly BATCH_SIZE=10
readonly TEMP_DIR="$(mktemp -d)"
readonly LOG_FILE="domain_finder_second_pass_$(date +%Y%m%d_%H%M%S).log"
readonly OUTPUT_SUFFIX="_improved"

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

    for cmd in curl jq dig; do
        if ! command -v "$cmd" &> /dev/null; then
            missing_deps+=("$cmd")
        fi
    done

    if [ ${#missing_deps[@]} -gt 0 ]; then
        log_error "Missing required dependencies: ${missing_deps[*]}"
        exit 1
    fi
}

check_anthropic_api_key() {
    if [ -z "${ANTHROPIC_KEY:-}" ]; then
        log_error "ANTHROPIC_KEY environment variable is not set"
        exit 1
    fi
}

################################################################################
# Domain Search Function with Creative Strategies
################################################################################

search_domain_creatively() {
    local company_name="$1"

    log_debug "Creative search for: $company_name"

    # Enhanced prompt with multiple strategies
    local json_payload
    json_payload=$(jq -n \
        --arg company "$company_name" \
        '{
            model: "claude-3-haiku-20240307",
            max_tokens: 150,
            messages: [
                {
                    role: "user",
                    content: ("Find the official website domain for: \"" + $company + "\"\n\nStrategies:\n1. Try removing spaces, hyphens, special characters (e.g., \"5 A SEC\" → \"5asec\")\n2. Consider common country TLDs (.com, .fr, .de, .co.uk, .pt, etc)\n3. Try variations without spaces or with hyphens\n4. For French/European companies, try .fr, .eu country domains\n5. Look for the most commonly used domain\n\nRespond with ONLY the most likely domain name (e.g., example.com). If truly impossible to determine, respond with UNKNOWN.")
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
        echo "ERROR"
        return 1
    fi

    local domain
    domain=$(echo "$response" | jq -r '.content[0].text' | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
    domain=$(echo "$domain" | sed 's|^https\?://||;s|^www\.||;s|/$||')

    log_debug "Creative search suggested: $domain"
    echo "$domain"
}

################################################################################
# Domain Verification Functions
################################################################################

verify_domain_dns() {
    local domain="$1"

    log_debug "Verifying domain via DNS: $domain"

    if dig +short A "$domain" @8.8.8.8 | grep -q '^[0-9]'; then
        log_debug "Domain verified (A record found): $domain"
        return 0
    fi

    if dig +short AAAA "$domain" @8.8.8.8 | grep -q ':'; then
        log_debug "Domain verified (AAAA record found): $domain"
        return 0
    fi

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

    if [ "$domain" = "UNKNOWN" ] || [ "$domain" = "ERROR" ] || [ -z "$domain" ]; then
        return 1
    fi

    if verify_domain_dns "$domain"; then
        return 0
    fi

    if verify_domain_http "$domain"; then
        return 0
    fi

    return 1
}

################################################################################
# Processing Functions
################################################################################

process_single_entry() {
    local company_name="$1"
    local old_domain="$2"
    local csv_line="$3"
    local output_file="$4"

    log_info "Reprocessing: $company_name (was: $old_domain)"

    # Try creative search
    local domain
    domain=$(search_domain_creatively "$company_name")

    if [ "$domain" = "ERROR" ]; then
        echo "$csv_line" >> "$output_file"
        log_error "Failed to search domain for: $company_name"
        return 1
    fi

    # Verify the domain
    if verify_domain "$domain"; then
        # Replace the old domain with the new verified one
        local new_line
        new_line=$(echo "$csv_line" | sed "s|,$old_domain$|,$domain|")
        echo "$new_line" >> "$output_file"
        log_info "✓ Improved: $company_name -> $domain (was: $old_domain)"
    else
        # Keep original
        echo "$csv_line" >> "$output_file"
        log_info "⚠ No improvement: $company_name (tried: $domain)"
    fi

    sleep 1
}

################################################################################
# Main Function
################################################################################

main() {
    local input_csv="$1"

    log_info "Starting Domain Finder - Second Pass"
    log_info "Input file: $input_csv"

    validate_dependencies
    check_anthropic_api_key

    if [ ! -f "$input_csv" ]; then
        log_error "File not found: $input_csv"
        exit 1
    fi

    # Prepare output file
    local base_name
    base_name=$(basename "$input_csv" .csv)
    local output_csv="${base_name}${OUTPUT_SUFFIX}.csv"

    # Copy header
    head -n 1 "$input_csv" > "$output_csv"

    # Extract entries that need reprocessing
    local reprocess_file="$TEMP_DIR/reprocess.csv"
    tail -n +2 "$input_csv" | grep -E "UNVERIFIED:unknown|,unknown$" > "$reprocess_file" || true

    local reprocess_count
    reprocess_count=$(wc -l < "$reprocess_file" | tr -d ' ')
    log_info "Found $reprocess_count entries to reprocess"

    if [ "$reprocess_count" -eq 0 ]; then
        log_info "No entries need reprocessing. Copying original file."
        cp "$input_csv" "$output_csv"
        log_info "Done!"
        exit 0
    fi

    # Copy verified entries as-is
    tail -n +2 "$input_csv" | grep -vE "UNVERIFIED:unknown|,unknown$" >> "$output_csv" || true

    # Process entries that need improvement
    local count=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue

        count=$((count + 1))

        # Extract company name (first column) and domain (last column)
        local company_name
        local old_domain
        company_name=$(echo "$line" | cut -d',' -f1)
        old_domain=$(echo "$line" | rev | cut -d',' -f1 | rev)

        process_single_entry "$company_name" "$old_domain" "$line" "$output_csv"

        if [ $((count % 10)) -eq 0 ]; then
            log_info "Progress: $count/$reprocess_count entries processed"
        fi
    done < "$reprocess_file"

    log_info "Processing complete!"
    log_info "Results saved to: $output_csv"
    log_info "Log file: $LOG_FILE"
}

################################################################################
# Entry Point
################################################################################

if [ $# -ne 1 ]; then
    echo "Usage: $0 <input_with_domains.csv>"
    echo ""
    echo "Description:"
    echo "  Takes the output CSV from the first pass and attempts to find"
    echo "  domains for entries marked as 'unknown' or 'UNVERIFIED' using"
    echo "  creative search strategies."
    echo ""
    echo "Requirements:"
    echo "  - ANTHROPIC_KEY environment variable must be set"
    echo "  - Required tools: curl, jq, dig"
    exit 1
fi

main "$1"
