import importlib.util
import io
import os
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout

from bs4 import BeautifulSoup


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAMBDA_DIR = os.path.join(ROOT, "lambda")
BASE_URL = "https://heathermedwards.substack.com/"


class FakeResponse:
    def __init__(self, content=b"", status_code=200):
        self.content = content
        self.status_code = status_code
        self.ok = status_code == 200


def _load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _stub_dependencies():
    boto3 = types.ModuleType("boto3")
    boto3.client = lambda *args, **kwargs: None
    sys.modules.setdefault("boto3", boto3)

    # The handler modules only need start_scraping at import time. Tests here
    # exercise get_scrape_mode directly, so a recording stub is enough.
    scrape = types.ModuleType("scrape")
    scrape.start_scraping = lambda *args, **kwargs: {
        "essays": [],
        "mode": kwargs.get("mode", "feed"),
        "saved": 0,
        "skipped": 0,
    }
    sys.modules["scrape"] = scrape


# Load the real scraper under a private name first, so it cannot collide with
# the stub another test file may already have placed in sys.modules["scrape"].
scrape = _load_module("scrape_rescrape_under_test", os.path.join(LAMBDA_DIR, "scrape.py"))

_stub_dependencies()

lambda_function = _load_module(
    "lambda_function_rescrape_under_test",
    os.path.join(LAMBDA_DIR, "lambda_function.py"),
)
static_upload_lambda = _load_module(
    "static_upload_lambda_rescrape_under_test",
    os.path.join(LAMBDA_DIR, "static_upload_lambda.py"),
)

HANDLERS = (lambda_function, static_upload_lambda)

SITEMAP_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://heathermedwards.substack.com/p/when-was-america-great</loc></url>
  <url><loc>https://heathermedwards.substack.com/p/another-post</loc></url>
  <url><loc>https://heathermedwards.substack.com/p/when-was-america-great</loc></url>
  <url><loc>https://heathermedwards.substack.com/archive</loc></url>
  <url><loc>https://heathermedwards.substack.com/about</loc></url>
</urlset>
"""

FEED_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss><channel>
  <item><link>https://example.substack.com/p/good</link></item>
  <item><link>https://example.substack.com/p/bad</link></item>
  <item><link>https://example.substack.com/p/nodate</link></item>
</channel></rss>
"""

GOOD_HTML = """
<html><body>
  <h1 class="post-title">Good Title</h1>
  <div class="available-content"><p>Body text.</p></div>
  <script type="application/ld+json">{"datePublished": "2025-01-02T00:00:00Z"}</script>
</body></html>
"""

NO_DATE_HTML = """
<html><body>
  <h1 class="post-title">No Date Title</h1>
  <div class="available-content"><p>Body text.</p></div>
</body></html>
"""


class TestSitemapParsing(unittest.TestCase):
    def test_keeps_only_post_urls_and_removes_duplicates(self):
        urls = scrape.parse_sitemap_post_urls(SITEMAP_XML)
        self.assertEqual(
            urls,
            [
                "https://heathermedwards.substack.com/p/when-was-america-great",
                "https://heathermedwards.substack.com/p/another-post",
            ],
        )

    def test_fetch_urls_from_sitemap_uses_sitemap(self):
        scraper = object.__new__(scrape.SubstackScraper)
        scraper.base_substack_url = BASE_URL

        original_get = scrape.requests.get
        scrape.requests.get = lambda url, *args, **kwargs: FakeResponse(SITEMAP_XML)
        try:
            urls = scraper.fetch_urls_from_sitemap()
        finally:
            scrape.requests.get = original_get

        self.assertEqual(len(urls), 2)
        self.assertTrue(all("/p/" in url for url in urls))


