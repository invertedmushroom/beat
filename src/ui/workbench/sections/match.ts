import type { Ruleset } from '../../../engine/protocol';
import { escapeHtml } from '../inspector';
import type { WorkbenchState } from '../state';
import {
  checkboxField,
  colorField,
  fieldsHtml,
  numberField,
  optionsHtml,
  scoreZoneOptions,
  sectionShell,
  selectField,
  teamOptions,
  textField,
} from './controls';

export function matchGameTypeLabel(ruleset: Ruleset): string {
  if (ruleset.objectives.length === 0) {
    return 'No objective scoring';
  }
  if (ruleset.objectives.some((objective) => objective.kind !== 'relicPush')) {
    return 'Custom objective rules';
  }
  if (ruleset.objectives.length !== 1) {
    return 'Custom Relic Push';
  }
  const objective = ruleset.objectives[0];
  const teamIds = new Set(ruleset.match.teams.map((team) => team.id));
  const zoneTeams = objective?.scoreZones.map((zone) => zone.team) ?? [];
  const hasOneZonePerTeam = zoneTeams.length === teamIds.size && zoneTeams.every((team) => teamIds.has(team)) && new Set(zoneTeams).size === zoneTeams.length;
  return hasOneZonePerTeam ? 'Relic Push' : 'Custom Relic Push';
}

export function matchObjectivesHtml(ruleset: Ruleset, state: WorkbenchState): string {
  const team = selectedTeam(ruleset, state.selectedTeamId);
  const objective = selectedObjective(ruleset, state.selectedObjectiveId);
  const zone = objective ? selectedScoreZone(objective, state.selectedScoreZoneId) : undefined;
  return [
    sectionShell(
      'Game Type',
      `
        <div class="workbench-summary">
          <strong>${escapeHtml(matchGameTypeLabel(ruleset))}</strong>
          <span>${escapeHtml(matchGameTypeDetail(ruleset))}</span>
        </div>
      `,
    ),
    sectionShell(
      'Teams',
      `
        <div class="workbench-grid workbench-grid--chain">
          <label class="field"><span>Edit team</span><select id="workbench-team-select" data-team-select="true" data-workbench-path="match.teams">${optionsHtml(
            teamOptions(ruleset),
            team?.id ?? '',
          )}</select></label>
          ${team ? teamFieldsHtml(team) : '<div class="workbench-chain__empty">No teams</div>'}
        </div>
      `,
    ),
    sectionShell(
      'Objectives',
      objective
        ? `
          <div class="workbench-grid workbench-grid--chain">
            <label class="field"><span>Edit objective</span><select id="workbench-objective-select" data-objective-select="true" data-workbench-path="objectives">${optionsHtml(
              objectiveOptions(ruleset),
              objective.id,
            )}</select></label>
            ${objectiveFieldsHtml(objective)}
          </div>
          <div class="workbench-chain__group">
            <div class="workbench-chain__toolbar">
              <h3>Score Zones</h3>
              <div class="workbench-mini-actions">
                <button id="workbench-add-score-zone" class="button button--mini" type="button" data-score-zone-command="add">Add zone</button>
                <button id="workbench-duplicate-score-zone" class="button button--mini" type="button" data-score-zone-command="duplicate" data-score-zone-id="${escapeHtml(
                  zone?.id ?? '',
                )}"${zone ? '' : ' disabled'}>Duplicate</button>
                <button id="workbench-remove-score-zone" class="button button--mini button--danger" type="button" data-score-zone-command="remove" data-score-zone-id="${escapeHtml(
                  zone?.id ?? '',
                )}"${objective.scoreZones.length <= 1 || !zone ? ' disabled' : ''}>Remove</button>
              </div>
            </div>
            <div class="workbench-grid workbench-grid--chain">
              <label class="field"><span>Edit zone</span><select id="workbench-score-zone-select" data-score-zone-select="true" data-workbench-path="objectives[${escapeHtml(
                objective.id,
              )}].scoreZones">${optionsHtml(scoreZoneOptions(objective), zone?.id ?? '')}</select></label>
              ${zone ? scoreZoneFieldsHtml(ruleset, objective, zone) : '<div class="workbench-chain__empty">No score zones</div>'}
            </div>
          </div>
        `
        : '<div class="workbench-chain__empty">No objective scoring</div>',
    ),
  ].join('');
}

