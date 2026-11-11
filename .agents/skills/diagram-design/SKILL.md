---
name: diagram-design
description: Diagram software architecture, multi-tier runtime planes, spatial/sharded boundaries, sequence protocols, state machines, data models, bit-packed wire frames, and execution lifecycle span bars as self-contained HTML and inline SVG.
---

Generate editorial, self-contained HTML and inline SVG diagrams from software engineering specifications, codebases, or system flow descriptions.

## Execution steps

1. **Inventory topology and split by node budget.**
   Extract every component, actor, state, data structure, and edge from the source material. Count a contiguous memory strip, bit-packed wire frame, or ring buffer as 1 composite node. When the node count exceeds 9, split the topology into one overview diagram and separate detail diagrams.
   *Completion criterion:* Every source entity is assigned to a diagram, and every diagram contains 9 or fewer nodes.

2. **Select the archetype.**
   Match the topology to one or more archetypes from the **Archetypes** reference. When a system combines distinct layers (such as multi-tier runtimes, spatial/sharded boundaries, and wire-frame data layouts), emit separate zones or separate diagrams per archetype.
   *Completion criterion:* Each planned diagram or zone maps to a single archetype and declares its primary axis (`LR` or `TB`).

3. **Compute the coordinate ledger.**
   Before emitting SVG tags, calculate the exact `width`, `height`, `x`, and `y` on the `4px` grid for every node, zone, and edge label using the **Typography and box math** rules.
   *Completion criterion:* Every node, container, and edge mask has integer coordinates divisible by 4, and zero foreground node bounding boxes overlap.

4. **Route orthogonal connectors.**
   Calculate `<path>` coordinates for every edge using the **Orthogonal routing** rules. Assign port offsets for every node edge that carries more than one connector.
   *Completion criterion:* Every connector consists of horizontal segments, vertical segments, `r=8` quarter-circle elbows, or `r=6` semicircular bridge hops, with zero diagonal segments and at least `12px` clearance between parallel paths.

5. **Emit, mask, and verify.**
   Render the document following the **Layer order** and **Palette and tokens** specifications. Run `python <skill-directory>/scripts/verify-geometry.py <output.html>` using the resolved skill directory. The checker examines every inline SVG for rectangle grid alignment, foreground rectangle collisions, and supported connector geometry. Inspect text fit, connector clearance, and layer order in a browser separately.
   *Completion criterion:* The geometry check passes. Browser inspection confirms readable labels, correct painter's order, and no visual overlap. The output is one HTML file with inline SVGs, a `<title>` and `<desc>` for each SVG, and no external JavaScript.

   **Checker annotations:** Unmarked rectangles are foreground nodes regardless of fill or dash pattern. Mark background containers `data-geometry="zone"`, edge-label masks `data-geometry="mask"`, and intentional overlapping node artwork `data-geometry="decoration"`. A group may assign `data-layer="zones"`, `"edge-masks"`, or `"nodes"` to its descendants. All rectangles still receive grid checks. Marker definitions inside `<defs>` are excluded. Use explicit canvas coordinates; transformed, reused, or nested SVG geometry requires flattening before this checker can validate it. Decorative paths outside `<defs>` need `data-geometry="decoration"`.

---

## Palette and tokens

Declare these exact CSS custom properties on `:root` and reference them via `var(--token)` on every SVG presentation attribute:

- `--paper: #f5f5f5` (canvas background and edge-label mask fill)
- `--ink: #2d3142` (primary node borders, primary text, and reliable/sync connectors)
- `--muted: #6b7080` (secondary sublabels, lifelines, and async/ghost connectors)
- `--soft: #e4e4e2` (zone container fills, partition overlap bands, and table header bands)
- `--accent: #bf4520` (focal coral for primary bottleneck, entry point, exclusive write lock, or critical path)

**Focal budget:** Apply `--accent` to at most 2 focal nodes or 1 critical path per diagram. Render all remaining elements in `--ink`, `--muted`, or `--soft` so that the focal signal stands out immediately. Use flat fills and crisp `1.5px` strokes on all shapes.

