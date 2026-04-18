/**
 * @file Pull request review logic.
 *
 * Submits a review on an existing pull request via the GitHub REST API.
 * Supports APPROVE, REQUEST_CHANGES, and COMMENT review events, with
 * optional inline file comments.
 */

import * as github from '@actions/github';
import { getOctokit } from './octokit';
import { getCoreAdapter } from './index';
import type { AgentToolResult } from '@mariozechner/pi-coding-agent';

/**
 * Supported review event types.
 */
export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

/**
 * An inline comment attached to a specific file and line in the PR diff.
 */
export interface ReviewInlineComment {
  /** Relative path to the file being commented on. */
  path: string;
  /** The line number in the diff to attach the comment to. */
  line: number;
  /** The side of the diff: LEFT for deletions, RIGHT for additions. */
  side?: 'LEFT' | 'RIGHT';
  /** The comment body in markdown. */
  body: string;
}

/**
 * Parameters for submitting a pull request review.
 */
export interface ReviewPullRequestParams {
  /** Pull request number. If omitted, uses current PR from context. */
  pull_number?: number;
  /** The review event type. */
  event: ReviewEvent;
  /** The top-level review body/summary in markdown. */
  body?: string;
  /** Optional inline comments on specific files/lines. */
  comments?: ReviewInlineComment[];
}

/**
 * Details returned after submitting a review.
 */
export interface ReviewPullRequestDetails {
  /** The review ID assigned by GitHub. */
  reviewId: number;
  /** The pull request number that was reviewed. */
  pullRequestNumber: number;
  /** The review event that was submitted. */
  event: ReviewEvent;
  /** The review HTML URL. */
  reviewUrl: string;
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

  // Try to get from context
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
 * Submit a review on a pull request.
 *
 * @param params - The review parameters.
 * @returns A tool result with the review details.
 */
export async function reviewPullRequest(
  params: ReviewPullRequestParams
): Promise<AgentToolResult<ReviewPullRequestDetails>> {
  const { owner, repo } = github.context.repo;
  const pullNumber = resolvePullNumber(params.pull_number);

  if (!pullNumber) {
    throw new Error(
      'Could not determine pull request number. ' +
        'Provide pull_number parameter or ensure you are running in a PR context.'
    );
  }

  debug(`[reviewPullRequest] Submitting ${params.event} review on PR #${pullNumber}`);

  const octokit = getOctokit();

  // Build the review request
  const reviewRequest: {
    owner: string;
    repo: string;
    pull_number: number;
    event: ReviewEvent;
    body?: string;
    comments?: Array<{
      path: string;
      line: number;
      side?: 'LEFT' | 'RIGHT';
      body: string;
    }>;
  } = {
    owner,
    repo,
    pull_number: pullNumber,
    event: params.event,
  };

  if (params.body !== undefined) {
    reviewRequest.body = params.body;
  }

  if (params.comments !== undefined && params.comments.length > 0) {
    reviewRequest.comments = params.comments.map(c => {
      const comment: { path: string; line: number; side?: 'LEFT' | 'RIGHT'; body: string } = {
        path: c.path,
        line: c.line,
        body: c.body,
      };
      if (c.side !== undefined) {
        comment.side = c.side;
      }
      return comment;
    });
  }

  const response = await octokit.rest.pulls.createReview(reviewRequest);

  const reviewId = response.data.id;
  const reviewUrl = response.data.html_url;

  debug(`[reviewPullRequest] Review #${reviewId} submitted successfully`);

  const details: ReviewPullRequestDetails = {
    reviewId,
    pullRequestNumber: pullNumber,
    event: params.event,
    reviewUrl: reviewUrl ?? '',
  };

  const eventLabel =
    params.event === 'APPROVE'
      ? 'approved'
      : params.event === 'REQUEST_CHANGES'
        ? 'requested changes on'
        : 'commented on';

  const commentCount = params.comments?.length ?? 0;
  const commentSuffix = commentCount > 0 ? ` with ${commentCount} inline comment(s)` : '';

  return {
    content: [
      {
        type: 'text' as const,
        text: `Successfully ${eventLabel} PR #${pullNumber}${commentSuffix}. Review URL: ${reviewUrl}`,
      },
    ],
    details,
  };
}
