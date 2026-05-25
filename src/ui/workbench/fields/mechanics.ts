import type { WorkbenchField } from '../fieldTypes';

export const MECHANIC_FIELDS: WorkbenchField[] = [
  {
    id: 'name',
    label: 'Trigger name',
    section: 'mechanics',
    kind: 'trigger',
    path: 'mechanics.triggers[selected].name',
    controlId: 'workbench-trigger-name',
    input: 'text',
    maxLength: 48,
  },
  {
    id: 'event',
    label: 'Event',
    section: 'mechanics',
    kind: 'trigger',
    path: 'mechanics.triggers[selected].event',
    controlId: 'workbench-trigger-event',
    input: 'select',
    options: [
      { value: 'onCast', label: 'onCast' },
      { value: 'onHit', label: 'onHit' },
      { value: 'onDamageTaken', label: 'onDamageTaken' },
      { value: 'onStatusApplied', label: 'onStatusApplied' },
      { value: 'onStatusExpired', label: 'onStatusExpired' },
      { value: 'onKill', label: 'onKill' },
      { value: 'onLowHp', label: 'onLowHp' },
      { value: 'onObjectiveEnter', label: 'onObjectiveEnter' },
      { value: 'onObjectiveTick', label: 'onObjectiveTick' },
      { value: 'onScore', label: 'onScore' },
    ],
  },
];
