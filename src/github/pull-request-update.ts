/**
 * @file GitHub pull request update tool implementation.
 *
 * Implements the server-side logic for the `update_pull_request` custom tool:
 * detecting changed files in the working tree, committing via local git
 * commands, and pushing to an existing PR branch. Supports updating the PR
 * title and body as well. Supports dry-run mode for testing without side effects.
 */

import * as github from '@actions/github';
import { getOctokit } from './octokit';
import { getCoreAdapter } from './index';
import { MAX_TITLE_LENGTH } from './constants';
import { createLogger } from './git/index';
import {
  configureGitUser,
  configureGitAuth,
  hasLocalChanges,
  getChangesSummary,
  stageAllChanges,
  commitChanges,
  pushToRemote,
  fetchBranch,
  checkoutBranch,
  stashChanges,
  stashPop,
} from './git/local-git';

const log = createLogger();

export interface UpdatePullRequestParams {
  pull_number?: number;
  title?: string;
  body?: string;
  message?: string;
  dryRun?: boolean;
}

export interface UpdatePullRequestResult {
  content: { type: 'text'; text: string }[];
  details: UpdatePullRequestDetails;
}

export interface UpdatePullRequestDetails {
  pullRequestNumber: number;
  pullRequestUrl: string;
  headBranch: string;
  baseBranch: string;
  commitSha?: string;
  titleUpdated?: boolean;
  bodyUpdated?: boolean;
  dryRun: boolean;
  cancelled?: boolean;
}

/**
 * Update an existing pull request's title and/or body via the GitHub REST API.
 *
 * @param pullNumber - PR number.
 * @param updates - Object with optional title and/or body.
 * @returns An object containing the updated PR URL.
 */
async function updatePullRequestMetadata(
  pullNumber: number,
  updates: { title?: string; body?: string }
): Promise<{ titleUpdated: boolean; bodyUpdated: boolean }> {
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  const updateParams: {
    title?: string;
    body?: string;
  } = {};

  if (updates.title !== undefined) {
    updateParams.title = updates.title;
  }
  if (updates.body !== undefined) {
    updateParams.body = updates.body;
  }

  if (Object.keys(updateParams).length === 0) {
    return { titleUpdated: false, bodyUpdated: false };
  }

  log.debug(`Updating PR #${pullNumber} metadata...`);

  const octokit = getOctokit();
  await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: pullNumber,
    ...updateParams,
  });

  return {
    titleUpdated: updates.title !== undefined,
    bodyUpdated: updates.body !== undefined,
  };
}

/**
 * Validate pull request update parameters.
 *
 * @param params - The pull request update parameters to validate.
 * @throws {Error} If validation fails.
 * @internal Exported for testing purposes.
 */
export function validateUpdatePullRequestParams(params: UpdatePullRequestParams): void {
  if (params.title !== undefined && params.title.length > MAX_TITLE_LENGTH) {
    throw new Error(
      `Pull request title exceeds maximum length of ${MAX_TITLE_LENGTH} characters (got ${params.title.length})`
    );
  }

  // Ensure at least one update parameter is provided (besides dryRun)
  const { title, body, message, pull_number } = params;
  const hasContentUpdate = title !== undefined || body !== undefined || message !== undefined;
  const hasPRContext = pull_number !== undefined || github.context.issue?.number;

  if (!hasContentUpdate && !hasPRContext) {
    throw new Error(
      'At least one update parameter (title, body, message, or pull_number) must be provided'
    );
  }
}

/**
 * Update a pull request end-to-end.
 *
 * Orchestrates the full flow: fetches the PR and its branch, detects local
 * changes, commits via local git, pushes to the PR branch, and optionally
 * updates the PR's title and/or body. When `dryRun` is `true` the operation
 * is simulated and no changes are made.
 *
 * @param params - Parameters controlling PR number, title, body, and dry-run.
 * @returns The tool result containing a human-readable message and structured
 *          details about the updated PR (or dry-run output).
 * @throws {Error} If the PR is not found or the operation fails.
 */
