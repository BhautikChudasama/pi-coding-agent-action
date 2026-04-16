/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test, mock, beforeEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Swallow ::notice:: / ::warning:: / ::debug:: annotations from @actions/core
const realStdoutWrite = process.stdout.write.bind(process.stdout);
const _mockedWrite = mock((...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.startsWith('::')) {
    return true;
  }
  return realStdoutWrite(...(args as Parameters<typeof process.stdout.write>));
});
process.stdout.write = _mockedWrite as typeof process.stdout.write;

// Mock @actions/core
const noop = (): void => {};
const mockGetInput = mock((name: string) => {
  if (name === 'github_token') {
    return 'fake-token';
  }
  return '';
});

mock.module('@actions/core', () => ({
  getInput: mockGetInput,
  notice: mock(noop),
  info: mock(noop),
  debug: mock(noop),
  setFailed: mock(noop),
  warning: mock(noop),
}));

// Set env vars BEFORE importing pull-request-update.ts
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), `gh-event-${Date.now()}.json`);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, '{}');

// Mock octokit
const mockPullsUpdate = mock(() =>
  Promise.resolve({
    data: {
      number: 42,
      html_url: 'https://github.com/test-owner/test-repo/pull/42',
    },
  })
);
const mockPullsGet = mock(() =>
  Promise.resolve({
    status: 200,
    data: {
      number: 42,
      html_url: 'https://github.com/test-owner/test-repo/pull/42',
      head: { ref: 'feature-branch', sha: 'head-sha-123' },
      base: { ref: 'main' },
    },
  })
);
const mockOctokit = {
  rest: {
    pulls: {
      get: mockPullsGet,
      update: mockPullsUpdate,
    },
  },
};
mock.module('../../src/github/octokit', () => ({
  getOctokit: mock(() => mockOctokit),
}));

// Mock local git operations
const mockHasLocalChanges = mock((_log?: any) => false as boolean);
const mockGetChangesSummary = mock((_log?: any) => ({ added: 0, modified: 0, deleted: 0, files: [] as string[] }));
const mockConfigureGitUser = mock(noop);
const mockConfigureGitAuth = mock((_token: string, _log?: any) => {});
const mockStageAllChanges = mock(noop);
const mockCommitChanges = mock((_msg: string, _log?: any) => 'commit-sha-123');
const mockPushToRemote = mock((_branch: string, _upstream: boolean, _log?: any) => {});
const mockFetchBranch = mock((_branch: string, _log?: any) => {});
const mockCheckoutBranch = mock((_branch: string, _log?: any) => {});
const mockStashChanges = mock((_log?: any) => true as boolean);
const mockStashPop = mock(noop);

mock.module('../../src/github/git/local-git', () => ({
  hasLocalChanges: mockHasLocalChanges,
  getChangesSummary: mockGetChangesSummary,
  configureGitUser: mockConfigureGitUser,
  configureGitAuth: mockConfigureGitAuth,
  stageAllChanges: mockStageAllChanges,
  commitChanges: mockCommitChanges,
  pushToRemote: mockPushToRemote,
  fetchBranch: mockFetchBranch,
  checkoutBranch: mockCheckoutBranch,
  stashChanges: mockStashChanges,
  stashPop: mockStashPop,
}));

// Setup default GitHub context
const mockContext = {
  repo: {
    owner: 'test-owner',
    repo: 'test-repo',
  },
  issue: {
    number: 42,
  },
  serverUrl: 'https://github.com',
  runId: 123456789,
  payload: {},
  eventName: 'pull_request',
};

// Mock @actions/github context
mock.module('@actions/github', () => ({
  context: mockContext,
}));

// Create a test CoreAdapter
const testCoreAdapter = {
  getInput: mockGetInput,
  setFailed: mock(noop),
  notice: mock(noop),
  info: mock(noop),
  debug: mock(noop),
  warning: mock(noop),
};

// Dynamic import to ensure mocks are set before module loads
const pullRequestUpdateModulePromise = import('../../src/github/pull-request-update.js');
const githubModulePromise = import('../../src/github/index.js');

// Cache the module after first import
let pullRequestUpdateModule: any | null = null;

async function getModule() {
  pullRequestUpdateModule ??= await pullRequestUpdateModulePromise;
  return pullRequestUpdateModule;
}

