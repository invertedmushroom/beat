#!/usr/bin/env python3
"""Lint explicit SVG rectangle geometry and orthogonal connectors in HTML.

Every inline SVG is checked. Colors do not determine collision roles.
This is a geometry check, not a browser layout or accessibility validator.
"""

from html.parser import HTMLParser
from math import isclose, isfinite
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET


class SVGParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.roots = []
        self.stack = []
        self.errors = []

    def handle_starttag(self, tag, attrs):
        if tag != 'svg' and not self.stack:
            return
        element = ET.Element(tag.split(':')[-1], dict(attrs))
        if self.stack:
            self.stack[-1].append(element)
        else:
            self.roots.append(element)
        self.stack.append(element)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if not self.stack:
            return
        if self.stack[-1].tag != tag.split(':')[-1]:
            self.errors.append(f'Malformed SVG: unexpected closing tag </{tag}>.')
            return
        self.stack.pop()


def number(value):
    result = float(value)
    if not isfinite(result):
        raise ValueError('coordinates must be finite')
    return result


def check_grid(value, name):
    if not isclose(value / 4, round(value / 4), abs_tol=1e-9):
        return f'Grid error: {name} value {value:g} is not a multiple of 4px.'
    return None


TOKEN = re.compile(r'[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?')
ARITY = {'M': 2, 'L': 2, 'H': 1, 'V': 1, 'A': 7}


def check_path(data):
    """Track endpoints, including arcs and relative/implicit SVG commands."""
    if re.sub(TOKEN, '', data).strip(' ,\t\n\r'):
        raise ValueError('malformed path data')
    tokens = TOKEN.findall(data)
    if not tokens:
        raise ValueError('empty connector path')
    cursor = (0.0, 0.0)
    start = None
    command = None
    index = 0

    def straight(target):
        if not (isclose(target[0], cursor[0], abs_tol=1e-9) or
                isclose(target[1], cursor[1], abs_tol=1e-9)):
            raise ValueError(f'diagonal segment from {cursor} to {target}')

    while index < len(tokens):
        if tokens[index].isalpha():
            command = tokens[index]
            index += 1
            if command.upper() == 'Z':
                if start is None:
                    raise ValueError('close-path before move')
                straight(start)
                cursor = start
                command = None
                continue
        if command is None or command.upper() not in ARITY:
            raise ValueError(f'unsupported connector command {command!r}; use M/L/H/V/A/Z')
        op = command.upper()
        count = ARITY[op]
        args = tokens[index:index + count]
        if len(args) != count or any(item.isalpha() for item in args):
            raise ValueError(f'incomplete {command} command')
        values = [number(item) for item in args]
        index += count
        if start is None and op != 'M':
            raise ValueError('connector must begin with M or m')
        relative = command.islower()
        if op == 'H':
            target = (values[0] + (cursor[0] if relative else 0), cursor[1])
        elif op == 'V':
            target = (cursor[0], values[0] + (cursor[1] if relative else 0))
        else:
            target = (values[-2] + (cursor[0] if relative else 0),
                      values[-1] + (cursor[1] if relative else 0))
        if op == 'M':
            start = target
            command = 'l' if relative else 'L'
        elif op == 'A':
            rx, ry, rotation, large, sweep = values[:5]
            dx, dy = abs(target[0] - cursor[0]), abs(target[1] - cursor[1])
            quarter = all(isclose(v, 8, abs_tol=1e-9) for v in (rx, ry, dx, dy))
            bridge = (isclose(rx, 6) and isclose(ry, 6) and
                      ((isclose(dx, 12) and isclose(dy, 0, abs_tol=1e-9)) or
                       (isclose(dy, 12) and isclose(dx, 0, abs_tol=1e-9))))
            if rotation != 0 or large != 0 or sweep not in (0, 1) or not (quarter or bridge):
                raise ValueError('use r=8 quarter-circle elbows or r=6 semicircular bridge hops')
        else:
            straight(target)
        cursor = target


LAYER_ROLE = {'zones': 'zone', 'edge-masks': 'mask', 'nodes': 'node'}
ROLES = {'node', 'zone', 'mask', 'decoration'}


def check_svg(root):
    errors = []
    boxes = []

    def visit(element, inherited_role='node'):
        if element.tag == 'defs':
            return
        role = element.get('data-geometry', LAYER_ROLE.get(element.get('data-layer'), inherited_role))
        if role not in ROLES:
            errors.append(f'Unknown data-geometry role: {role!r}.')
            return
        if (element.get('transform') or re.search(r'\btransform\s*:', element.get('style', ''))
                or element.tag == 'use' or (element.tag == 'svg' and element is not root)):
            errors.append('Unsupported transformed, reused, or nested geometry; use explicit canvas coordinates.')
            return
        try:
            if element.tag == 'rect':
                box = tuple(number(element.get(key, '0')) for key in ('x', 'y', 'width', 'height'))
                if box[2] <= 0 or box[3] <= 0:
                    raise ValueError('rectangle width and height must be positive')
                for key, value in zip(('x', 'y', 'width', 'height'), box):
                    error = check_grid(value, f'rect {key}')
                    if error:
                        errors.append(error)
                if role == 'node':
                    boxes.append(box)
            elif element.tag == 'path' and role != 'decoration':
                check_path(element.get('d', ''))
            elif element.tag == 'line' and role != 'decoration':
                x1, y1, x2, y2 = (number(element.get(key, '0')) for key in ('x1', 'y1', 'x2', 'y2'))
                if not (isclose(x1, x2, abs_tol=1e-9) or isclose(y1, y2, abs_tol=1e-9)):
                    raise ValueError('diagonal line element')
            elif element.tag in ('polyline', 'polygon') and role != 'decoration':
                raise ValueError('use path elements for connectors or mark node artwork as decoration')
        except (TypeError, ValueError) as error:
            errors.append(f'{element.tag}: {error}')
        for child in element:
            visit(child, role)

    visit(root)
    for index, first in enumerate(boxes):
        x1, y1, w1, h1 = first
        for second in boxes[index + 1:]:
            x2, y2, w2, h2 = second
            if not (x1 + w1 <= x2 or x2 + w2 <= x1 or y1 + h1 <= y2 or y2 + h2 <= y1):
                errors.append(f'Collision error: foreground rectangles {first} and {second} overlap.')
    return errors


def validate(content):
    parser = SVGParser()
    parser.feed(content)
    parser.close()
    errors = list(parser.errors)
    if parser.stack:
        errors.append('Malformed SVG: unclosed elements.')
    if not parser.roots:
        errors.append('No inline SVG found.')
    for index, root in enumerate(parser.roots, 1):
        errors.extend(f'SVG {index}: {error}' for error in check_svg(root))
    return errors, len(parser.roots)


def main(path):
    errors, count = validate(Path(path).read_text(encoding='utf-8'))
    if errors:
        print('FAIL: Geometry violations:\n' + '\n'.join(f'  - {error}' for error in errors))
        return 1
    print(f'PASS: Checked {count} SVG(s): rectangle grid, foreground rectangle collisions, connector geometry.')
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Usage: python verify-geometry.py <diagram.html>')
        sys.exit(1)
    sys.exit(main(sys.argv[1]))