export async function updatePullRequest(
  params: UpdatePullRequestParams
): Promise<UpdatePullRequestResult> {
  const { pull_number, title, body, message, dryRun } = params;

  // Validate input parameters early
  validateUpdatePullRequestParams(params);

  // Resolve PR number from context if not provided
  const resolvedPullNumber = pull_number ?? github.context.issue.number;
  if (!resolvedPullNumber) {
    throw new Error(
      'Pull request number not provided and not available in context. ' +
        'Please provide pull_number parameter or run this action in the context of a pull request.'
    );
  }

  log.debug(`PR Number: ${resolvedPullNumber}`);
  log.debug(`Title: ${title ?? '(no change)'}`);
  log.debug(`Body: ${body ? '(provided)' : '(no change)'}`);
  log.debug(`DryRun: ${dryRun ?? false}`);

  // Fetch PR details (still needed for branch names and URL)
  const octokit = getOctokit();
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  log.debug(`Fetching PR #${resolvedPullNumber}...`);
  const prData = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: resolvedPullNumber,
  });

  // Verify we got a valid pull request (not an issue)
  if (prData.status !== 200 || !prData.data) {
    throw new Error(
      `Could not fetch pull request #${resolvedPullNumber}. ` +
        `Please verify the pull request number is correct and that you have access to this repository.`
    );
  }

  const headBranch = prData.data.head.ref;
  const baseBranch = prData.data.base.ref;
  const prUrl = prData.data.html_url;

  log.debug(`PR found: ${prUrl}`);
  log.debug(`Head branch: ${headBranch}`);
  log.debug(`Base branch: ${baseBranch}`);

  // Check for local changes
  const changes = hasLocalChanges(log);

  // Dry run mode - report what would happen without making changes
  if (dryRun) {
    const parts: string[] = [`[DRY RUN] Would update pull request #${resolvedPullNumber}:`];
    if (title !== undefined) {
      parts.push(`- Title: ${title}`);
    }
    if (body !== undefined) {
      parts.push(`- Body: ${body}`);
    }
    parts.push(`- Head branch: ${headBranch}`);
    parts.push(`- Base branch: ${baseBranch}`);
    if (changes) {
      const summary = getChangesSummary(log);
      parts.push(`- Code changes:`);
      if (summary.added > 0) {
        parts.push(`  - ${summary.added} new file(s)`);
      }
      if (summary.modified > 0) {
        parts.push(`  - ${summary.modified} modified file(s)`);
      }
      if (summary.deleted > 0) {
        parts.push(`  - ${summary.deleted} deleted file(s)`);
      }
    } else {
      parts.push(`- No code changes detected`);
    }

    const dryRunMessage = parts.join('\n');
    log.debug(dryRunMessage);

    return {
      content: [{ type: 'text' as const, text: dryRunMessage }],
      details: {
        pullRequestNumber: resolvedPullNumber,
        pullRequestUrl: prUrl,
        headBranch,
        baseBranch,
        dryRun: true,
      },
    };
  }

  let commitSha: string | undefined;
  if (changes) {
    // Configure git for commit and push
    const token = getCoreAdapter().getInput('github_token');
    configureGitUser(log);
    configureGitAuth(token, log);

    // Stash changes, checkout PR branch, pop stash, commit, push
    stashChanges(log);
    fetchBranch(headBranch, log);
    checkoutBranch(headBranch, log);
    stashPop(log);

    // Generate commit message
    let commitMessage = message;
    if (!commitMessage) {
      const summary = getChangesSummary(log);
      const changeParts: string[] = [];
      if (summary.added + summary.modified > 0) {
        changeParts.push(`${summary.added + summary.modified} modified/new file(s)`);
      }
      if (summary.deleted > 0) {
        changeParts.push(`${summary.deleted} deleted file(s)`);
      }
      commitMessage = `Update PR #${resolvedPullNumber}: ${changeParts.join(', ')}`;
    }

    stageAllChanges(log);
    commitSha = commitChanges(commitMessage, log);
    pushToRemote(headBranch, false, log);

    log.info(`Created new commit ${commitSha} on branch ${headBranch}`);
  } else {
    log.info(`No code changes detected, only updating PR metadata if provided`);
  }

  // Update PR title/body if provided
  let titleUpdated = false;
  let bodyUpdated = false;
  if (title !== undefined || body !== undefined) {
    const updateParams: { title?: string; body?: string } = {};
    if (title !== undefined) {
      updateParams.title = title;
    }
    if (body !== undefined) {
      updateParams.body = body;
    }
    const metadataResult = await updatePullRequestMetadata(resolvedPullNumber, updateParams);
    titleUpdated = metadataResult.titleUpdated;
    bodyUpdated = metadataResult.bodyUpdated;

    if (titleUpdated) {
      log.info(`Updated PR title to: ${title}`);
    }
    if (bodyUpdated) {
      log.info(`Updated PR description`);
    }
  }

  const successParts: string[] = [`Pull request #${resolvedPullNumber} updated: ${prUrl}`];
  if (commitSha) {
    successParts.push(`- New commit: ${commitSha}`);
  }
  if (titleUpdated) {
    successParts.push(`- Title updated`);
  }
  if (bodyUpdated) {
    successParts.push(`- Description updated`);
  }

  const successMessage = successParts.join('\n');
  log.info(`SUCCESS: ${successMessage}`);

  const details: UpdatePullRequestDetails = {
    pullRequestNumber: resolvedPullNumber,
    pullRequestUrl: prUrl,
    headBranch,
    baseBranch,
    dryRun: false,
  };

  if (commitSha !== undefined) {
    details.commitSha = commitSha;
  }
  if (titleUpdated) {
    details.titleUpdated = titleUpdated;
  }
  if (bodyUpdated) {
    details.bodyUpdated = bodyUpdated;
  }

  return {
    content: [{ type: 'text' as const, text: successMessage }],
    details,
  };
}