---

## Typography and box math

Load `Instrument Serif`, `Geist`, and `Geist Mono` from Google Fonts in the HTML `<head>`. Assign each text element to one tier:

- **Diagram title and editorial callouts:** `Instrument Serif`, `24px`–`26px` regular for titles, `14px` italic for callouts.
- **Node titles and state names:** `Geist`, `13px`–`14px`, `font-weight: 600`, character advance `0.60 * font_size` (`8.4px` per character at `14px`).
- **Technical metadata (ports, types, schema badges, module tags, edge labels, byte widths):** `Geist Mono`, `11px`, `font-weight: 500`, character advance `0.62 * font_size` (`6.82px` per character).

**Box width formula:**
1. Measure `max_chars` (the character count of the longest text line inside the node).
2. Multiply `max_chars` by the tier's character advance.
3. Add horizontal padding (`32px` minimum, representing `16px` per side).
4. Round up to the nearest multiple of `4px`:
   `box_width = ceil((max_chars * advance + 32) / 4) * 4`

**Box height formula:**
- Single-line node: `40px`.
- Two-line node (title + mono sublabel): `56px`.
- Three-line node: `72px`.
- Four-line node: `96px`.
- Entity or schema table: `36px` header band + `24px`–`28px` per row.

**Deletion rule:** When two nodes always travel together with a single 1:1 arrow between them, merge them into one multi-line node (primary title in `Geist` + technical sublabel in `Geist Mono`). When spatial containment inside a zone `<rect>` already communicates membership, omit connectors between the zone and its children.

---

## Orthogonal routing

1. **Axis alignment:** When two connected ports share `x` or `y`, emit a straight `<path d="M x1 y1 L x2 y2"/>`.
2. **Quarter-arc elbows:** When two connected ports differ in both `x` and `y`, route via orthogonal segments joined by a quarter-circle arc of radius `8px` (`A 8 8 0 0 1` or `A 8 8 0 0 0` matching the turn direction).
3. **Fan port distribution:** When `N` connectors attach to a node edge of length `L`, place attachment port `k` (for `k = 1..N`) at `offset_k = round((L * k / (N + 1)) / 4) * 4`. Maintain at least `12px` between adjacent ports. When the edge is too short for `12px` spacing, expand the node dimension to fit.
4. **Parallel separation:** Offset parallel connector segments by at least `12px`.
5. **Line crossings:** When two orthogonal paths must cross, insert a `6px`-radius semicircular bridge hop (`A 6 6 0 0 1`) on the horizontal segment at the intersection point.
6. **Edge labels:** Format edge labels in `ALL CAPS` using `Geist Mono` (`10px`–`11px`, maximum 14 characters). Center the label on the longest straight segment of the path. Place an opaque `<rect fill="var(--paper)">` mask behind the text sized to multiples of `4px` (`width >= text_width + 12px`, `height="16"`), keeping at least `8px` of visible stroke between the mask and any node border.

---

## Layer order

Emit SVG elements in this strict painter's order so that masks and lines never clip node borders:

1. **`<defs>`:** Arrowhead `<marker>` definitions (`8x6` crisp triangle in `var(--ink)`, `var(--muted)`, and `var(--accent)`).
2. **Layer 1 (Zones & overlap bands):** Background container `<rect rx="8">` elements and partition/halo bands with `fill="var(--soft)"` and `stroke-dasharray="4 4"` or `stroke-dasharray="2 3"`.
3. **Layer 2 (Connectors):** Orthogonal `<path fill="none" stroke-width="1.5">` elements using these semantic strokes:
   - High-frequency unacknowledged datagram (`UDP` / `QUIC`), exclusive write lock, or time-rewind path: solid `var(--accent)`.
   - Reliable control stream (`HTTPS` / `gRPC` / `SQL` ACID), ownership/value transfer, or synchronous call: solid `var(--ink)`.
   - State broadcast, asynchronous event, shared cache snapshot, or read-only borrow: dashed `var(--muted)` (`stroke-dasharray="5 4"`).
   - Multi-target compile target (e.g., `Native -> WASM`) or type-definition boundary: dotted `var(--muted)` (`stroke-dasharray="2 3"`).
