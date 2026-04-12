/**
 * @file Budget guard extension for the Pi agent.
 *
 * Monitors cost and turn count during agent execution and aborts the session
 * when configured limits are exceeded.
 */

import type { CoreAdapter } from '../types';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

export interface BudgetLimits {
  maxCost?: number;
  maxTurns?: number;
}

export function createBudgetGuardFactory(core: CoreAdapter, limits: BudgetLimits) {
  return (pi: ExtensionAPI) => {
    let turnCount = 0;
    let totalCost = 0;
    let aborted = false;

    if (!limits.maxCost && !limits.maxTurns) {
      return;
    }

    core.info(
      `💰 Budget guard active:${limits.maxCost ? ` max cost $${limits.maxCost}` : ''}${limits.maxTurns ? ` max turns ${limits.maxTurns}` : ''}`
    );

    pi.on('message_end', async (event, ctx) => {
      if (aborted) return;

      // Track cost from assistant message usage (same as session stats)
      const msg = event.message as any;
      if (msg?.usage?.cost?.total !== undefined) {
        totalCost += msg.usage.cost.total;
      }

      if (limits.maxCost && totalCost >= limits.maxCost) {
        aborted = true;
        core.warning(
          `⛔ Cost limit reached ($${totalCost.toFixed(4)} >= $${limits.maxCost}). Aborting session.`
        );
        ctx.abort();
      }
    });

    pi.on('turn_end', async (_event, ctx) => {
      if (aborted) return;
      turnCount++;

      core.debug(`📊 Turn ${turnCount} complete. Cost so far: $${totalCost.toFixed(4)}`);

      if (limits.maxTurns && turnCount >= limits.maxTurns) {
        aborted = true;
        core.warning(
          `⛔ Turn limit reached (${turnCount}/${limits.maxTurns}). Aborting session.`
        );
        ctx.abort();
      }
    });
  };
}
