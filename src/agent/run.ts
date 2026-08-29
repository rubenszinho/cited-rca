/**
 * Entry point for `task project:agent`.
 *
 * The workflow itself lives in solve.ts so it can be exercised against a stub
 * client in tests without going near a provider.
 */
import { runVariant } from '../runner.ts';
import { solveWithAgent } from './solve.ts';

await runVariant(solveWithAgent);
