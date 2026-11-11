import { expect, it } from 'vitest';
import { createDefaultRuleset } from '../../engine/defaultRules';
import { abilityInspectorHtml, relatedAbilityTriggers } from './abilityView';

it('filters impossible ability and slot conditions while retaining runtime-dependent triggers', () => {
  const rules = createDefaultRuleset();
  const lance = rules.abilities.find((ability) => ability.id === 'ion-lance')!;
  rules.mechanics.triggers = [
    { id: 'wrong-tag', event: 'onHit', conditions: [{ kind: 'abilityTag', tag: 'frost' }], actions: [] },
    { id: 'wrong-slot', event: 'onCast', conditions: [{ kind: 'slotUsed', slot: 0 }], actions: [] },
    { id: 'right-slot', event: 'onCast', conditions: [{ kind: 'slotUsed', slot: 3 }], actions: [] },
    { id: 'conditional', event: 'onHit', conditions: [{ kind: 'hpBelow', target: 'target', ratio: 0.3 }], actions: [] },
    { id: 'objective-only', event: 'onScore', actions: [] },
  ];
  expect(relatedAbilityTriggers(rules, lance).map((trigger) => trigger.id)).toEqual(['right-slot', 'conditional']);
});

it('derives the ability overview from edited rules, escapes names, and does not mutate rules', () => {
  const rules = createDefaultRuleset();
  const lance = rules.abilities.find((ability) => ability.id === 'ion-lance')!;
  lance.name = '<img src=x onerror=alert(1)>';
  lance.effects = [{ kind: 'selfDash', distance: 4 }];
  rules.tickRate = 60;
  const before = structuredClone(rules);
  const html = abilityInspectorHtml(rules, lance.id);
  expect(html).toContain('4 m · blocked by arena geometry');
  expect(html).toContain('0.50 s'); // 30 charge ticks at 60 Hz.
  expect(html).toContain('&lt;img');
  expect(html).not.toContain('<img');
  expect(rules).toEqual(before);
  expect(abilityInspectorHtml(rules, 'missing')).toBe('');
});
