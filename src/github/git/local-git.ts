/**
 * @file Local git command executor.
 *
 * Replaces the GitHub Git Data API approach (blobs, trees, commits, refs) with
 * local `git` commands for committing and pushing changes. This is significantly
 * faster as it eliminates multiple HTTP round-trips.
 */

import { execSync } from 'node:child_process';
import * as github from '@actions/github';
import { createLogger } from './types';

/**
 * Get the repository root directory.
 */
function getRepoRoot(): string {
  return process.env.GITHUB_WORKSPACE ?? process.cwd();
}

/**
 * Run a git command and return the trimmed stdout.
 *
 * @param args - Git command arguments (e.g. `['add', '-A']`).
 * @param log - Logger instance.
 * @returns Trimmed stdout output.
 * @throws {Error} If the command exits with a non-zero code.
 */
function git(args: string[], log: ReturnType<typeof createLogger>): string {
  const cmd = `git ${args.join(' ')}`;
  log.debug(`$ ${cmd}`);
  try {
    const output = execSync(cmd, {
      cwd: getRepoRoot(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (output) {
      log.debug(output);
    }
    return output;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git command failed: ${cmd}\n${message}`);
  }
}

/**
 * Configure git user identity for commits.
 *
 * Uses the standard `github-actions[bot]` identity.
 */
export function configureGitUser(log = createLogger()): void {
  git(['config', 'user.name', '"github-actions[bot]"'], log);
  git(
    ['config', 'user.email', '"41898282+github-actions[bot]@users.noreply.github.com"'],
    log
  );
  log.debug('Git user configured');
}

/**
 * Configure authentication for push operations.
 *
 * Sets the remote URL to use the provided token for HTTPS auth.
 *
 * @param token - GitHub token for authentication.
 */
export function configureGitAuth(token: string, log = createLogger()): void {
  const { owner, repo } = github.context.repo;
  git(
    [
      'remote',
      'set-url',
      'origin',
      `https://x-access-token:${token}@github.com/${owner}/${repo}.git`,
    ],
    log
  );
  log.debug('Git auth configured');
}

/**
 * Check if there are uncommitted changes in the working tree.
 *
 * @returns `true` if there are staged or unstaged changes.
 */
export function hasLocalChanges(log = createLogger()): boolean {
  const output = git(['status', '--porcelain'], log);
  return output.length > 0;
}

/**
 * Get a summary of local changes for dry-run reporting.
 *
 * @returns Counts of added, modified, and deleted files.
 */
export function getChangesSummary(
  log = createLogger()
): {
  added: number;
  modified: number;
  deleted: number;
  files: string[];
} {
  const output = git(['status', '--porcelain'], log);
  if (!output) {
    return { added: 0, modified: 0, deleted: 0, files: [] };
  }

  const lines = output.split('\n').filter(Boolean);
  let added = 0;
  let modified = 0;
  let deleted = 0;
  const files: string[] = [];

  for (const line of lines) {
    const status = line.substring(0, 2).trim();
    const file = line.substring(3);
    files.push(file);

    if (status === '??' || status === 'A') {
      added++;
    } else if (status === 'D') {
      deleted++;
    } else {
      modified++;
    }
  }

  return { added, modified, deleted, files };
}

/**
 * Stage all changes in the working tree.
 */
export function stageAllChanges(log = createLogger()): void {
  git(['add', '-A'], log);
  log.debug('All changes staged');
}

/**
 * Commit staged changes.
 *
 * @param message - Commit message.
 * @returns The SHA of the new commit.
 */
export function commitChanges(message: string, log = createLogger()): string {
  git(['commit', '-m', message], log);
  const sha = git(['rev-parse', 'HEAD'], log);
  log.info(`Created commit: ${sha}`);
  return sha;
}

/**
 * Push changes to remote.
 *
 * @param branch - Branch name to push.
 * @param setUpstream - Whether to set upstream tracking (`-u`).
 */
export function pushToRemote(
  branch: string,
  setUpstream: boolean,
  log = createLogger()
): void {
  const args = setUpstream
    ? ['push', '-u', 'origin', branch]
    : ['push', 'origin', branch];
  git(args, log);
  log.info(`Pushed to origin/${branch}`);
}

/**
 * Fetch a remote branch.
 *
 * @param branch - Branch name to fetch.
 */
export function fetchBranch(branch: string, log = createLogger()): void {
  git(['fetch', 'origin', branch], log);
  log.debug(`Fetched origin/${branch}`);
}

/**
 * Checkout an existing branch.
 *
 * @param branch - Branch name to checkout.
 */
export function checkoutBranch(branch: string, log = createLogger()): void {
  git(['checkout', branch], log);
  log.debug(`Checked out branch: ${branch}`);
}

/**
 * Create and checkout a new branch from the current HEAD.
 *
 * @param branch - New branch name.
 */
export function createAndCheckoutBranch(branch: string, log = createLogger()): void {
  git(['checkout', '-b', branch], log);
  log.debug(`Created and checked out branch: ${branch}`);
}

/**
 * Stash uncommitted changes.
 *
 * @returns `true` if changes were stashed, `false` if working tree was clean.
 */
export function stashChanges(log = createLogger()): boolean {
  const output = git(['stash', 'push', '-u', '-m', 'pi-agent-changes'], log);
  return !output.includes('No local changes');
}

/**
 * Pop the most recent stash.
 */
export function stashPop(log = createLogger()): void {
  git(['stash', 'pop'], log);
  log.debug('Stash popped');
}
