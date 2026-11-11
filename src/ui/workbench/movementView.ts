import type { Ruleset } from '../../engine/protocol';
import { MOVEMENT_CHASSIS } from './kits';

export function movementPackagesHtml(): string {
  return `<section aria-label="Movement packages"><h3>Choose a movement package</h3>
    <p class="kit-intro">A package sets movement speed, damping, turning, and aim. Fine-tune the values below.</p>
    <div class="kit-chassis">${MOVEMENT_CHASSIS.map((entry) => `<label class="kit-chip movement-card">
      <input type="radio" name="movement-package" value="${entry.id}" data-movement-package />
      <span><strong>${entry.name}</strong><small>${entry.description}</small><small>${entry.speed} m/s · Damping ${entry.damping}</small></span>
    </label>`).join('')}</div></section>`;
}

export function syncMovementPackages(root: HTMLElement, rules: Ruleset): void {
  for (const input of root.querySelectorAll<HTMLInputElement>('[data-movement-package]')) {
    const entry = MOVEMENT_CHASSIS.find((candidate) => candidate.id === input.value)!;
    input.checked = rules.player.movement.mode === entry.mode && rules.player.aim.mode === entry.aim &&
      rules.player.speed === entry.speed && rules.player.damping === entry.damping &&
      rules.player.movement.turnSpeedDegrees === 220 && rules.player.movement.reverseMultiplier === 0.6;
  }
}
