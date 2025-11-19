import os
import requests
import datetime
import logging
from flask import Flask, render_template, request, jsonify, make_response
import plotly
import plotly.graph_objects as go
import json
from dateutil.relativedelta import relativedelta
import hashlib
import time
from functools import lru_cache
import threading

# Set up logging
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('github-analyzer')

app = Flask(__name__)

# Get GitHub token from environment variable
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")

# Cache settings
CACHE_TIMEOUT = 3600  # Cache data for 1 hour (in seconds)
cache = {}
cache_lock = threading.Lock()

def get_headers(token=None):
    """Get headers with token, prioritizing passed token over env variable"""
    if token is None:
        token = GITHUB_TOKEN
        
    if not token:
        logger.warning("GitHub token not found")
        return {"Accept": "application/vnd.github.v3+json"}
    else:
        logger.info(f"Using token starting with: {token[:4]}{'*' * (len(token) - 4)}")
        return {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json"
        }

@lru_cache(maxsize=32)
def check_rate_limit(token=None):
    """Check GitHub API rate limit status with LRU caching"""
    url = "https://api.github.com/rate_limit"
    headers = get_headers(token)
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            data = response.json()
            remaining = data['resources']['core']['remaining']
            limit = data['resources']['core']['limit']
            reset_time = datetime.datetime.fromtimestamp(data['resources']['core']['reset'])
            
            logger.info(f"Rate limit: {remaining}/{limit}")
            logger.info(f"Reset time: {reset_time}")
            
            return {
                "remaining": remaining,
                "limit": limit,
                "reset_time": reset_time
            }
        else:
            logger.error(f"Failed to check rate limit: {response.status_code}")
            logger.error(f"Response: {response.text}")
            return None
    except Exception as e:
        logger.error(f"Exception checking rate limit: {str(e)}")
        return None

def parse_github_url(url):
    """Extract owner and repo name from GitHub URL"""
    if not url:
        logger.warning("Empty URL provided")
        return None, None
        
    logger.info(f"Parsing URL: {url}")
    
    # Handle URLs with or without https://
    if "://" not in url:
        url = "https://" + url
        
    # Remove trailing .git if present
    if url.endswith('.git'):
        url = url[:-4]
        
    # Handle multiple URL formats more efficiently
    parts = url.strip('/').split('/')
    
    if 'github.com' in parts:
        try:
            idx = parts.index('github.com')
            if len(parts) > idx + 2:
                return parts[idx + 1], parts[idx + 2]
        except ValueError:
            pass
    
    logger.warning("Could not parse GitHub URL correctly")
    return None, None

def make_api_request(url, headers, params=None, timeout=15):
    """Make an API request with retry logic and good error handling"""
    max_retries = 3
    retry_delay = 2  # seconds
    
    for attempt in range(max_retries):
        try:
            if params:
                response = requests.get(url, headers=headers, params=params, timeout=timeout)
            else:
                response = requests.get(url, headers=headers, timeout=timeout)
                
            # Handle rate limiting
            if response.status_code == 403 and 'rate limit exceeded' in response.text.lower():
                reset_time = int(response.headers.get('X-RateLimit-Reset', 0))
                wait_time = max(reset_time - time.time(), 0)
                
                if wait_time > 60 or attempt == max_retries - 1:  # Don't wait more than a minute
                    logger.error(f"Rate limit exceeded. Reset in {wait_time} seconds.")
                    return None
                
                logger.warning(f"Rate limit exceeded. Retrying in {retry_delay} seconds")
                time.sleep(retry_delay)
                continue
                
            # Return immediately for successful response
            if response.status_code == 200:
                return response
                
            # For other errors, log and maybe retry
            logger.error(f"API request error: {response.status_code}, URL: {url}")
            logger.error(f"Response content: {response.text[:200]}")
            
            if attempt < max_retries - 1:
                time.sleep(retry_delay)
            
        except (requests.RequestException, ConnectionError, TimeoutError) as e:
            logger.error(f"Request failed: {str(e)}")
            if attempt < max_retries - 1:
                time.sleep(retry_delay)
    
    return None

def get_cache_key(url, params=None):
    """Generate a unique cache key for a request"""
    key = url
    if params:
        key += str(sorted(params.items()))
    return hashlib.md5(key.encode()).hexdigest()