class TestPostSelectorNormalization(unittest.TestCase):
    def test_slugs_and_urls_are_normalized_and_deduplicated(self):
        result = scrape.normalize_post_selectors(
            BASE_URL,
            [
                "when-was-america-great",
                "https://heathermedwards.substack.com/p/another-post",
                "https://heathermedwards.substack.com/p/another-post/",
                "when-was-america-great",
            ],
        )
        self.assertEqual(
            result,
            [
                f"{BASE_URL}p/when-was-america-great",
                f"{BASE_URL}p/another-post",
            ],
        )

    def test_bad_selectors_are_rejected_with_a_log_line(self):
        output = io.StringIO()
        with redirect_stdout(output):
            result = scrape.normalize_post_selectors(
                BASE_URL,
                [
                    "https://other.example.com/p/wrong-host",
                    "Not_A_Valid_Slug",
                    "https://heathermedwards.substack.com/about",
                    "",
                    "https://heathermedwards.substack.com/p/Upper-Case",
                    "valid-slug-123",
                ],
            )

        self.assertEqual(result, [f"{BASE_URL}p/valid-slug-123"])
        log = output.getvalue()
        self.assertIn("different host", log)
        self.assertIn("invalid article slug", log)
        self.assertIn("not a post", log)
        self.assertIn("empty article selector", log)


class TestEventModeSelection(unittest.TestCase):
    def test_event_selects_feed_full_or_explicit(self):
        for module in HANDLERS:
            with self.subTest(module=module.__name__):
                self.assertEqual(module.get_scrape_mode(None), ("feed", None))
                self.assertEqual(module.get_scrape_mode({}), ("feed", None))
                self.assertEqual(module.get_scrape_mode({"mode": "full"}), ("full", None))
                self.assertEqual(
                    module.get_scrape_mode({"slugs": ["when-was-america-great"]}),
                    ("explicit", ["when-was-america-great"]),
                )
                self.assertEqual(
                    module.get_scrape_mode({"mode": "full", "slugs": ["ignored"]}),
                    ("full", None),
                )
                self.assertEqual(module.get_scrape_mode({"slugs": []}), ("feed", None))


class TestScrapeSafety(unittest.TestCase):
    def test_failed_pages_and_missing_dates_are_not_saved(self):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)

        original_get = scrape.requests.get
        scrape.requests.get = lambda url, *args, **kwargs: FakeResponse(FEED_XML)
        try:
            scraper = scrape.SubstackScraper(
                base_substack_url="https://example.substack.com/",
                md_save_dir=os.path.join(temp_dir.name, "md"),
                html_save_dir=os.path.join(temp_dir.name, "html"),
                mode="feed",
            )
        finally:
            scrape.requests.get = original_get

        soups = {
            "https://example.substack.com/p/good": BeautifulSoup(GOOD_HTML, "html.parser"),
            "https://example.substack.com/p/bad": None,
            "https://example.substack.com/p/nodate": BeautifulSoup(NO_DATE_HTML, "html.parser"),
        }
        scraper.get_url_soup = lambda url: soups.get(url)

        scraper.scrape_posts()

        self.assertEqual([post["title"] for post in scraper.essays_data], ["Good Title"])
        self.assertEqual(scraper.saved_count, 1)
        self.assertEqual(scraper.skipped_count, 2)
        self.assertTrue(os.path.exists(os.path.join(scraper.md_save_dir, "good.md")))
        self.assertFalse(os.path.exists(os.path.join(scraper.md_save_dir, "bad.md")))
        self.assertFalse(os.path.exists(os.path.join(scraper.md_save_dir, "nodate.md")))


class TestTestArticleRule(unittest.TestCase):
    def test_only_test_article_prefix_matches(self):
        for module in (scrape, lambda_function, static_upload_lambda):
            with self.subTest(module=module.__name__):
                self.assertTrue(module.is_test_article("test-article-hello.md"))
                self.assertTrue(module.is_test_article("posts/heathermedwards/test-article-hello.md"))
                self.assertFalse(
                    module.is_test_article("alligator-alcatraz-magas-latest-spectacle.md")
                )
                self.assertFalse(
                    module.is_test_article("mt-trumpmore-the-latest-in-maga-sycophancy.md")
                )
                self.assertFalse(module.is_test_article("protest.md"))
                self.assertFalse(module.is_test_article("latest.md"))


