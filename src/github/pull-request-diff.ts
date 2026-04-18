/**
 * @file Pull request diff retrieval logic.
 *
 * Fetches the changed files and their diffs for a pull request via the
 * GitHub REST API. Returns structured file-level changes with line numbers,
 * enabling the agent to leave pinpoint inline review comments.
 */

import * as github from '@actions/github';
import { getOctokit } from './octokit';
import { getCoreAdapter } from './index';
import type { AgentToolResult } from '@mariozechner/pi-coding-agent';

/**
 * A single changed file in the pull request.
 */
export interface PRDiffFile {
  /** The file path relative to the repository root. */
  filename: string;
  /** The type of change: added, removed, modified, renamed, copied, changed, unchanged. */
  status: string;
  /** Number of lines added. */
  additions: number;
  /** Number of lines deleted. */
  deletions: number;
  /** The unified diff patch for this file (may be empty for binary files). */
  patch?: string;
  /** Previous filename if the file was renamed. */
  previous_filename?: string;
}

/**
 * Parameters for fetching a pull request diff.
 */
export interface GetPullRequestDiffParams {
  /** Pull request number. If omitted, uses current PR from context. */
  pull_number?: number;
  /** Maximum number of files to return. Defaults to 50. */
  max_files?: number;
  /** Filter files by glob pattern (e.g., "src/**\/*.ts"). Simple prefix/suffix matching. */
  file_filter?: string;
}

/**
 * Details returned after fetching the diff.
 */
export interface GetPullRequestDiffDetails {
  /** The pull request number. */
  pullRequestNumber: number;
  /** Total number of changed files in the PR. */
  totalFiles: number;
  /** Number of files returned (may be less than totalFiles due to max_files or filtering). */
  returnedFiles: number;
  /** Total additions across all files in the PR. */
  totalAdditions: number;
  /** Total deletions across all files in the PR. */
  totalDeletions: number;
  /** The changed files with their diffs. */
  files: PRDiffFile[];
  /** Whether the operation was cancelled. */
  cancelled?: boolean;
}

/**
 * Debug logging helper.
 */
function debug(msg: string): void {
  getCoreAdapter().debug(msg);
}

/**
 * Resolve the pull request number from params or GitHub context.
 */
function resolvePullNumber(pullNumber?: number): number | undefined {
  if (pullNumber !== undefined) {
    return pullNumber;
  }

  const payload = github.context.payload;
  if (payload.pull_request?.number) {
    return payload.pull_request.number as number;
  }
  if (payload.issue?.pull_request && payload.issue?.number) {
    return payload.issue.number as number;
  }

  return undefined;
}

/**
 * Simple glob-like filter matching for file paths.
 * Supports:
 * - Exact match: "src/index.ts"
 * - Prefix: "src/**" matches anything starting with "src/"
 * - Suffix: "**.ts" matches anything ending with ".ts"
 * - Extension: "*.ts" matches any file ending with ".ts"
 */
function matchesFilter(filename: string, filter: string): boolean {
  // Exact match
  if (filename === filter) return true;

  // Handle ** prefix patterns like "src/**"
  if (filter.endsWith('/**')) {
    const prefix = filter.slice(0, -3);
    return filename.startsWith(prefix + '/') || filename === prefix;
  }

  // Handle ** suffix patterns like "**.ts" or "**/*.ts"
  if (filter.startsWith('**')) {
    const suffix = filter.slice(2);
    if (suffix.startsWith('/')) {
      return filename.endsWith(suffix) || filename === suffix.slice(1);
    }
    return filename.endsWith(suffix);
  }

  // Handle simple extension patterns like "*.ts"
  if (filter.startsWith('*.')) {
    const ext = filter.slice(1);
    return filename.endsWith(ext);
  }

  // Directory prefix match: "src/" matches "src/anything"
  if (filter.endsWith('/')) {
    return filename.startsWith(filter);
  }

  return false;
}

/**
 * Format the diff output as a readable text summary for the agent.
 */
function formatDiffAsText(
  pullNumber: number,
  files: PRDiffFile[],
  totalFiles: number
): string {
  const lines: string[] = [
    `## PR #${pullNumber} — Changed Files (${files.length}${files.length < totalFiles ? ` of ${totalFiles}` : ''})`,
    '',
  ];

  for (const file of files) {
    const statusIcon =
      file.status === 'added'
        ? '[NEW]'
        : file.status === 'removed'
          ? '[DEL]'
          : file.status === 'renamed'
            ? '[REN]'
            : '[MOD]';

    const renamedFrom =
      file.previous_filename ? ` (was: ${file.previous_filename})` : '';

    lines.push(
      `### ${statusIcon} ${file.filename}${renamedFrom}  (+${file.additions} -${file.deletions})`
    );

    if (file.patch) {
      lines.push('```diff');
      lines.push(file.patch);
      lines.push('```');
    } else {
      lines.push('_(binary file or no diff available)_');
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Fetch the changed files and diffs for a pull request.
 *
 * @param params - The diff retrieval parameters.
 * @returns A tool result with the diff details.
 */
export async function getPullRequestDiff(
  params: GetPullRequestDiffParams
): Promise<AgentToolResult<GetPullRequestDiffDetails>> {
  const { owner, repo } = github.context.repo;
  const pullNumber = resolvePullNumber(params.pull_number);
  const maxFiles = params.max_files ?? 50;

  if (!pullNumber) {
    throw new Error(
      'Could not determine pull request number. ' +
        'Provide pull_number parameter or ensure you are running in a PR context.'
    );
  }

  debug(`[getPullRequestDiff] Fetching diff for PR #${pullNumber}`);

  const octokit = getOctokit();

  // Fetch all changed files with pagination
  const allFiles: PRDiffFile[] = [];
  let page = 1;
  const perPage = 100;
  let totalAdditions = 0;
  let totalDeletions = 0;

  while (true) {
    const response = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: perPage,
      page,
    });

    if (response.data.length === 0) break;

    for (const file of response.data) {
      totalAdditions += file.additions;
      totalDeletions += file.deletions;

      const diffFile: PRDiffFile = {
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
      };
      if (file.patch !== undefined) {
        diffFile.patch = file.patch;
      }
      if (file.previous_filename !== undefined) {
        diffFile.previous_filename = file.previous_filename;
      }
      allFiles.push(diffFile);
    }

    if (response.data.length < perPage) break;
    page++;
  }

  // Apply file filter if provided
  let filteredFiles = allFiles;
  if (params.file_filter) {
    filteredFiles = allFiles.filter(f => matchesFilter(f.filename, params.file_filter!));
  }

  // Apply max_files limit
  const returnedFiles = filteredFiles.slice(0, maxFiles);

  debug(
    `[getPullRequestDiff] Found ${allFiles.length} files, returning ${returnedFiles.length}`
  );

  const details: GetPullRequestDiffDetails = {
    pullRequestNumber: pullNumber,
    totalFiles: allFiles.length,
    returnedFiles: returnedFiles.length,
    totalAdditions,
    totalDeletions,
    files: returnedFiles,
  };

  const text = formatDiffAsText(pullNumber, returnedFiles, allFiles.length);

  return {
    content: [{ type: 'text' as const, text }],
    details,
  };
}
