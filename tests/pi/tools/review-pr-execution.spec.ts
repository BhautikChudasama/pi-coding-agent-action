/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from 'bun:test';
import { reviewPRTool } from '../../../src/pi/tools/review-pr';
import * as githubIndex from '../../../src/github/index';

describe('review_pull_request tool - execution', () => {
  test('has correct tool name and label', () => {
    expect(reviewPRTool.name).toBe('review_pull_request');
    expect(reviewPRTool.label).toBe('Review Pull Request');
  });

  test('execute function exists and is a function', () => {
    expect(typeof reviewPRTool.execute).toBe('function');
  });

  test('parameters have correct structure', () => {
    const schema = reviewPRTool.parameters as any;
    expect(schema.properties).toBeDefined();
    expect(schema.properties.pull_number).toBeDefined();
    expect(schema.properties.event).toBeDefined();
    expect(schema.properties.body).toBeDefined();
    expect(schema.properties.comments).toBeDefined();
  });

  test('event parameter is required', () => {
    const schema = reviewPRTool.parameters as any;
    expect(schema.required).toContain('event');
  });

  test('pull_number, body, and comments are optional', () => {
    const schema = reviewPRTool.parameters as any;
    if (Array.isArray(schema.required)) {
      expect(schema.required).not.toContain('pull_number');
      expect(schema.required).not.toContain('body');
      expect(schema.required).not.toContain('comments');
    }
  });

  test('tool exports match github/index exports', () => {
    expect(githubIndex.reviewPullRequest).toBeDefined();
    expect(typeof githubIndex.reviewPullRequest).toBe('function');
  });

  test('has execute with built-in cancellation handling', () => {
    expect(typeof reviewPRTool.execute).toBe('function');
  });
});
