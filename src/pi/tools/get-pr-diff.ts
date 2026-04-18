/**
 * @file get_pull_request_diff tool definition.
 */

import { Type, Static } from '@sinclair/typebox';
import { defineTool } from '@mariozechner/pi-coding-agent';
import {
  GET_PULL_REQUEST_DIFF_PROMPT_SNIPPET,
  GET_PULL_REQUEST_DIFF_PROMPT_GUIDELINES,
  GET_PULL_REQUEST_DIFF_DESCRIPTION,
  GET_PULL_REQUEST_DIFF_PARAM_PULL_NUMBER_DESCRIPTION,
  GET_PULL_REQUEST_DIFF_PARAM_MAX_FILES_DESCRIPTION,
  GET_PULL_REQUEST_DIFF_PARAM_FILE_FILTER_DESCRIPTION,
} from '../prompt';
import { getPullRequestDiff, CANCELLATION_MESSAGE_GET_PR_DIFF } from '../../github/index';
import type { GetPullRequestDiffParams } from '../../github/index';
import { withCancellation } from './tool-execution';

/**
 * Schema for the get_pull_request_diff tool.
 */
const getPullRequestDiffSchema = Type.Object({
  pull_number: Type.Optional(
    Type.Integer({
      description: GET_PULL_REQUEST_DIFF_PARAM_PULL_NUMBER_DESCRIPTION,
    })
  ),
  max_files: Type.Optional(
    Type.Integer({
      description: GET_PULL_REQUEST_DIFF_PARAM_MAX_FILES_DESCRIPTION,
    })
  ),
  file_filter: Type.Optional(
    Type.String({
      description: GET_PULL_REQUEST_DIFF_PARAM_FILE_FILTER_DESCRIPTION,
    })
  ),
});

type GetPullRequestDiffToolParams = Static<typeof getPullRequestDiffSchema>;

/**
 * Tool definition for fetching pull request diff.
 */
export const getPRDiffTool = defineTool({
  name: 'get_pull_request_diff',
  label: 'Get Pull Request Diff',
  description: GET_PULL_REQUEST_DIFF_DESCRIPTION,
  promptSnippet: GET_PULL_REQUEST_DIFF_PROMPT_SNIPPET,
  promptGuidelines: GET_PULL_REQUEST_DIFF_PROMPT_GUIDELINES,
  // @ts-expect-error - TypeBox Symbol property not recognized by TypeScript
  parameters: getPullRequestDiffSchema,
  execute: withCancellation({
    cancellationMessage: CANCELLATION_MESSAGE_GET_PR_DIFF,
    cancellationDetails: {
      pullRequestNumber: 0,
      totalFiles: 0,
      returnedFiles: 0,
      totalAdditions: 0,
      totalDeletions: 0,
      files: [],
    },
    prepareParams: (params: GetPullRequestDiffToolParams) => {
      const diffParams: GetPullRequestDiffParams = {};
      if (params.pull_number !== undefined) {
        diffParams.pull_number = params.pull_number;
      }
      if (params.max_files !== undefined) {
        diffParams.max_files = params.max_files;
      }
      if (params.file_filter !== undefined) {
        diffParams.file_filter = params.file_filter;
      }
      return diffParams;
    },
    execute: getPullRequestDiff,
  }),
});
