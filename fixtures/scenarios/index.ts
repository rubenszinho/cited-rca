import type { Scenario } from '../synth/spec.ts';
import { DEPLOY_SCENARIOS } from './deploy.ts';

/** Every case, in id order. The order is the eval order. */
export const SCENARIOS: Scenario[] = [...DEPLOY_SCENARIOS].sort((a, b) =>
  a.id.localeCompare(b.id),
);
