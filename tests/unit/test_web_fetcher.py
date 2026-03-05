"""Tests for web fetcher."""

from __future__ import annotations

from ventureforge.research.web_fetcher import _strip_html


def test_strip_html_basic():
    html = "<p>Hello <b>world</b></p>"
    result = _strip_html(html)
    assert "Hello" in result
    assert "world" in result
    assert "<p>" not in result


def test_strip_html_script_removal():
    html = "<script>alert('xss')</script><p>Safe content</p>"
    result = _strip_html(html)
    assert "alert" not in result
    assert "Safe content" in result


def test_strip_html_style_removal():
    html = "<style>.foo{color:red}</style><p>Content</p>"
    result = _strip_html(html)
    assert "color" not in result
    assert "Content" in result
