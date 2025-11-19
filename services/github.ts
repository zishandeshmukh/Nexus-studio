
// Helper to parse GitHub URLs
export const parseGithubUrl = (url: string) => {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname !== 'github.com') return null;

    const parts = urlObj.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;

    const owner = parts[0];
    let repo = parts[1];

    // Remove .git suffix if present
    if (repo.endsWith('.git')) {
      repo = repo.slice(0, -4);
    }

    return { owner, repo };
  } catch {
    return null;
  }
};

export interface FetchedFileStatus {
  path: string;
  size: number;
  status: 'pending' | 'success' | 'error';
}

export interface GithubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
  html_url: string;
  author?: {
    login: string;
    avatar_url: string;
    html_url: string;
  };
}

interface FetchOptions {
  fetchAll?: boolean;
  branch?: string;
  maxFileSize?: number; // in bytes
}

// Fetch recent commits
export const fetchGithubCommits = async (
  owner: string,
  repo: string,
  branch: string = 'main'
): Promise<GithubCommit[]> => {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?sha=${branch}&per_page=10`);
  if (!res.ok) {
    // If branch doesn't exist, this might fail
    throw new Error("Failed to fetch commits. Branch might be invalid.");
  }
  return await res.json();
};

// Fetch repository contents
export const fetchGithubRepoContents = async (
  url: string, 
  onProgress: (status: string) => void,
  onFileUpdate: (file: FetchedFileStatus) => void,
  allowedExtensions: string[] = [],
  signal?: AbortSignal,
  options: FetchOptions = {}
): Promise<{ content: string; repoDetails: { owner: string; repo: string; branch: string } }> => {
  const repoInfo = parseGithubUrl(url);
  if (!repoInfo) throw new Error("Invalid GitHub URL. Please use format: https://github.com/owner/repo");
  
  const { owner, repo } = repoInfo;
  
  // 1. Get Repository Info
  onProgress("Connecting to GitHub API...");
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { 'Accept': 'application/vnd.github.v3+json' },
    signal
  });

  if (!repoRes.ok) {
    if (repoRes.status === 404) throw new Error("Repository not found. It might be private or the URL is incorrect.");
    if (repoRes.status === 403) throw new Error("GitHub API rate limit exceeded. Please try again later or use a VPN.");
    throw new Error(`GitHub API Error: ${repoRes.statusText} (${repoRes.status})`);
  }
  
  const repoData = await repoRes.json();
  // Use provided branch, or default branch from repo data, or fallback to main
  const branch = options.branch || repoData.default_branch || 'main';

  // 2. Fetch File Tree
  onProgress(`Scanning repository structure (${branch})...`);
  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, {
    headers: { 'Accept': 'application/vnd.github.v3+json' },
    signal
  });
  
  if (!treeRes.ok) {
    if (treeRes.status === 404) throw new Error(`Branch '${branch}' not found.`);
    throw new Error("Failed to retrieve file structure.");
  }

  const treeData = await treeRes.json();
  
  if (treeData.truncated) {
    onProgress("Warning: Large repository, analyzing partial content...");
  }

  // 3. Smart File Filter
  const defaultExtensions = [
    '.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.java', '.c', '.cpp', '.rs', 
    '.rb', '.php', '.html', '.css', '.json', '.md', '.yml', '.yaml', '.toml', '.sql'
  ];

  // If fetchAll is true, ignore allowedExtensions (but keep safety blocklist)
  // If fetchAll is false, use allowedExtensions or defaults
  const effectiveExtensions = options.fetchAll 
    ? [] 
    : (allowedExtensions.length > 0 ? allowedExtensions : defaultExtensions);

  // If fetchAll is true, ignore max size limit (set to Infinity)
  const maxSizeBytes = options.fetchAll ? Infinity : (options.maxFileSize || 100 * 1024);

  // Prioritize important files
  const allFiles = treeData.tree.filter((node: any) => {
    if (node.type !== 'blob') return false;
    
    // Size check (skipped if fetchAll is true via logic above)
    if (node.size && node.size > maxSizeBytes) return false;

    // Blocklist (always active to prevent fetching binary assets/locks)
    const isBlocked = 
      node.path.includes('package-lock') ||
      node.path.includes('yarn.lock') ||
      node.path.includes('node_modules/') ||
      node.path.includes('dist/') ||
      node.path.includes('build/') ||
      node.path.includes('.min.') ||
      node.path.endsWith('.png') || 
      node.path.endsWith('.jpg') || 
      node.path.endsWith('.ico') ||
      node.path.endsWith('.svg');

    if (isBlocked) return false;

    // If fetchAll, accept everything not blocked. Else, check extension.
    if (options.fetchAll) return true;
    return effectiveExtensions.some(ext => node.path.endsWith(ext));
  });

  // Sort: README first, then Configs, then Source
  allFiles.sort((a: any, b: any) => {
    const score = (path: string) => {
      if (path.toLowerCase().includes('readme.md')) return 3;
      if (path.endsWith('json') || path.endsWith('toml') || path.endsWith('yml')) return 2;
      if (path.startsWith('src/')) return 1;
      return 0;
    };
    return score(b.path) - score(a.path);
  });

  // Take files. Increase limit for fetchAll.
  const limit = options.fetchAll ? 200 : (allowedExtensions.length > 0 && allowedExtensions.length < 3 ? 30 : 20);
  const filesToFetch = allFiles.slice(0, limit);

  if (filesToFetch.length === 0) throw new Error("No analyzable code files found matching the criteria.");

  // Notify UI of files to be fetched
  filesToFetch.forEach((f: any) => onFileUpdate({ path: f.path, size: f.size, status: 'pending' }));

  // 4. Parallel Content Fetching
  onProgress(`Downloading ${filesToFetch.length} files...`);
  
  let loadedCount = 0;
  // Fetch in batches of 5 to prevent browser network congestion
  const batchSize = 5;
  const results: string[] = [];
  
  for (let i = 0; i < filesToFetch.length; i += batchSize) {
    if (signal?.aborted) break;
    
    const batch = filesToFetch.slice(i, i + batchSize);
    const batchPromises = batch.map(async (file: any) => {
      if (signal?.aborted) return null;
      try {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
        const res = await fetch(rawUrl, { signal });
        if (!res.ok) {
          onFileUpdate({ path: file.path, size: file.size, status: 'error' });
          return null;
        }
        
        const text = await res.text();
        loadedCount++;
        onProgress(`Downloading files (${loadedCount}/${filesToFetch.length})...`);
        onFileUpdate({ path: file.path, size: file.size, status: 'success' });
        
        // Truncate huge files if they somehow slipped through (or for pure text length check)
        const MAX_TEXT_LENGTH = options.fetchAll ? 100000 : 50000; 
        const content = text.length > MAX_TEXT_LENGTH 
          ? text.substring(0, MAX_TEXT_LENGTH) + "\n...[Truncated]..." 
          : text;

        return `--- FILE: ${file.path} ---\n${content}\n--- END OF FILE ---\n\n`;
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn(`Failed to fetch ${file.path}`);
          onFileUpdate({ path: file.path, size: file.size, status: 'error' });
        }
        return null;
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter((r): r is string => r !== null));
  }

  if (results.length === 0 && !signal?.aborted) throw new Error("Failed to download raw file contents. Network or CORS issue.");

  const header = `Repository: ${owner}/${repo}\nBranch: ${branch}\nDescription: ${repoData.description || 'N/A'}\nStars: ${repoData.stargazers_count}\nLanguage: ${repoData.language}\n\n`;
  
  onProgress("Repository loaded successfully.");
  return { 
    content: header + results.join(""),
    repoDetails: { owner, repo, branch }
  };
};

export const fetchGithubFile = async (
  owner: string,
  repo: string,
  branch: string,
  path: string
): Promise<string> => {
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  const res = await fetch(rawUrl);
  if (!res.ok) {
    if (res.status === 404) throw new Error(`File not found: ${path}`);
    throw new Error(`Failed to fetch file: ${path}. Status: ${res.status}`);
  }
  return await res.text();
};