class TestFootnoteLinks(unittest.TestCase):
    """Substack now writes footnotes as bare "#footnote-1" links, which
    html2text drops. They must reach the markdown as full post URLs."""

    PAGE = "https://heathermedwards.substack.com/p/when-was-america-great"

    def test_fragment_links_become_full_post_urls_and_survive_markdown(self):
        soup = BeautifulSoup(
            '<div class="available-content"><p>Kneeling.<a class="footnote-anchor" '
            'id="footnote-anchor-1" href="#footnote-1">1</a></p>'
            '<div class="footnote"><a id="footnote-1" href="#footnote-anchor-1" '
            'class="footnote-number">1</a><div class="footnote-content"><p>Source</p></div></div>'
            '<p><a href="https://example.com/x">external</a> <a href="#">top</a></p></div>',
            "html.parser",
        )
        scrape.absolutize_fragment_links(soup, self.PAGE + "#ignored")

        md = scrape.BaseSubstackScraper.html_to_md(str(soup.select_one("div.available-content")))
        self.assertIn(f"[1]({self.PAGE}#footnote-1)", md)
        self.assertIn(f"[1]({self.PAGE}#footnote-anchor-1)", md)
        self.assertIn("[external](https://example.com/x)", md)
        self.assertEqual(soup.find("a", string="top")["href"], "#")


class TestFetchWithRetry(unittest.TestCase):
    """A full re-scrape of ~200 posts trips Substack's rate limit (HTTP 429)."""

    def _run(self, statuses, headers=None):
        responses = []
        for status in statuses:
            response = FakeResponse(b"ok", status_code=status)
            response.headers = headers or {}
            responses.append(response)
        calls, sleeps = [], []

        def fake_get(url, *args, **kwargs):
            calls.append(kwargs.get("timeout"))
            return responses[len(calls) - 1]

        original_get = scrape.requests.get
        scrape.requests.get = fake_get
        try:
            with redirect_stdout(io.StringIO()):
                result = scrape.fetch_with_retry("https://example.com/p/x", sleep=sleeps.append)
        finally:
            scrape.requests.get = original_get
        return result, calls, sleeps

    def test_rate_limited_page_is_retried_until_it_succeeds(self):
        result, calls, sleeps = self._run([429, 429, 200])
        self.assertEqual(result.status_code, 200)
        self.assertEqual(len(calls), 3)
        self.assertEqual(sleeps, [5, 10])

    def test_every_request_has_a_timeout(self):
        _, calls, _ = self._run([503, 200])
        self.assertTrue(all(timeout == scrape.REQUEST_TIMEOUT_SECONDS for timeout in calls))

    def test_retry_after_header_is_honoured_and_capped(self):
        _, _, sleeps = self._run([429, 200], headers={"Retry-After": "7"})
        self.assertEqual(sleeps, [7])
        _, _, sleeps = self._run([429, 200], headers={"Retry-After": "600"})
        self.assertEqual(sleeps, [scrape.MAX_RETRY_DELAY_SECONDS])

    def test_gives_up_after_max_retries_and_returns_last_response(self):
        result, calls, sleeps = self._run([429] * (scrape.MAX_RETRIES + 1))
        self.assertEqual(result.status_code, 429)
        self.assertEqual(len(calls), scrape.MAX_RETRIES + 1)
        self.assertEqual(len(sleeps), scrape.MAX_RETRIES)

    def test_not_found_is_not_retried(self):
        result, calls, sleeps = self._run([404])
        self.assertEqual(result.status_code, 404)
        self.assertEqual((len(calls), sleeps), (1, []))


if __name__ == "__main__":
    unittest.main()
