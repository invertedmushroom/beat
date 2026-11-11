import type { Ruleset } from '../../engine/protocol';
import { createDefaultRuleset } from '../../engine/defaultRules';
import { arenaPreviewHtml, configurationHtml } from './configurationView';
import { EXPERIMENTS, applyExperiment } from './experiments';
import { mechanicsPresetsHtml } from './sections/mechanics';
import { ABILITY_CARDS, MATCH_KITS, MUTATOR_CHIPS, compileKit, createKitSelection, type KitSelection } from './kits';

export function kitsHtml(): string {
  return `
    <p class="kit-intro">Pick a match or experiment, then swap abilities, movement, or modifiers below.</p>
    <div class="library-filters" role="group" aria-label="Library categories">
      <button type="button" class="button" data-library-group="matches" aria-pressed="true">Matches</button>
      <button type="button" class="button" data-library-group="experiments" aria-pressed="false">Experiments</button>
    </div>
    <div class="kit-matches" data-library-content="matches" role="group" aria-label="Match kits">
      ${MATCH_KITS.map((kit) => `<button type="button" class="kit-match" data-kit-match="${kit.id}" aria-pressed="false">
        ${arenaPreviewHtml(compileKit(createKitSelection(kit.id)))}<strong>${kit.name}</strong><span>${kit.description}</span><small>${kit.detail}</small>
      </button>`).join('')}
    </div>
    <div class="kit-matches" data-library-content="experiments" role="group" aria-label="Mechanics experiments" hidden>
      ${EXPERIMENTS.filter((entry) => entry.kind === 'Complete rules').map((entry) => `<button type="button" class="kit-match" data-experiment="${entry.id}" aria-pressed="false">
        ${arenaPreviewHtml(applyExperiment(createDefaultRuleset(), entry.id))}<strong>${entry.name}</strong><span>${entry.description}</span><small>${entry.detail}</small>
      </button>`).join('')}
    </div>
    <section class="current-configuration" aria-label="Current configuration">
      <h2>Current configuration</h2><div id="kit-current"></div>
    </section>
    <p id="kit-status" class="kit-status" role="status" aria-live="polite"></p>
    <section id="kit-mechanics" class="mechanic-packages" aria-label="Add mechanics"></section>
    <fieldset id="kit-options" class="kit-options">
      <legend>Match modifiers</legend>
      <div class="kit-chips">
        ${MUTATOR_CHIPS.map((chip) => `<label class="kit-chip"><input type="checkbox" data-kit-mutator="${chip.id}" /><span><strong>${chip.name}</strong><small>${chip.description}</small></span></label>`).join('')}
      </div>
      <label id="kit-bouncy-label" class="kit-chip" hidden><input id="kit-bouncy" type="checkbox" data-kit-bouncy />
        <span><strong>Bouncy Relic</strong><small>Lighter ball, lively rebounds. Push it with your body.</small></span>
      </label>
      <details class="kit-swaps"><summary>Swap ability cards</summary>
        <div class="kit-deck">
          ${[0, 1, 2, 3].map((slot) => `<article class="kit-ability">
            <label class="field"><span>Ability ${slot + 1}</span><select id="kit-slot-${slot}" data-kit-slot="${slot}">${ABILITY_CARDS.map((card) => `<option value="${card.id}">${card.name} · ${card.tag}</option>`).join('')}</select></label>
          </article>`).join('')}
        </div>
      </details>
    </fieldset>
    <div class="kit-play">
      <button type="button" class="button button--primary" data-kit-start="solo">Play solo</button>
      <button type="button" class="button" data-kit-start="host">Host room</button>
      <button type="button" class="button" data-kit-customize="advanced">Customize / JSON</button>
    </div>
    <p class="kit-footnote">Swaps and chips apply to the whole room. Solo is a practice arena; invite a friend to compete.</p>`;
}

