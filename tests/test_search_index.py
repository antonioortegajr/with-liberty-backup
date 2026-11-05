import importlib.util
import os
import sys
import types
import unittest


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAMBDA_DIR = os.path.join(ROOT, "lambda")


def _stub_dependencies():
    boto3 = types.ModuleType("boto3")
    boto3.client = lambda *args, **kwargs: None
    sys.modules.setdefault("boto3", boto3)

    scrape = types.ModuleType("scrape")
    scrape.start_scraping = lambda *args, **kwargs: []
    sys.modules.setdefault("scrape", scrape)


def _load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_stub_dependencies()

static_upload_lambda = _load_module(
    "static_upload_lambda_under_test",
    os.path.join(LAMBDA_DIR, "static_upload_lambda.py"),
)


class TestBuildSearchText(unittest.TestCase):
    def words(self, content):
        return static_upload_lambda.build_search_text(content).split()

    def test_markdown_images_are_removed(self):
        words = self.words("Before ![A cat](https://images.example.com/cat.png) after")
        self.assertNotIn("cat", words)
        self.assertNotIn("example", words)
        self.assertIn("before", words)
        self.assertIn("after", words)

    def test_images_wrapped_in_a_link_are_removed(self):
        content = "[![A cat](https://images.example.com/cat.png)](https://example.com/post)"
        self.assertEqual(static_upload_lambda.build_search_text(content), "")

    def test_link_text_is_kept_and_link_url_is_dropped(self):
        words = self.words("Read [the report](https://example.com/report) now")
        self.assertIn("the", words)
        self.assertIn("report", words)
        self.assertNotIn("example", words)

    def test_standalone_citation_url_is_split_into_words(self):
        words = self.words("Source: https://www.example.com/article")
        self.assertIn("example", words)
        self.assertIn("com", words)
        self.assertIn("article", words)
        self.assertNotIn("https://www.example.com/article", words)

    def test_likes_line_is_dropped(self):
        words = self.words("**Likes:** 42\n\nThe body")
        self.assertNotIn("likes", words)
        self.assertNotIn("42", words)
        self.assertIn("body", words)

    def test_duplicates_are_removed_in_first_seen_order(self):
        text = static_upload_lambda.build_search_text("Beta alpha beta ALPHA gamma")
        self.assertEqual(text, "beta alpha gamma")

    def test_short_words_and_pure_numbers_are_dropped(self):
        words = self.words("a I go 123 42 7 ok")
        self.assertEqual(words, ["go", "ok"])

    def test_non_english_letters_are_kept(self):
        words = self.words("Café naïve 東京")
        self.assertEqual(words, ["café", "naïve", "東京"])


if __name__ == "__main__":
    unittest.main()
