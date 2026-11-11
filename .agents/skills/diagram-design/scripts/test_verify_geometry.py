"""Regression cases for the geometry defects found during concept-deck review."""

import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('geometry', Path(__file__).with_name('verify-geometry.py'))
geometry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geometry)


class GeometryTests(unittest.TestCase):
    def errors(self, body):
        return geometry.validate(body)[0]

    def svg(self, body, namespace=True):
        ns = ' xmlns="http://www.w3.org/2000/svg"' if namespace else ''
        return f'<svg{ns}>{body}</svg>'

    def test_every_svg_is_checked(self):
        good = self.svg('<rect width="40" height="40"/>')
        bad = self.svg('<rect x="1" width="40" height="40"/>')
        self.assertTrue(any('SVG 2: Grid' in error for error in self.errors(good + bad)))

    def test_namespace_is_optional(self):
        self.assertTrue(self.errors(self.svg('<rect x="1" width="40" height="40"/>', False)))
        self.assertFalse(self.errors(self.svg('<rect width="40" height="40"/>', False)))

    def test_node_fill_does_not_hide_collisions(self):
        for fill in ('var(--paper)', 'var(--soft)', '#f5f5f5', 'none'):
            with self.subTest(fill=fill):
                body = f'<rect width="40" height="40" fill="{fill}"/><rect x="4" width="40" height="40"/>'
                self.assertTrue(any('Collision' in error for error in self.errors(self.svg(body))))

    def test_background_and_mask_roles_are_explicit(self):
        body = '<g data-layer="zones"><rect width="80" height="80"/></g><rect width="40" height="40"/><rect width="16" height="16" data-geometry="mask"/>'
        self.assertFalse(self.errors(self.svg(body)))
        self.assertTrue(self.errors(self.svg(body.replace('width="80"', 'width="81"'))))

    def test_touching_nodes_and_separate_svgs_do_not_collide(self):
        body = self.svg('<rect width="40" height="40"/><rect x="40" width="40" height="40"/>')
        self.assertFalse(self.errors(body + body))

    def test_rounded_paths_track_arc_endpoints(self):
        for path in ('M 0 0 L 40 0 A 8 8 0 0 1 48 8 L 48 40',
                     'm 0 0 h 40 a 8 8 0 0 1 8 8 v 32',
                     'M 0 0 H 40 A 6 6 0 0 1 52 0 H 80'):
            with self.subTest(path=path):
                self.assertFalse(self.errors(self.svg(f'<path d="{path}"/>')))
        self.assertTrue(self.errors(self.svg('<path d="M 0 0 H 40 A 8 8 0 0 1 48 8 L 60 40"/>')))

    def test_implicit_lines_and_closepath_are_checked(self):
        for path in ('M 0 0 8 8', 'm 0 0 8 8', 'M 0 0 H 8 V 8 Z'):
            with self.subTest(path=path):
                self.assertTrue(self.errors(self.svg(f'<path d="{path}"/>')))
        self.assertFalse(self.errors(self.svg('<path d="M 0 0 4e1 0 V 40 H 0 Z"/>')))

    def test_marker_triangles_are_not_connectors(self):
        self.assertFalse(self.errors(self.svg('<defs><marker><path d="M 0 0 L 8 3 L 0 6 Z"/></marker></defs><path d="M 0 0 H 40"/>')))

    def test_unsupported_geometry_fails_explicitly(self):
        cases = ['<path d="M 0 0 C 1 2 3 4 5 6"/>', '<path d="M 0 0 L"/>',
                 '<g transform="translate(2 0)"><rect width="40" height="40"/></g>',
                 '<rect width="100%" height="40"/>', '<rect width="NaN" height="40"/>',
                 '<line x2="8" y2="8"/>', '<use href="#node"/>']
        for body in cases:
            with self.subTest(body=body):
                self.assertTrue(self.errors(self.svg(body)))

    def test_missing_and_malformed_svg_fail(self):
        self.assertTrue(self.errors('<html></html>'))
        self.assertTrue(self.errors('<svg><g></svg>'))
        self.assertFalse(self.errors('<script>const example = "<svg>";</script>' + self.svg('<path d="M0 0 H40"/>')))


if __name__ == '__main__':
    unittest.main()
