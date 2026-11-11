import { WORKBENCH_TABS, type WorkbenchTab } from './state';
import { workbenchFieldsForSection, type WorkbenchField } from './fields';
import { escapeHtml } from './inspector';
import { kitsHtml } from './kitsView';
import { movementPackagesHtml } from './movementView';

export function workbenchHtml(): string {
  return `
      <section id="workbench-view" class="workbench-view" hidden>
        <header class="workbench-header">
          <div>
            <h1>Workbench</h1>
            <div id="rules-hash-line" class="rules-hash">rules hash</div>
            <div id="rules-validation-line" class="rules-validation" role="status" aria-live="polite">validating</div>
          </div>
          <div class="workbench-actions">
            <button id="apply-rules" class="button button--primary" type="button">Apply</button>
            <button id="copy-rules" class="button" type="button">Copy</button>
            <button id="reset-rules" class="button button--danger" type="button">Reset</button>
            <button id="workbench-back-menu" class="button" type="button">Menu</button>
          </div>
        </header>
        <div id="workbench-tabs" class="workbench-tabs" role="tablist" aria-label="Workbench panels">
          ${WORKBENCH_TABS.map((tab) => tabButtonHtml(tab.id, tab.label)).join('')}
        </div>
        <div class="workbench-layout">
          <div id="workbench-panels" class="workbench-panels">
            ${panelHtml('kits', 'Match & experiment library', kitsHtml())}
            ${matchPanelHtml()}
            ${playerPanelHtml()}
            ${abilitiesPanelHtml()}
            ${mechanicsPanelHtml()}
            ${npcsPanelHtml()}
            ${preferencesPanelHtml()}
            ${advancedPanelHtml()}
          </div>
          <aside class="rules-panel workbench-inspector-panel">
            <div id="workbench-diagnostics" class="workbench-diagnostics" role="status" aria-live="polite"></div>
            <div id="rules-inspector" class="rules-inspector"></div>
          </aside>
        </div>
      </section>
  `;
}

function tabButtonHtml(id: WorkbenchTab, label: string): string {
  return `<button id="workbench-tab-${id}" class="workbench-tab" type="button" role="tab" data-workbench-tab="${id}" aria-controls="workbench-panel-${id}" aria-selected="false" tabindex="-1">${escapeHtml(label)}</button>`;
}

function panelHtml(tab: WorkbenchTab, title: string, body: string): string {
  return `
            <section id="workbench-panel-${tab}" class="workbench-panel" data-workbench-panel="${tab}" role="tabpanel" aria-labelledby="workbench-tab-${tab}" hidden>
              <h2>${escapeHtml(title)}</h2>
              ${body}
            </section>
  `;
}

function matchPanelHtml(): string {
  return panelHtml(
    'match',
    'Game Type / Match / Objectives',
    `
              <div class="workbench-grid">
                ${fieldsHtml('match')}
                <label class="field"><span>Respawn mode</span><input id="workbench-respawn-mode" value="Timed" data-workbench-path="match.respawnMode" disabled /></label>
              </div>
              <div id="workbench-match-objectives" class="workbench-chain" aria-live="polite"></div>
    `,
  );
}

function playerPanelHtml(): string {
  return panelHtml('player', 'Player & movement', `${movementPackagesHtml()}<h3>Fine-tune player values</h3><div class="workbench-grid">${fieldsHtml('player')}</div>`);
}

function abilitiesPanelHtml(): string {
  return panelHtml(
    'abilities',
    'Abilities',
    `
              <label class="field"><span>Edit ability</span><select id="workbench-ability-select" data-ability-select="true"></select></label>
              <div id="workbench-ability-inspector"></div>
              <h3>Fine-tune ability values</h3>
              <div class="workbench-grid">
                ${fieldsHtml('abilities')}
              </div>
              <div id="workbench-ability-effects" class="workbench-chain" aria-live="polite"></div>
    `,
  );
}

function mechanicsPanelHtml(): string {
  return panelHtml(
    'mechanics',
    'Mechanics',
    `
              <div id="workbench-mechanics-presets" class="workbench-chain__section"></div>
              <div class="workbench-chain__section">
                <div class="workbench-chain__toolbar">
                  <h3>Triggers</h3>
                  <div class="workbench-mini-actions">
                    <button id="workbench-add-trigger" class="button button--mini" type="button" data-trigger-command="add">Add trigger</button>
                    <button id="workbench-remove-trigger" class="button button--mini button--danger" type="button" data-trigger-command="remove">Remove trigger</button>
                  </div>
                </div>
                <div id="workbench-trigger-fields" class="workbench-grid">
                  <label class="field"><span>Edit trigger</span><select id="workbench-trigger-select" data-trigger-select="true"></select></label>
                  ${fieldsHtml('mechanics')}
                </div>
              </div>
              <div id="workbench-mechanics-chain" class="workbench-chain" aria-live="polite"></div>
              <div id="workbench-mechanics-flow" class="mechanics-flow"></div>
    `,
  );
}

