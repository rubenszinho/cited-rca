/**
 * Entry point for `task project:baseline`.
 */
import { runVariant } from '../runner.ts';
import { solveWithBaseline } from './solve.ts';

await runVariant(solveWithBaseline);