function teamFieldsHtml(team: Ruleset['match']['teams'][number]): string {
  const path = (fieldId: string) => `match.teams[${team.id}].${fieldId}`;
  return fieldsHtml([
    textField('team', 0, 'name', 'Team name', team.name, path('name')),
    colorField('team', 0, 'color', 'Team color', team.color, path('color')),
  ]);
}

function objectiveFieldsHtml(objective: Ruleset['objectives'][number]): string {
  const path = (fieldId: string) => `objectives[${objective.id}].${fieldId}`;
  return fieldsHtml([
    textField('objective', 0, 'name', 'Objective name', objective.name, path('name')),
    numberField('objective', 0, 'spawn.x', 'Spawn X', objective.spawn.x, path('spawn.x'), -200, 200, 0.1),
    numberField('objective', 0, 'spawn.y', 'Spawn Y', objective.spawn.y, path('spawn.y'), -200, 200, 0.1),
    numberField('objective', 0, 'body.radius', 'Body radius', objective.body.radius, path('body.radius'), 0.05, 5, 0.05),
    numberField('objective', 0, 'body.mass', 'Body mass', objective.body.mass, path('body.mass'), 0.05, 200, 0.05),
    colorField('objective', 0, 'body.color', 'Body color', objective.body.color, path('body.color')),
    numberField('objective', 0, 'scoreCooldownTicks', 'Score cooldown', objective.scoreCooldownTicks, path('scoreCooldownTicks'), 0, 1200, 1),
    checkboxField('objective', 0, 'resetOnScore', 'Reset on score', objective.resetOnScore, path('resetOnScore')),
  ]);
}

function scoreZoneFieldsHtml(
  ruleset: Ruleset,
  objective: Ruleset['objectives'][number],
  zone: Ruleset['objectives'][number]['scoreZones'][number],
): string {
  const path = (fieldId: string) => `objectives[${objective.id}].scoreZones[${zone.id}].${fieldId}`;
  const team = ruleset.match.teams.find((candidate) => candidate.id === zone.team);
  return fieldsHtml([
    selectField('scoreZone', 0, 'team', 'Scoring team', zone.team, path('team'), teamOptions(ruleset)),
    numberField('scoreZone', 0, 'x', 'Zone X', zone.x, path('x'), -200, 200, 0.1),
    numberField('scoreZone', 0, 'y', 'Zone Y', zone.y, path('y'), -200, 200, 0.1),
    numberField('scoreZone', 0, 'radius', 'Zone radius', zone.radius, path('radius'), 0.2, 30, 0.05),
    numberField('scoreZone', 0, 'points', 'Points', zone.points, path('points'), 1, 100, 1),
    colorField('scoreZone', 0, 'color', 'Zone color', zone.color ?? team?.color ?? '#ffffff', path('color')),
  ]);
}

function objectiveOptions(ruleset: Ruleset) {
  return ruleset.objectives.map((objective) => ({ value: objective.id, label: objective.name }));
}

function selectedTeam(ruleset: Ruleset, teamId: string): Ruleset['match']['teams'][number] | undefined {
  return ruleset.match.teams.find((candidate) => candidate.id === teamId) ?? ruleset.match.teams[0];
}

function selectedObjective(ruleset: Ruleset, objectiveId: string): Ruleset['objectives'][number] | undefined {
  return ruleset.objectives.find((candidate) => candidate.id === objectiveId) ?? ruleset.objectives[0];
}

function selectedScoreZone(
  objective: Ruleset['objectives'][number],
  scoreZoneId: string,
): Ruleset['objectives'][number]['scoreZones'][number] | undefined {
  return objective.scoreZones.find((candidate) => candidate.id === scoreZoneId) ?? objective.scoreZones[0];
}

function matchGameTypeDetail(ruleset: Ruleset): string {
  const objectiveCount = ruleset.objectives.length;
  const zoneCount = ruleset.objectives.reduce((total, objective) => total + objective.scoreZones.length, 0);
  return `${objectiveCount} objectives · ${zoneCount} zones · score ${ruleset.match.scoreLimit}`;
}
