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
    "lambda_function_thumbnail_under_test",
    os.path.join(LAMBDA_DIR, "lambda_function.py"),
)
static_upload_lambda = _load_module(
    "static_upload_lambda_thumbnail_under_test",
    os.path.join(LAMBDA_DIR, "static_upload_lambda.py"),
)

MODULES = (lambda_function, static_upload_lambda)


class TestThumbnailParsing(unittest.TestCase):
    def extract_both(self, content, filename="essay.md"):
        return [module.extract_metadata_from_content(content, filename) for module in MODULES]

    def assert_results_identical(self, results):
        first = results[0]
        for result in results[1:]:
            self.assertEqual(result, first)

    def test_substack_image_keeps_token_and_replaces_options(self):
        original = (
            "https://substackcdn.com/image/fetch/$s_!0X-R!,"
            "w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/"
            "https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fabc_903x935.jpeg"
        )
        content = f"# An Essay\n\n**Oct 25, 2026**\n\n![Hero]({original})\n"
        results = self.extract_both(content)
        self.assert_results_identical(results)
        self.assertEqual(
            results[0]["thumbnail"],
            (
                "https://substackcdn.com/image/fetch/$s_!0X-R!,"
                "w_160,h_160,c_fill,f_auto,q_auto:good,fl_progressive:steep,g_auto/"
                "https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fabc_903x935.jpeg"
            ),
        )

    def test_unsplash_image_is_resized_with_square_crop(self):
        original = (
            "https://images.unsplash.com/photo-123"
            "?ixlib=rb-4.0.3&q=85&fm=jpg&crop=entropy&cs=srgb&w=3000"
        )
        content = f"# An Essay\n\n**Oct 25, 2026**\n\n![Hero]({original})\n"
        results = self.extract_both(content)
        self.assert_results_identical(results)
        thumbnail = results[0]["thumbnail"]
        self.assertTrue(thumbnail.startswith("https://images.unsplash.com/photo-123?"))
        self.assertIn("w=160", thumbnail)
        self.assertIn("h=160", thumbnail)
        self.assertIn("fit=crop", thumbnail)
        self.assertIn("ixlib=rb-4.0.3", thumbnail)
        self.assertNotIn("w=3000", thumbnail)

    def test_other_host_is_left_unchanged(self):
        original = "https://example.com/images/hero.jpg"
        content = f"# An Essay\n\n![Hero]({original})\n"
        results = self.extract_both(content)
        self.assert_results_identical(results)
        self.assertEqual(results[0]["thumbnail"], original)

    def test_no_image_gives_empty_thumbnail(self):
        content = "# An Essay\n\n**Oct 25, 2026**\n\nNo images here.\n"
        results = self.extract_both(content)
        self.assert_results_identical(results)
        self.assertEqual(results[0]["thumbnail"], "")

    def test_first_image_is_used_when_several_exist(self):
        first = "https://images.unsplash.com/photo-first?w=3000"
        second = "https://images.unsplash.com/photo-second?w=3000"
        content = f"# An Essay\n\n![First]({first})\n\n![Second]({second})\n"
        results = self.extract_both(content)
        self.assert_results_identical(results)
        self.assertIn("photo-first", results[0]["thumbnail"])
        self.assertNotIn("photo-second", results[0]["thumbnail"])

    def test_first_image_wrapped_in_a_link_is_used(self):
        first = "https://images.unsplash.com/photo-first?w=3000"
        second = "https://images.unsplash.com/photo-second?w=3000"
        content = (
            f"# An Essay\n\n"
            f"[![First]({first})](https://example.com/full)\n\n"
            f"![Second]({second})\n"
        )
        results = self.extract_both(content)
        self.assert_results_identical(results)
        self.assertIn("photo-first", results[0]["thumbnail"])
        self.assertNotIn("photo-second", results[0]["thumbnail"])


if __name__ == "__main__":
    unittest.main()