def get_cached_or_fetch(url, headers, params=None):
    """Get data from cache or fetch from API and cache it"""
    key = get_cache_key(url, params)
    
    with cache_lock:
        if key in cache and cache[key]['expires'] > time.time():
            logger.info(f"Cache hit for {url}")
            return cache[key]['data']
    
    # Cache miss, fetch from API
    logger.info(f"Cache miss for {url}, fetching from API")
    response = make_api_request(url, headers, params)
    
    if response and response.status_code == 200:
        try:
            data = response.json()
            with cache_lock:
                cache[key] = {
                    'data': data,
                    'expires': time.time() + CACHE_TIMEOUT
                }
            return data
        except Exception as e:
            logger.error(f"Error parsing response: {str(e)}")
    
    return None

def fetch_repo_data(owner, repo, token=None):
    """Efficient fetching of repository data (batch requests where possible)"""
    headers = get_headers(token)
    base_url = f"https://api.github.com/repos/{owner}/{repo}"
    
    # Main repo info
    repo_data = get_cached_or_fetch(base_url, headers)
    if not repo_data:
        return None
    
    # Contributors data (limited to 10 to save on API calls)
    contributors_url = f"{base_url}/contributors"
    contributors_data = get_cached_or_fetch(contributors_url, headers, {"per_page": 10})
    
    # Stats endpoints that we'll use to minimize API calls
    stats_endpoints = {
        "participation": f"{base_url}/stats/participation",  # commit activity 
        "code_frequency": f"{base_url}/stats/code_frequency", # additions/deletions
    }
    
    stats_data = {}
    for key, url in stats_endpoints.items():
        stats_data[key] = get_cached_or_fetch(url, headers)
    
    # Issues and PRs - use the issues endpoint with parameters
    # This saves API calls compared to fetching issues and PRs separately
    issues_data = get_cached_or_fetch(f"{base_url}/issues", headers, 
                                      {"state": "all", "per_page": 100})
    
    # Process data
    processed_data = process_repo_data(repo_data, contributors_data, stats_data, issues_data)
    
    return processed_data

def process_repo_data(repo_data, contributors_data, stats_data, issues_data):
    """Process raw API data into useful metrics and insights"""
    # Basic repo info
    result = {
        "repo_info": {
            "name": repo_data["name"],
            "description": repo_data.get("description", "No description available"),
            "stars": repo_data["stargazers_count"],
            "forks": repo_data["forks_count"],
            "open_issues": repo_data["open_issues_count"],
            "watchers": repo_data["watchers_count"],
            "created_at": repo_data["created_at"],
            "updated_at": repo_data["updated_at"],
            "language": repo_data.get("language", "Not specified"),
            "default_branch": repo_data.get("default_branch", "main"),
            "license": repo_data.get("license", {}).get("name", "Not specified")
        },
        "top_contributors": [],
        "metrics": {},
        "charts": {}
    }
    
    # Process contributors
    if contributors_data:
        result["top_contributors"] = [
            {"login": c["login"], 
             "commits": c["contributions"], 
             "avatar_url": c["avatar_url"]} 
            for c in contributors_data
        ]
    
    # Separate issues and PRs from issues_data
    issues = []
    prs = []
    if issues_data:
        for item in issues_data:
            if "pull_request" in item:
                prs.append(item)
            else:
                issues.append(item)
    
    # Calculate metrics
    result["metrics"] = calculate_metrics(repo_data, contributors_data, issues, prs, stats_data)
    
    # Generate charts
    result["charts"] = generate_charts(result["repo_info"], result["top_contributors"], 
                                     issues, prs, stats_data)
    
    return result

