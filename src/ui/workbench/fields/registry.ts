import type { WorkbenchTab } from '../state';
import type { WorkbenchField, WorkbenchFieldKind } from '../fieldTypes';
import { ABILITY_FIELDS } from './abilities';
import { MATCH_FIELDS } from './match';
import { MECHANIC_FIELDS } from './mechanics';
import { NPC_FIELDS } from './npcs';
import { PLAYER_FIELDS } from './player';

export const WORKBENCH_FIELDS: WorkbenchField[] = [
  ...MATCH_FIELDS,
  ...PLAYER_FIELDS,
  ...ABILITY_FIELDS,
  ...MECHANIC_FIELDS,
  ...NPC_FIELDS,
];

const FIELDS_BY_KIND = new Map<string, WorkbenchField>(
  WORKBENCH_FIELDS.map((field) => [`${field.kind}:${field.id}`, field]),
);

export function workbenchFieldsForSection(section: WorkbenchTab, kind?: WorkbenchFieldKind): WorkbenchField[] {
  return WORKBENCH_FIELDS.filter((field) => field.section === section && (!kind || field.kind === kind));
}

export function workbenchField(kind: WorkbenchFieldKind, fieldId: string): WorkbenchField | undefined {
  return FIELDS_BY_KIND.get(`${kind}:${fieldId}`);
}
