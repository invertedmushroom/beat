import type { Ruleset } from './protocol';
import { sha256Hex } from '../utils/hash';
import { stableJson } from '../utils/stableJson';

export function rulesetFingerprint(ruleset: Ruleset): string {
  return stableJson(ruleset);
}

export function hashRuleset(ruleset: Ruleset): Promise<string> {
  return sha256Hex(rulesetFingerprint(ruleset));
}