function npcsPanelHtml(): string {
  return panelHtml(
    'npcs',
    'NPCs',
    `
              <div class="workbench-grid">
                <label class="field"><span>Edit NPC</span><select id="workbench-npc-select" data-npc-select="true"></select></label>
                ${fieldsHtml('npcs')}
              </div>
    `,
  );
}

function preferencesPanelHtml(): string {
  return panelHtml(
    'preferences',
    'Local Preferences',
    `
              <div class="workbench-grid">
                <label class="field"><span>HUD scale</span><input id="pref-hud-scale" data-pref-field="hudScale" type="number" min="0.75" max="1.35" step="0.05" /></label>
                <label class="field"><span>HUD density</span><select id="pref-hud-density" data-pref-field="hudDensity"><option value="detailed">Detailed</option><option value="compact">Compact</option></select></label>
                <label class="field"><span>Skill bar</span><select id="pref-skill-position" data-pref-field="skillBarPosition"><option value="bottom">Bottom</option><option value="left">Left</option><option value="right">Right</option></select></label>
                <label class="field"><span>Touch layout</span><select id="pref-touch-handedness" data-pref-field="touchHandedness"><option value="right">Right handed</option><option value="left">Left handed</option></select></label>
                <label class="field"><span>Touch scale</span><input id="pref-touch-scale" data-pref-field="touchScale" type="number" min="0.75" max="1.35" step="0.05" /></label>
                <label class="field"><span>Touch opacity</span><input id="pref-touch-opacity" data-pref-field="touchOpacity" type="number" min="0.25" max="1" step="0.05" /></label>
                <label class="field field--inline"><input id="pref-trace-open" data-pref-field="traceDefaultOpen" type="checkbox" /><span>Open trace by default</span></label>
              </div>
    `,
  );
}

function advancedPanelHtml(): string {
  return panelHtml('advanced', 'Advanced JSON', '<textarea id="rules-json" class="rules-json" spellcheck="false"></textarea>');
}

function fieldsHtml(section: WorkbenchTab): string {
  return workbenchFieldsForSection(section).map(fieldHtml).join('');
}

function fieldHtml(field: WorkbenchField): string {
  const dataAttribute = fieldDataAttribute(field);
  const fieldData = [
    `data-workbench-field="${escapeHtml(`${field.kind}:${field.id}`)}"`,
    field.visibleWhen ? `data-visible-when="${escapeHtml(`${field.visibleWhen.fieldId}:${field.visibleWhen.equals}`)}"` : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  const attrs = [
    `id="${field.controlId}"`,
    `${dataAttribute}="${escapeHtml(field.id)}"`,
    `data-workbench-path="${escapeHtml(field.path)}"`,
    field.input === 'checkbox' ? 'type="checkbox"' : undefined,
    field.input === 'number' ? 'type="number"' : undefined,
    field.input === 'color' ? 'type="color"' : undefined,
    field.min === undefined ? undefined : `min="${field.min}"`,
    field.max === undefined ? undefined : `max="${field.max}"`,
    field.step === undefined ? undefined : `step="${field.step}"`,
    field.maxLength === undefined ? undefined : `maxlength="${field.maxLength}"`,
  ]
    .filter(Boolean)
    .join(' ');

  if (field.input === 'checkbox') {
    return `<label class="field field--inline" ${fieldData}><input ${attrs} /><span>${escapeHtml(field.label)}</span></label>`;
  }
  if (field.input === 'select') {
    return `<label class="field" ${fieldData}><span>${escapeHtml(field.label)}</span><select ${attrs}>${(field.options ?? [])
      .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
      .join('')}</select></label>`;
  }
  return `<label class="field" ${fieldData}><span>${escapeHtml(field.label)}</span><input ${attrs} /></label>`;
}

function fieldDataAttribute(field: WorkbenchField): string {
  if (field.kind === 'rules') {
    return 'data-rules-field';
  }
  if (field.kind === 'ability') {
    return 'data-ability-field';
  }
  if (field.kind === 'trigger') {
    return 'data-trigger-field';
  }
  if (field.kind === 'npc') {
    return 'data-npc-field';
  }
  return 'data-rules-field';
}
