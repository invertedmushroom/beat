import type { WorkbenchField } from '../fieldTypes';

export const MATCH_FIELDS: WorkbenchField[] = [
  { id: 'name', label: 'Name', section: 'match', kind: 'rules', path: 'name', controlId: 'workbench-rule-name', input: 'text', maxLength: 48 },
  {
    id: 'durationSeconds',
    label: 'Duration seconds',
    section: 'match',
    kind: 'rules',
    path: 'match.durationTicks',
    controlId: 'workbench-duration',
    input: 'number',
    min: 1,
    step: 1,
  },
  {
    id: 'scoreLimit',
    label: 'Score limit',
    section: 'match',
    kind: 'rules',
    path: 'match.scoreLimit',
    controlId: 'workbench-score-limit',
    input: 'number',
    min: 1,
    step: 1,
  },
  {
    id: 'friendlyFire',
    label: 'Friendly fire',
    section: 'match',
    kind: 'rules',
    path: 'match.friendlyFire',
    controlId: 'workbench-friendly-fire',
    input: 'checkbox',
  },
];
