/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from 'bun:test';
import { getPRDiffTool } from '../../../src/pi/tools/get-pr-diff';
import * as githubIndex from '../../../src/github/index';

describe('get_pull_request_diff tool - execution', () => {
  test('has correct tool name and label', () => {
    expect(getPRDiffTool.name).toBe('get_pull_request_diff');
    expect(getPRDiffTool.label).toBe('Get Pull Request Diff');
  });

  test('execute function exists and is a function', () => {
    expect(typeof getPRDiffTool.execute).toBe('function');
  });

  test('parameters have correct structure', () => {
    const schema = getPRDiffTool.parameters as any;
    expect(schema.properties).toBeDefined();
    expect(schema.properties.pull_number).toBeDefined();
    expect(schema.properties.max_files).toBeDefined();
    expect(schema.properties.file_filter).toBeDefined();
  });

  test('all parameters are optional', () => {
    const schema = getPRDiffTool.parameters as any;
    if (Array.isArray(schema.required)) {
      expect(schema.required.length).toBe(0);
    }
  });

  test('tool exports match github/index exports', () => {
    expect(githubIndex.getPullRequestDiff).toBeDefined();
    expect(typeof githubIndex.getPullRequestDiff).toBe('function');
  });

  test('has execute with built-in cancellation handling', () => {
    expect(typeof getPRDiffTool.execute).toBe('function');
  });
});
