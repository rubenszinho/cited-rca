import type { Scenario } from '../synth/spec.ts';
import { DEPLOY_SCENARIOS } from './deploy.ts';
import { EXTERNAL_SCENARIOS } from './external.ts';
import { RESOURCE_SCENARIOS } from './resource.ts';

/** Every case, in id order. The order is the eval order. */
export const SCENARIOS: Scenario[] = [
  ...DEPLOY_SCENARIOS,
  ...RESOURCE_SCENARIOS,
  ...EXTERNAL_SCENARIOS,
].sort((a, b) => a.id.localeCompare(b.id));
