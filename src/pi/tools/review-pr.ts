/**
 * @file review_pull_request tool definition.
 */

import { Type, Static } from '@sinclair/typebox';
import { defineTool } from '@mariozechner/pi-coding-agent';
import {
  REVIEW_PULL_REQUEST_PROMPT_SNIPPET,
  REVIEW_PULL_REQUEST_PROMPT_GUIDELINES,
  REVIEW_PULL_REQUEST_DESCRIPTION,
  REVIEW_PULL_REQUEST_PARAM_PULL_NUMBER_DESCRIPTION,
  REVIEW_PULL_REQUEST_PARAM_EVENT_DESCRIPTION,
  REVIEW_PULL_REQUEST_PARAM_BODY_DESCRIPTION,
  REVIEW_PULL_REQUEST_PARAM_COMMENTS_DESCRIPTION,
} from '../prompt';
import { reviewPullRequest, CANCELLATION_MESSAGE_REVIEW_PR } from '../../github/index';
import type { ReviewPullRequestParams } from '../../github/index';
import { withCancellation } from './tool-execution';

/**
 * Schema for inline review comments.
 */
const reviewInlineCommentSchema = Type.Object({
  path: Type.String({ description: 'Relative path to the file being commented on.' }),
  line: Type.Integer({ description: 'The line number in the diff to attach the comment to.' }),
  side: Type.Optional(
    Type.Union([Type.Literal('LEFT'), Type.Literal('RIGHT')], {
      description: 'The side of the diff: LEFT for deletions, RIGHT for additions.',
    })
  ),
  body: Type.String({ description: 'The comment body in markdown.' }),
});

/**
 * Schema for the review_pull_request tool.
 */
const reviewPullRequestSchema = Type.Object({
  pull_number: Type.Optional(
    Type.Integer({
      description: REVIEW_PULL_REQUEST_PARAM_PULL_NUMBER_DESCRIPTION,
    })
  ),
  event: Type.Union(
    [Type.Literal('APPROVE'), Type.Literal('REQUEST_CHANGES'), Type.Literal('COMMENT')],
    {
      description: REVIEW_PULL_REQUEST_PARAM_EVENT_DESCRIPTION,
    }
  ),
  body: Type.Optional(
    Type.String({
      description: REVIEW_PULL_REQUEST_PARAM_BODY_DESCRIPTION,
    })
  ),
  comments: Type.Optional(
    Type.Array(reviewInlineCommentSchema, {
      description: REVIEW_PULL_REQUEST_PARAM_COMMENTS_DESCRIPTION,
    })
  ),
});

type ReviewPullRequestToolParams = Static<typeof reviewPullRequestSchema>;

/**
 * Tool definition for reviewing a pull request.
 */
export const reviewPRTool = defineTool({
  name: 'review_pull_request',
  label: 'Review Pull Request',
  description: REVIEW_PULL_REQUEST_DESCRIPTION,
  promptSnippet: REVIEW_PULL_REQUEST_PROMPT_SNIPPET,
  promptGuidelines: REVIEW_PULL_REQUEST_PROMPT_GUIDELINES,
  // @ts-expect-error - TypeBox Symbol property not recognized by TypeScript
  parameters: reviewPullRequestSchema,
  execute: withCancellation({
    cancellationMessage: CANCELLATION_MESSAGE_REVIEW_PR,
    cancellationDetails: {
      reviewId: 0,
      pullRequestNumber: 0,
      event: 'COMMENT' as const,
      reviewUrl: '',
    },
    prepareParams: (params: ReviewPullRequestToolParams) => {
      const reviewParams: ReviewPullRequestParams = {
        event: params.event,
      };
      if (params.pull_number !== undefined) {
        reviewParams.pull_number = params.pull_number;
      }
      if (params.body !== undefined) {
        reviewParams.body = params.body;
      }
      if (params.comments !== undefined) {
        reviewParams.comments = params.comments;
      }
      return reviewParams;
    },
    execute: reviewPullRequest,
  }),
});
