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

lambda_function = _load_module(
    "lambda_function_under_test",
    os.path.join(LAMBDA_DIR, "lambda_function.py"),
)
static_upload_lambda = _load_module(
    "static_upload_lambda_under_test",
    os.path.join(LAMBDA_DIR, "static_upload_lambda.py"),
)

MODULES = (lambda_function, static_upload_lambda)


class TestSubtitleParsing(unittest.TestCase):
    def extract_both(self, content, filename="essay.md"):
        return [module.extract_metadata_from_content(content, filename) for module in MODULES]

    def assert_results_identical(self, results):
        first = results[0]
        for result in results[1:]:
            self.assertEqual(result, first)

    def test_subtitle_between_title_and_date(self):
        content = (
            "# French New Wave, Feminism, and Happiness\n"
            "\n"
            "## Agnes Varda's floral warning\n"
            "\n"
            "**Oct 25, 2026**\n"
        )
        results = self.extract_both(content)
        self.assert_results_identical(results)
        self.assertEqual(results[0]["title"], "French New Wave, Feminism, and Happiness")
        self.assertEqual(results[0]["subtitle"], "Agnes Varda's floral warning")
        self.assertEqual(results[0]["date"], "Oct 25, 2026")

    def test_no_subtitle_when_date_follows_title(self):
        content = "# Just a Title\n\n**Oct 25, 2026**\n"
        results = self.extract_both(content)
        self.assert_results_identical(results)
        self.assertEqual(results[0]["subtitle"], "")

    def test_h3_heading_in_body_is_ignored(self):
        content = (
            "# Just a Title\n"
            "\n"
            "**Oct 25, 2026**\n"
            "\n"
            "Body paragraph.\n"
            "\n"
            "### Machine Learning Advances\n"
        )
        results = self.extract_both(content)
        self.assert_results_identical(results)
        self.assertEqual(results[0]["subtitle"], "")

    def test_h2_section_heading_after_date_is_ignored(self):
        content = (
            "# Just a Title\n"
            "\n"
            "**Oct 25, 2026**\n"
            "\n"
            "## A Section Heading\n"
        )
        results = self.extract_both(content)
        self.assert_results_identical(results)
        self.assertEqual(results[0]["subtitle"], "")

    def test_first_non_blank_line_after_title_must_be_h2(self):
        content = (
            "# Just a Title\n"
            "\n"
            "An intro paragraph.\n"
            "\n"
            "## Not a Subtitle\n"
        )
        results = self.extract_both(content)
        self.assert_results_identical(results)
        self.assertEqual(results[0]["subtitle"], "")

    def test_h2_title_is_not_reused_as_subtitle(self):
        content = "## Title From H2\n\n**Oct 25, 2026**\n"
        results = self.extract_both(content)
        self.assert_results_identical(results)
        self.assertEqual(results[0]["title"], "Title From H2")
        self.assertEqual(results[0]["subtitle"], "")

    def test_h2_title_can_be_followed_by_separate_h2_subtitle(self):
        content = (
            "## Title From H2\n"
            "\n"
            "## Separate Subtitle\n"
            "\n"
            "**Oct 25, 2026**\n"
        )
        results = self.extract_both(content)
        self.assert_results_identical(results)
        self.assertEqual(results[0]["title"], "Title From H2")
        self.assertEqual(results[0]["subtitle"], "Separate Subtitle")


if __name__ == "__main__":
    unittest.main()