def calculate_metrics(repo_data, contributors_data, issues, prs, stats_data):
    """Calculate various repository metrics"""
    metrics = {}
    
    # Average issue resolution time
    resolution_times = []
    for issue in issues:
        if issue["state"] == "closed" and issue.get("closed_at"):
            try:
                created_at = datetime.datetime.strptime(issue["created_at"], "%Y-%m-%dT%H:%M:%SZ")
                closed_at = datetime.datetime.strptime(issue["closed_at"], "%Y-%m-%dT%H:%M:%SZ")
                resolution_time = (closed_at - created_at).total_seconds() / 3600  # in hours
                resolution_times.append(resolution_time)
            except Exception as e:
                logger.error(f"Error calculating resolution time: {str(e)}")
    
    metrics["avg_issue_resolution_time"] = round(sum(resolution_times) / len(resolution_times), 2) if resolution_times else 0
    
    # PR metrics
    merged_prs = [pr for pr in prs if pr["state"] == "closed" and pr.get("merged_at")]
    
    # PR frequency
    if merged_prs:
        # Sort by merge date
        try:
            merged_prs.sort(key=lambda x: datetime.datetime.strptime(x.get("merged_at") or x["created_at"], "%Y-%m-%dT%H:%M:%SZ"))
            
            first_merge = datetime.datetime.strptime(merged_prs[0].get("merged_at") or merged_prs[0]["created_at"], "%Y-%m-%dT%H:%M:%SZ")
            last_merge = datetime.datetime.strptime(merged_prs[-1].get("merged_at") or merged_prs[-1]["created_at"], "%Y-%m-%dT%H:%M:%SZ")
            
            time_diff = (last_merge - first_merge).days
            metrics["pr_frequency"] = round(len(merged_prs) / (time_diff / 7), 2) if time_diff > 0 else len(merged_prs)
            
            # Average PR review time
            review_times = []
            for pr in merged_prs:
                if pr.get("merged_at") and pr.get("created_at"):
                    created = datetime.datetime.strptime(pr["created_at"], "%Y-%m-%dT%H:%M:%SZ")
                    merged = datetime.datetime.strptime(pr["merged_at"], "%Y-%m-%dT%H:%M:%SZ")
                    review_times.append((merged - created).total_seconds() / 3600)  # in hours
            
            metrics["avg_pr_review_time"] = round(sum(review_times) / len(review_times), 2) if review_times else 0
        except Exception as e:
            logger.error(f"Error calculating PR metrics: {str(e)}")
            metrics["pr_frequency"] = 0
            metrics["avg_pr_review_time"] = 0
    else:
        metrics["pr_frequency"] = 0
        metrics["avg_pr_review_time"] = 0
    
    # Activity metrics from stats
    metrics["weekly_commits"] = 0
    if stats_data.get("participation"):
        # Last 4 weeks of activity
        recent_activity = stats_data["participation"].get("all", [])[-4:]
        metrics["weekly_commits"] = round(sum(recent_activity) / len(recent_activity), 1) if recent_activity else 0
    
    # Calculate repository health score
    metrics["health_score"] = calculate_repo_health_score(repo_data, contributors_data, issues, merged_prs, metrics)
    
    return metrics

def calculate_repo_health_score(repo_info, contributors, issues, pulls, metrics):
    """Calculate a comprehensive repository health score"""
    score = 0
    max_score = 100
    
    try:
        # Factor 1: Recent activity
        if repo_info.get("updated_at"):
            last_update = datetime.datetime.strptime(repo_info["updated_at"], "%Y-%m-%dT%H:%M:%SZ")
            days_since_update = (datetime.datetime.now() - last_update).days
            if days_since_update < 7:
                score += 20
            elif days_since_update < 30:
                score += 15
            elif days_since_update < 90:
                score += 10
            elif days_since_update < 365:
                score += 5
        
        # Factor 2: Number of contributors
        contributor_count = len(contributors) if contributors else 0
        if contributor_count >= 10:
            score += 20
        elif contributor_count >= 5:
            score += 15
        elif contributor_count >= 2:
            score += 10
        elif contributor_count >= 1:
            score += 5
        
        # Factor 3: Issue resolution
        avg_resolution_time = metrics.get("avg_issue_resolution_time", 0)
        if 0 < avg_resolution_time <= 24:  # resolved within a day
            score += 20
        elif avg_resolution_time <= 72:  # within 3 days
            score += 15
        elif avg_resolution_time <= 168:  # within a week
            score += 10
        elif avg_resolution_time <= 720:  # within a month
            score += 5
        
        # Factor 4: PR metrics
        pr_per_week = metrics.get("pr_frequency", 0)
        if pr_per_week >= 10:
            score += 20
        elif pr_per_week >= 5:
            score += 15
        elif pr_per_week >= 1:
            score += 10
        elif pr_per_week > 0:
            score += 5
        
        # Factor 5: Community interest
        stars = repo_info.get("stargazers_count", 0)
        forks = repo_info.get("forks_count", 0)
        
        if stars >= 1000 or forks >= 500:
            score += 20
        elif stars >= 100 or forks >= 50:
            score += 15
        elif stars >= 10 or forks >= 5:
            score += 10
        elif stars > 0 or forks > 0:
            score += 5
        
        return min(score, max_score)  # Cap at 100
    except Exception as e:
        logger.error(f"Error calculating health score: {str(e)}")
        return 50  # Default to middle score on error