4. **Layer 3 (Edge masks):** Opaque `<rect fill="var(--paper)">` backing rectangles for every edge label.
5. **Layer 4 (Edge text):** `<text>` elements for edge labels centered over Layer 3 masks.
6. **Layer 5 (Nodes, strips, & spans):** Foreground node `<rect rx="6" fill="var(--paper)" stroke-width="1.5">` boxes, contiguous bit/ring-buffer cells, vertical lifecycle span bars, and node `<text>` labels.

---

## Archetypes

- **Multi-tier runtime architecture (`TB` tiers, `LR` dataflow):** Partition the canvas into horizontal or vertical frequency/runtime bands in Layer 1 (such as `Control Plane [1-2Hz ACID]`, `Real-Time Simulation Mesh [20Hz]`, and `Cold Storage`). Tag every cross-tier edge mask with its transport and rate (`QUIC 20HZ`, `HTTPS`). When two nodes in different tiers share a compiled module or schema definition, tag them with a matching mono badge (e.g., `[Shared Crate]`).
- **Spatial partition & boundary overlap (`LR`):** Render adjacent partitions or shards inside a shared plane separated by a vertical border line at `x_border`. Draw the bidirectional replication/ghost band (`x_border ± buffer`) as a shaded `var(--soft)` `<rect>` straddling the border, and mark any hysteresis or overflow threshold with a vertical dashed `var(--accent)` line. Route cross-border sync and proxy traffic across the overlap band.
- **Bit-packed wire frame / contiguous buffer (`LR`):** Render contiguous memory fields, protocol packets, or ring-buffer slots as adjacent `<rect>` cells (`x_{k+1} = x_k + width_k`, zero gap) sharing `y` and `height` (`44px` or `52px`). Place bit widths (`[64b]`, `[16b]`) or indices (`T-1`, `T`) in `Geist Mono` (`11px`) inside or `8px` above each cell. Highlight active write heads, targets, or bit-packed fields with `var(--accent)`. Count the entire contiguous strip as 1 composite node toward the 9-node budget.
- **Timeline / lifecycle spans (`TB` phases, `LR` lanes):** Stack ordered execution phases or statements vertically at `4px`-aligned intervals. Render each resource lifetime, exclusive lock scope, or transaction window as a vertical `<rect width="8" rx="4">` span bar in the right gutter alongside the exact phases it covers. Use `var(--accent)` for exclusive write or rollback windows and `var(--ink)` for shared read locks.
- **Relational or schema data model (`LR`):** Render each database table or component schema as a `<rect rx="6">` container with a `36px` header band holding the table or schema name in `Geist` (`600`). Render each row in `Geist Mono` (`11px`) with primary key (`PK`), foreign key (`FK`), or index badges (`var(--accent)` for `PK`, `var(--muted)` for `FK`).
- **Sequence protocol (`LR` lifelines, `TB` time):** Place actor headers (`height="40"`) across the top row separated by at least `160px` center-to-center. Draw vertical dashed lifelines (`stroke="var(--muted)"`) from each actor's bottom center. Render active execution spans as `12px`-wide `<rect fill="var(--soft)" stroke="var(--ink)">` bars on the lifeline.
- **State machine (`LR`):** Render states as pill rectangles (`rx="20"`, `height="40"`). Mark the initial state with a filled `10px` `var(--ink)` circle and an entry arrow. Mark terminal states with a double border (outer `rx="20"`, inner `rx="16"` inset by `4px`). Format transition guards on edge masks as `[GUARD_NAME]`.
- **DAG / pipeline flow (`LR`):** Align stage gates in vertical columns separated by `80px` horizontal gutters. Split branching decisions from dedicated fan ports on the right edge of the source node rather than using diamond shapes, and label each branch condition on its edge mask.