describe('updatePullRequest - integration tests', () => {
  beforeEach(async () => {
    mockPullsUpdate.mockClear();
    mockPullsGet.mockClear();
    mockHasLocalChanges.mockClear();
    mockGetChangesSummary.mockClear();
    mockConfigureGitUser.mockClear();
    mockConfigureGitAuth.mockClear();
    mockStageAllChanges.mockClear();
    mockCommitChanges.mockClear();
    mockPushToRemote.mockClear();
    mockFetchBranch.mockClear();
    mockCheckoutBranch.mockClear();
    mockStashChanges.mockClear();
    mockStashPop.mockClear();

    // Default: no local changes
    mockHasLocalChanges.mockReturnValue(false);

    // Reset to default context
    mockContext.issue = { number: 42 };
    mockContext.eventName = 'pull_request';
    mockContext.payload = {};

    // Initialize the github module context with test adapter
    const githubExports = await githubModulePromise;
    githubExports.setCoreAdapter(testCoreAdapter);
  });

  test('updates PR title successfully', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    const result = await updatePullRequest({
      title: 'Updated PR title',
    });

    expect(result.details.titleUpdated).toBe(true);
    expect(mockPullsUpdate).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 42,
      title: 'Updated PR title',
    });
  });

  test('updates PR body successfully', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    const result = await updatePullRequest({
      body: 'Updated PR description',
    });

    expect(result.details.bodyUpdated).toBe(true);
    expect(mockPullsUpdate).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 42,
      body: 'Updated PR description',
    });
  });

  test('updates both title and body', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    const result = await updatePullRequest({
      title: 'New title',
      body: 'New body',
    });

    expect(result.details.titleUpdated).toBe(true);
    expect(result.details.bodyUpdated).toBe(true);
    expect(mockPullsUpdate).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 42,
      title: 'New title',
      body: 'New body',
    });
  });

  test('commits and pushes when local changes exist', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    mockHasLocalChanges.mockReturnValue(true);
    mockGetChangesSummary.mockReturnValue({ added: 1, modified: 2, deleted: 0, files: ['a.ts', 'b.ts', 'c.ts'] });
    mockCommitChanges.mockReturnValue('new-commit-sha');

    const result = await updatePullRequest({
      message: 'Fix bug',
    });

    expect(mockConfigureGitUser).toHaveBeenCalled();
    expect(mockConfigureGitAuth).toHaveBeenCalledWith('fake-token', expect.anything());
    expect(mockStashChanges).toHaveBeenCalled();
    expect(mockFetchBranch).toHaveBeenCalledWith('feature-branch', expect.anything());
    expect(mockCheckoutBranch).toHaveBeenCalledWith('feature-branch', expect.anything());
    expect(mockStashPop).toHaveBeenCalled();
    expect(mockStageAllChanges).toHaveBeenCalled();
    expect(mockCommitChanges).toHaveBeenCalledWith('Fix bug', expect.anything());
    expect(mockPushToRemote).toHaveBeenCalledWith('feature-branch', false, expect.anything());
    expect(result.details.commitSha).toBe('new-commit-sha');
  });

  test('skips commit when no local changes', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    mockHasLocalChanges.mockReturnValue(false);

    const result = await updatePullRequest({
      title: 'Metadata only',
    });

    expect(mockConfigureGitUser).not.toHaveBeenCalled();
    expect(mockStageAllChanges).not.toHaveBeenCalled();
    expect(mockCommitChanges).not.toHaveBeenCalled();
    expect(mockPushToRemote).not.toHaveBeenCalled();
    expect(result.details.commitSha).toBeUndefined();
    expect(result.details.titleUpdated).toBe(true);
  });

  test('uses provided pull_number parameter', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    const result = await updatePullRequest({
      pull_number: 999,
      title: 'Custom PR',
    });

    expect(result.details.pullRequestNumber).toBe(999);
    expect(mockPullsGet).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 999,
    });
  });

  test('resolves PR number from context when not provided', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    const result = await updatePullRequest({
      title: 'Context PR',
    });

    expect(result.details.pullRequestNumber).toBe(42);
    expect(mockPullsGet).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 42,
    });
  });

  test('throws error when PR number not provided and not in context', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    // @ts-expect-error - Testing with undefined issue
    mockContext.issue = undefined;

    // The actual error happens when trying to access context.issue.number
    // since we have a title (which is valid), validation passes
    await expect(
      updatePullRequest({
        title: 'Test',
      })
    ).rejects.toThrow('undefined is not an object');
  });

  test('returns PR details in result', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    const result = await updatePullRequest({});

    expect(result.details.pullRequestNumber).toBe(42);
    expect(result.details.pullRequestUrl).toBe('https://github.com/test-owner/test-repo/pull/42');
    expect(result.details.headBranch).toBe('feature-branch');
    expect(result.details.baseBranch).toBe('main');
  });

  test('includes success message in content', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    const result = await updatePullRequest({
      title: 'Success test',
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Pull request #42 updated');
    expect(result.content[0].text).toContain('https://github.com/test-owner/test-repo/pull/42');
  });

  test('handles PR fetch failure', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    mockPullsGet.mockImplementationOnce(() => Promise.reject(new Error('PR not found')));

    await expect(updatePullRequest({})).rejects.toThrow();
  });

  test('updates PR with dryRun=true', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    const result = await updatePullRequest({
      title: 'Dry run title',
      dryRun: true,
    });

    expect(result.details.dryRun).toBe(true);
    expect(mockPullsUpdate).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('[DRY RUN]');
  });

  test('dry run reports local changes when present', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    mockHasLocalChanges.mockReturnValue(true);
    mockGetChangesSummary.mockReturnValue({ added: 2, modified: 1, deleted: 1, files: [] });

    const result = await updatePullRequest({
      dryRun: true,
    });

    expect(result.details.dryRun).toBe(true);
    expect(result.content[0].text).toContain('2 new file(s)');
    expect(result.content[0].text).toContain('1 modified file(s)');
    expect(result.content[0].text).toContain('1 deleted file(s)');
  });
});