def generate_charts(repo_info, contributors, issues, prs, stats_data):
    """Generate all visualization charts"""
    charts = {}
    
    # Contributors chart
    if contributors:
        try:
            # Extract data
            logins = [c["login"] for c in contributors]
            commits = [c["commits"] for c in contributors]
            
            # Create bar chart
            fig = go.Figure(data=[
                go.Bar(x=logins, y=commits, marker_color='royalblue')
            ])
            
            fig.update_layout(
                title="Top Contributors by Commits",
                xaxis_title="Contributor",
                yaxis_title="Number of Commits",
                height=500
            )
            
            charts["contributor_chart"] = json.dumps(fig, cls=plotly.utils.PlotlyJSONEncoder)
        except Exception as e:
            logger.error(f"Error creating contributor chart: {str(e)}")
    
    # Repository stats chart
    try:
        labels = ['Stars', 'Forks', 'Open Issues', 'Watchers']
        values = [
            repo_info.get("stars", 0),
            repo_info.get("forks", 0),
            repo_info.get("open_issues", 0),
            repo_info.get("watchers", 0)
        ]
        
        fig = go.Figure(data=[go.Pie(
            labels=labels,
            values=values,
            hole=.3,
            marker_colors=['gold', 'mediumturquoise', 'darkorange', 'lightgreen']
        )])
        
        fig.update_layout(
            title="Repository Statistics",
            height=500
        )
        
        charts["repo_stats_chart"] = json.dumps(fig, cls=plotly.utils.PlotlyJSONEncoder)
    except Exception as e:
        logger.error(f"Error creating repo stats chart: {str(e)}")
    
    # Issue trends chart
    month_labels, opened_counts, closed_counts = calculate_monthly_issues(issues)
    
    if month_labels:
        try:
            fig = go.Figure()
            
            fig.add_trace(go.Scatter(
                x=month_labels, 
                y=opened_counts,
                mode='lines+markers',
                name='Opened Issues',
                line=dict(color='red', width=2)
            ))
            
            fig.add_trace(go.Scatter(
                x=month_labels, 
                y=closed_counts,
                mode='lines+markers',
                name='Closed Issues',
                line=dict(color='green', width=2)
            ))
            
            fig.update_layout(
                title="Monthly Issue Trends",
                xaxis_title="Month",
                yaxis_title="Number of Issues",
                height=500
            )
            
            charts["issues_trend_chart"] = json.dumps(fig, cls=plotly.utils.PlotlyJSONEncoder)
        except Exception as e:
            logger.error(f"Error creating issues trend chart: {str(e)}")
    
    # Recent activity chart
    if stats_data.get("participation"):
        try:
            weeks = list(range(1, len(stats_data["participation"]["all"]) + 1))
            all_commits = stats_data["participation"]["all"]
            owner_commits = stats_data["participation"]["owner"]
            
            fig = go.Figure()
            
            fig.add_trace(go.Bar(
                x=weeks[-12:],  # Last 12 weeks
                y=all_commits[-12:],
                name='All Commits',
                marker_color='royalblue'
            ))
            
            fig.add_trace(go.Bar(
                x=weeks[-12:],
                y=owner_commits[-12:],
                name='Owner Commits',
                marker_color='lightseagreen'
            ))
            
            fig.update_layout(
                title="Commit Activity (Last 12 Weeks)",
                xaxis_title="Week",
                yaxis_title="Number of Commits",
                height=500,
                barmode='group'
            )
            
            charts["activity_chart"] = json.dumps(fig, cls=plotly.utils.PlotlyJSONEncoder)
        except Exception as e:
            logger.error(f"Error creating activity chart: {str(e)}")
    
    return charts