export function syncKitControls(root: HTMLElement, selection: KitSelection | undefined, rules: Ruleset): void {
  const status = root.querySelector<HTMLElement>('#kit-status');
  if (!status) return;
  status.textContent = selection
    ? `${rules.name} ready · ${rules.loadout.abilityIds.map((id) => rules.abilities.find((ability) => ability.id === id)?.name).join(' / ')}`
    : 'Custom rules are kept and shown above. Movement and mechanic packages remain editable. Ability swaps and match modifiers are disabled to preserve your edits; choose a match or experiment card to replace them.';
  const current = root.querySelector<HTMLElement>('#kit-current');
  if (current) current.innerHTML = configurationHtml(rules);
  const mechanics = root.querySelector<HTMLElement>('#kit-mechanics');
  if (mechanics) mechanics.innerHTML = mechanicsPresetsHtml(rules);
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-kit-match]')) {
    button.setAttribute('aria-pressed', String(!selection?.experiment && button.dataset.kitMatch === selection?.match));
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-experiment]')) {
    const id = button.dataset.experiment ?? '';
    const pressed = selection ? (selection.experiment === id || Boolean(selection.addons?.includes(id as never))) : false;
    button.setAttribute('aria-pressed', String(pressed));
  }
  const options = root.querySelector<HTMLFieldSetElement>('#kit-options');
  if (options) {
    options.disabled = !selection;
  }
  syncChipControls(root, selection);
  syncRelicVariant(root, selection, rules);
  syncAbilitySlots(root, rules);
  root.closest('.workbench-layout')?.classList.toggle('is-kit-view', !root.hidden);
}

function syncAbilitySlots(root: HTMLElement, rules: Ruleset): void {
  for (let slot = 0; slot < 4; slot++) {
    const select = root.querySelector<HTMLSelectElement>(`#kit-slot-${slot}`);
    if (select) select.value = rules.loadout.abilityIds[slot] ?? '';
  }
}

function syncChipControls(root: HTMLElement, selection: KitSelection | undefined): void {
  for (const input of root.querySelectorAll<HTMLInputElement>('[data-kit-mutator]')) {
    input.checked = selection?.mutators.some((id) => id === input.dataset.kitMutator) ?? false;
  }
}

function syncRelicVariant(root: HTMLElement, selection: KitSelection | undefined, rules: Ruleset): void {
  const hasRelic = rules.objectives[0]?.kind === 'relicPush';
  const bouncyLabel = root.querySelector<HTMLElement>('#kit-bouncy-label');
  if (bouncyLabel) bouncyLabel.hidden = !hasRelic;
  const bouncy = root.querySelector<HTMLInputElement>('#kit-bouncy');
  if (bouncy) bouncy.checked = Boolean(hasRelic && selection?.bouncyRelic);
}

export function selectLibraryGroup(root: HTMLElement, group: string): void {
  if (group !== 'matches' && group !== 'experiments') return;
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-library-group]')) {
    button.setAttribute('aria-pressed', String(button.dataset.libraryGroup === group));
  }
  for (const section of root.querySelectorAll<HTMLElement>('[data-library-content]')) {
    section.hidden = section.dataset.libraryContent !== group;
  }
}

export function kitSelectionFromControl(current: KitSelection, target: HTMLInputElement | HTMLSelectElement): KitSelection | undefined {
  const next = structuredClone(current);
  if (target.dataset.kitSlot !== undefined) return selectionWithAbility(next, target);
  if (!(target instanceof HTMLInputElement)) return undefined;
  if (target.hasAttribute('data-kit-bouncy')) {
    next.bouncyRelic = target.checked;
    return next;
  }
  const mutator = MUTATOR_CHIPS.find((entry) => entry.id === target.dataset.kitMutator);
  if (!mutator) return undefined;
  next.mutators = next.mutators.filter((id) => id !== mutator.id);
  if (target.checked) next.mutators.push(mutator.id);
  return next;
}

function selectionWithAbility(next: KitSelection, target: HTMLInputElement | HTMLSelectElement): KitSelection | undefined {
  const slot = Number(target.dataset.kitSlot);
  const card = ABILITY_CARDS.find((entry) => entry.id === target.value);
  if (!card || !Number.isInteger(slot) || slot < 0 || slot > 3) return undefined;
  next.abilities[slot] = card.id;
  return next;
}
