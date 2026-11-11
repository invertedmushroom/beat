---
name: concept-article
description: >-
  Explain technical ideas as a self-contained, scrolling HTML article that
  integrates prose, annotated code, mathematics, scientific figures, and evidence.
  Use when the user requests a technical article, visual essay, or long-form
  interactive explanation rather than slides.
---

# Concept Article

Build one `.html` article for a technically capable reader. **Reduce cognitive load, not technical depth.** A coherent section is the unit of explanation. Let its height follow the argument. Connect several concepts or fields when the explanation needs them.

## Workflow

1. **Ground the argument.** Establish the reader's background, central question, and what the reader should be able to predict. Inspect the implementation or primary sources behind consequential claims. For repository explanations, use the terms in `docs/architecture.md` or the code and applicable constraints in `docs/invariants.md`. Cite verified `file.ext:line::symbol` identifiers beside code-grounded claims. For research, link to sources beside the claims they support. Label unavailable evidence and illustrative assumptions explicitly.
   *Done:* Every load-bearing claim has evidence or a named assumption, and the prerequisite chain is clear.

2. **Build a continuous explanation.** Organize sections around questions that advance one argument. Introduce prerequisites at their first use. Interleave prose with the equation, annotated code, figure, or experiment that resolves the current question. Explain each transition between fields rather than collecting disconnected mini-lessons.
   - Orient with a concrete problem and a prediction goal.
   - Develop the mechanism through worked examples and causal reasoning.
   - Connect notation, code variables, visual encodings, and evidence explicitly.
   - State assumptions, invariants, uncertainty, and a consequential failure case.
   - End with synthesis and a prediction that tests transfer.
   *Done:* The reader can follow the argument without interaction, and every figure answers a nearby question.

3. **Build the article.** Copy [assets/article.html](assets/article.html) to the requested output path and replace its illustrative lesson, including its example-specific simulation. Keep all CSS, JavaScript, figures, fonts, and mathematical rendering local to the file. Source hyperlinks may point outside the file. Use system fonts, inline SVG, and native MathML or embedded equation SVGs. Give equations a readable textual interpretation.
   Preserve natural document scrolling, semantic sections, section anchors, responsive figures, and print behavior. Use paragraphs as the default. Reserve side-by-side layouts and callouts for comparisons that benefit from them. Keep browser scrolling and keyboard shortcuts native. Use animation only when it explains change, with reduced-motion support and a static alternative.
   *Done:* The output is one offline-readable HTML file with no slide navigation, viewport locking, style-selection flow, or external runtime dependencies.

4. **Verify and deliver.** Run the checks below against the emitted article. Repair failures and repeat the affected checks. Inspect screenshots at desktop and narrow widths for prose, equations, figure labels, and code. Deliver the article link with a short description of its explanatory thread. Report any browser or evidence checks that could not run.
   *Done:* The layout, interaction, offline, and print checks pass, and the conclusion stays within what the evidence establishes.

## Figures, mathematics, and evidence

- **Choose the visual form for the claim.** Use plots, scatter distributions, matrices, geometric constructions, timelines, state traces, or architecture diagrams as appropriate. For scientific plots, label axes, units, scales, and legends. Explain normalization, uncertainty, and the source of the data. A schematic must say that it is schematic.
- **Keep representations aligned.** Use the same symbols in prose, equations, code, and figures. Define notation before using it. Distinguish a mathematical model from its numerical approximation and from a physical or runtime implementation.
- **Separate kinds of evidence.** Label measured results, reproduced results, synthetic simulations, theoretical predictions, and illustrative values. Include the relevant setup, baseline, sample size, and limitations. One successful trace does not establish a general claim. When an experiment cannot run, present it as a proposed experiment rather than inventing results.
- **Use diagram guidance selectively.** For architecture and state diagrams, read the typography, box math, routing, and layer-order references in [diagram-design](../diagram-design/SKILL.md). Scientific curves and data marks use their domain's coordinate system, not orthogonal connector rules. Mark those SVG elements `data-geometry="decoration"` so the shared checker does not mistake them for architecture connectors. Use this annotation for actual plot marks, not to bypass an invalid diagram.
- **Make figures legible.** Give every SVG a `viewBox`, `<title>`, and `<desc>`. Preserve readable labels at narrow widths by simplifying, reflowing, or separating figures rather than shrinking an entire desktop composition. Pair color with labels or line styles.

## Meaningful interaction

The asset demonstrates three enhancements:

- **A parameter experiment** changes one input and updates the nearby plot and textual result together. State what is fixed, what changes, and what the result can establish.
- **Symbol linking** uses matching `data-sym` values in code, prose, or SVG. Keyboard focus and pointer hover highlight the matching representations.
- **A prediction reveal** uses `.reveal-button`, `aria-controls`, and a `[data-answer]` element. The answer remains readable without JavaScript and in print.

Keep the argument and an informative default figure in the static HTML. Hide enhancement controls until their handlers are ready. Keep essential caveats visible rather than behind a reveal. Interactions must work by keyboard and must not require hover, animation, or autoplay. When adding a control, adapt its verification checks rather than assuming the sample experiment covers it.

## Verification

Use the existing browser tools or the project's browser test runner. Verify the article itself, not just its template or a DOM snapshot.

| Surface | Required check |
| :--- | :--- |
| Scrolling and layout | At desktop, 390px, and 320px widths, the document has no horizontal overflow. Sections remain in document flow and can extend beyond one viewport. Long code or tables may scroll inside labeled, keyboard-focusable containers. Check at 200% zoom or equivalent text enlargement. |
| Figures and equations | Labels are readable and do not overlap or clip. Plot marks match their stated data, scales, and mathematical relationships. Equations have textual interpretations. |
| Controls | Exercise every control, parameter extrema, and meaningful combinations. Assert the resulting numbers and visual states against the mechanism. Check keyboard operation, accessible names, and focus visibility. |
| Offline and static | With network access blocked, there are no failed asset requests. With JavaScript disabled, the full explanation, useful default figures, caveats, and answers remain readable. |
| Motion and print | With reduced motion enabled, no essential information depends on animation. In print, controls disappear while prose, figures, answers, and dynamically displayed results remain readable. |
| Evidence | Check source links and the scope of each claim. Report unexecuted experiments and unchecked branches explicitly. |

For SVG geometry, run the shared checker using its resolved path:

```text
python <skill-directory>/../diagram-design/scripts/verify-geometry.py <output.html>
```

The [geometry checker](../diagram-design/scripts/verify-geometry.py) checks rectangle grid alignment, foreground rectangle collisions, and supported connector geometry. Plot marks annotated as decoration are outside its connector checks. A pass does not verify scientific correctness, axis semantics, text fit, accessibility, or the article's argument. Check those separately.

## Package boundaries

`assets/article.html` owns the reusable scrolling shell and its illustrative experiment. This file owns teaching, evidence, and completion rules. `agents/openai.yaml` owns host-specific UI metadata. The diagram skill and its checker are local package dependencies. Preserve those relative paths when distributing the skill bundle.