def calculate_monthly_issues(issues):
    """Calculate monthly opened and closed issues for trend analysis"""
    if not issues:
        return [], [], []
    
    try:
        # Find the date range
        dates = [datetime.datetime.strptime(issue["created_at"], "%Y-%m-%dT%H:%M:%SZ") for issue in issues]
        closing_dates = [datetime.datetime.strptime(issue["closed_at"], "%Y-%m-%dT%H:%M:%SZ") 
                for issue in issues if issue["state"] == "closed" and issue.get("closed_at")]
        
        if not dates:
            return [], [], []
        
        all_dates = dates + closing_dates
        min_date = min(all_dates).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        max_date = max(all_dates).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        
        # Generate monthly buckets
        months = []
        current = min_date
        while current <= max_date:
            months.append(current)
            current += relativedelta(months=1)
        
        # Count issues per month more efficiently
        opened_counts = [0] * len(months)
        closed_counts = [0] * len(months)
        
        # Create a lookup for month indices
        month_indices = {month: idx for idx, month in enumerate(months)}
        
        for issue in issues:
            created_at = datetime.datetime.strptime(issue["created_at"], "%Y-%m-%dT%H:%M:%SZ")
            created_month = created_at.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            
            if created_month in month_indices:
                opened_counts[month_indices[created_month]] += 1
            
            if issue["state"] == "closed" and issue.get("closed_at"):
                closed_at = datetime.datetime.strptime(issue["closed_at"], "%Y-%m-%dT%H:%M:%SZ")
                closed_month = closed_at.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                
                if closed_month in month_indices:
                    closed_counts[month_indices[closed_month]] += 1
        
        # Format months for display
        month_labels = [month.strftime("%b %Y") for month in months]
        
        return month_labels, opened_counts, closed_counts
    except Exception as e:
        logger.error(f"Error calculating monthly issues: {str(e)}")
        return [], [], []

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/check-token', methods=['GET'])
def check_token_route():
    """Check if GitHub token is valid"""
    # Get token from headers if provided
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('token '):
        token = auth_header[6:]
    else:
        token = None
    
    rate_limit_info = check_rate_limit(token)
    
    if rate_limit_info:
        return jsonify({
            "status": "success",
            "message": "GitHub token is valid",
            "rate_limit": rate_limit_info
        })
    else:
        return jsonify({
            "status": "error",
            "message": "GitHub token is invalid or not set"
        }), 401

@app.route('/analyze', methods=['POST'])
def analyze():
    try:
        data = request.json
        repo_url = data.get('repo_url', '')
        
        # Get token from headers if provided
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('token '):
            token = auth_header[6:]
        else:
            token = None
        
        # Check rate limit before proceeding
        rate_limit = check_rate_limit(token)
        if rate_limit and rate_limit["remaining"] <= 5:
            return jsonify({
                "error": f"GitHub API rate limit nearly exceeded. Only {rate_limit['remaining']} requests left. Reset at {rate_limit['reset_time']}"
            }), 429
        
        if not repo_url:
            return jsonify({"error": "Repository URL is required"}), 400
        
        owner, repo = parse_github_url(repo_url)
        logger.info(f"Analyzing repository: owner='{owner}', repo='{repo}'")
        
        if not owner or not repo:
            return jsonify({"error": "Invalid GitHub repository URL"}), 400
        
        # Fetch all repo data with one call to our optimized function
        repo_data = fetch_repo_data(owner, repo, token)
        
        if not repo_data:
            return jsonify({"error": "Repository not found or API rate limit exceeded"}), 404
        
        # Add cache timestamp
        repo_data["cache_timestamp"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        return jsonify(repo_data)
    except Exception as e:
        logger.error(f"Error in analyze endpoint: {str(e)}")
        return jsonify({"error": f"An error occurred while analyzing the repository: {str(e)}"}), 500

@app.route('/clear-cache', methods=['POST'])
def clear_cache():
    """Admin endpoint to clear the cache"""
    try:
        with cache_lock:
            cache.clear()
        check_rate_limit.cache_clear()  # Clear LRU cache
        return jsonify({"message": "Cache cleared successfully"})
    except Exception as e:
        logger.error(f"Error clearing cache: {str(e)}")
        return jsonify({"error": f"Error clearing cache: {str(e)}"}), 500

# Health check endpoint for monitoring
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "timestamp": datetime.datetime.now().isoformat()})

if __name__ == '__main__':
    # Check if token is available
    if not GITHUB_TOKEN:
        print("\n" + "="*80)
        print("WARNING: GitHub token not set! Set it with:")
        print("  On Windows PowerShell:  $env:GITHUB_TOKEN = 'your_token_here'")
        print("  On Windows CMD:         set GITHUB_TOKEN=your_token_here")
        print("  On Linux/Mac:           export GITHUB_TOKEN=your_token_here")
        print("="*80 + "\n")
    else:
        print(f"GitHub token is set (starting with {GITHUB_TOKEN[:4]}{'*' * (len(GITHUB_TOKEN) - 4)})")
    
    # Start the Flask app
    app.run(debug=True)