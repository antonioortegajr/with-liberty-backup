import argparse
import json
import os
import re
import time
from abc import ABC, abstractmethod
from datetime import datetime
from typing import List, Optional, Tuple

from bs4 import BeautifulSoup
import html2text
import markdown
import requests
from tqdm import tqdm
from xml.etree import ElementTree as ET

from urllib.parse import urlparse

BASE_SUBSTACK_URL: str = os.getenv("SUBSTACK_URL", "https://heathermedwards.substack.com/")  # Substack you want to convert to markdown
BASE_MD_DIR: str = "substack_md_files"  # Name of the directory we'll save the .md essay files
BASE_HTML_DIR: str = "substack_html_pages"  # Name of the directory we'll save the .html essay files
NUM_POSTS_TO_SCRAPE: int = 3  # Set to 0 if you want all posts
TEST_ARTICLE_PREFIX: str = "test-article-"

REQUEST_TIMEOUT_SECONDS: int = 30
RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_RETRIES: int = 4
MAX_RETRY_DELAY_SECONDS: int = 60


def retry_delay_seconds(response, attempt: int) -> float:
    """Seconds to wait before retry number `attempt` (0-based).

    Honours a numeric Retry-After header, otherwise backs off 5, 10, 20, 40s.
    Always capped so one page can't stall a Lambda run.
    """
    retry_after = (getattr(response, "headers", None) or {}).get("Retry-After", "")
    if str(retry_after).strip().isdigit():
        return min(int(retry_after), MAX_RETRY_DELAY_SECONDS)
    return min(5 * (2 ** attempt), MAX_RETRY_DELAY_SECONDS)


def absolutize_fragment_links(soup, page_url: str) -> None:
    """Turn in-page links (href="#footnote-1") into full post URLs.

    Substack now marks footnotes with bare "#..." hrefs. html2text drops
    in-page links by default, which would leave footnote numbers as plain text
    and break the site's superscript and in-page footnote handling (#36, #6).
    Full URLs match the format older backups already use, and avoid bare "#"
    links that the site's hash router would treat as article slugs.
    """
    base = page_url.split("#", 1)[0]
    for anchor in soup.find_all("a", href=True):
        href = anchor["href"]
        if href.startswith("#") and len(href) > 1:
            anchor["href"] = base + href


def fetch_with_retry(url: str, sleep=time.sleep):
    """GET a URL, retrying rate limits and server errors with backoff.

    Returns the last response; the caller decides what a non-200 means.
    """
    response = requests.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
    for attempt in range(MAX_RETRIES):
        if response.status_code not in RETRY_STATUSES:
            break
        delay = retry_delay_seconds(response, attempt)
        print(f"⏳ HTTP {response.status_code} for {url}; retrying in {delay:g}s ({attempt + 1}/{MAX_RETRIES})")
        sleep(delay)
        response = requests.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
    return response


def is_test_article(filename: str) -> bool:
    """True only for files intentionally named as test articles."""
    return os.path.basename(filename or "").startswith(TEST_ARTICLE_PREFIX)


def parse_sitemap_post_urls(xml_content) -> List[str]:
    """Return every unique /p/ post URL from a sitemap, in document order."""
    root = ET.fromstring(xml_content)
    urls: List[str] = []
    seen = set()

    for element in root.iter():
        if element.tag.rsplit("}", 1)[-1] != "loc" or not element.text:
            continue

        url = element.text.strip()
        path = urlparse(url).path
        if not path.startswith("/p/") or path == "/p/":
            continue
        if url in seen:
            continue

        seen.add(url)
        urls.append(url)

    return urls


def normalize_post_selectors(base_substack_url: str, selectors) -> List[str]:
    """Turn slugs or same-host post URLs into post URLs, skipping bad values."""
    if not base_substack_url.endswith("/"):
        base_substack_url += "/"

    base_host = urlparse(base_substack_url).hostname
    normalized: List[str] = []
    seen = set()

    for selector in selectors or []:
        if not isinstance(selector, str):
            print(f"⚠️ Skipping invalid article selector (not text): {selector!r}")
            continue

        value = selector.strip()
        if not value:
            print("⚠️ Skipping empty article selector")
            continue

        parsed = urlparse(value)
        if parsed.scheme or parsed.hostname:
            if parsed.hostname != base_host:
                print(f"⚠️ Skipping article from a different host: {value}")
                continue

            path = parsed.path
            if not path.startswith("/p/"):
                print(f"⚠️ Skipping URL that is not a post: {value}")
                continue

            slug = path[len("/p/"):].strip("/")
        else:
            slug = value

        if not re.fullmatch(r"[a-z0-9-]+", slug):
            print(f"⚠️ Skipping invalid article slug: {value}")
            continue

        url = f"{base_substack_url}p/{slug}"
        if url in seen:
            continue

        seen.add(url)
        normalized.append(url)

    return normalized


def extract_main_part(url: str) -> str:
    parts = urlparse(url).netloc.split('.')  # Parse the URL to get the netloc, and split on '.'
    return parts[1] if parts[0] == 'www' else parts[0]  # Return the main part of the domain, while ignoring 'www' if
    # present


class BaseSubstackScraper(ABC):
    def __init__(
        self,
        base_substack_url: str,
        md_save_dir: str,
        html_save_dir: str,
        mode: str = "feed",
        slugs=None,
    ):
        if not base_substack_url.endswith("/"):
            base_substack_url += "/"
        self.base_substack_url: str = base_substack_url

        self.writer_name: str = extract_main_part(base_substack_url)
        md_save_dir: str = f"{md_save_dir}/{self.writer_name}"

        self.md_save_dir: str = md_save_dir
        self.html_save_dir: str = f"{html_save_dir}/{self.writer_name}"

        if not os.path.exists(md_save_dir):
            os.makedirs(md_save_dir)
            print(f"Created md directory {md_save_dir}")
        if not os.path.exists(self.html_save_dir):
            os.makedirs(self.html_save_dir)
            print(f"Created html directory {self.html_save_dir}")

        self.keywords: List[str] = ["about", "archive", "podcast"]
        self.mode: str = mode if mode in ("feed", "full", "explicit") else "feed"
        if self.mode != mode:
            print(f"Unknown scrape mode {mode!r}; using feed")
        self.requested_slugs = slugs or []
        self.saved_count: int = 0
        self.skipped_count: int = 0
        self.post_urls: List[str] = self.get_all_post_urls()

    def get_all_post_urls(self) -> List[str]:
        """
        Fetches post URLs using the configured mode.
        """
        if self.mode == "full":
            print("Fetching all post URLs from sitemap.xml...")
            return self.fetch_urls_from_sitemap()

        if self.mode == "explicit":
            return normalize_post_selectors(self.base_substack_url, self.requested_slugs)

        urls = self.fetch_urls_from_feed()
        return self.filter_urls(urls, self.keywords)

    def fetch_urls_from_sitemap(self) -> List[str]:
        """
        Fetches every /p/ post URL from sitemap.xml.
        """
        sitemap_url = f"{self.base_substack_url}sitemap.xml"
        response = fetch_with_retry(sitemap_url)

        if not response.ok:
            print(f'Error fetching sitemap at {sitemap_url}: {response.status_code}')
            return []

        return parse_sitemap_post_urls(response.content)

    def fetch_urls_from_feed(self) -> List[str]:
        """
        Fetches URLs from feed.xml.
        """
        print('Falling back to feed.xml. This will only contain up to the 22 most recent posts.')
        feed_url = f"{self.base_substack_url}feed.xml"
        response = fetch_with_retry(feed_url)

        if not response.ok:
            print(f'Error fetching feed at {feed_url}: {response.status_code}')
            return []

        root = ET.fromstring(response.content)
        urls = []
        for item in root.findall('.//item'):
            link = item.find('link')
            if link is not None and link.text:
                urls.append(link.text)

        return urls

    @staticmethod
    def filter_urls(urls: List[str], keywords: List[str]) -> List[str]:
        """
        This method filters out URLs that contain certain keywords
        """
        return [url for url in urls if all(keyword not in url for keyword in keywords)]

    @staticmethod
    def html_to_md(html_content: str) -> str:
        """
        This method converts HTML to Markdown
        """
        if not isinstance(html_content, str):
            raise ValueError("html_content must be a string")
        h = html2text.HTML2Text()
        h.ignore_links = False
        h.body_width = 0
        return h.handle(html_content)

    @staticmethod
    def save_to_file(filepath: str, content: str) -> None:
        """
        This method saves content to a file. Can be used to save HTML or Markdown
        """
        if not isinstance(filepath, str):
            raise ValueError("filepath must be a string")

        if not isinstance(content, str):
            raise ValueError("content must be a string")

        if os.path.exists(filepath):
            print(f"File already exists: {filepath}")
            return

        with open(filepath, 'w', encoding='utf-8') as file:
            file.write(content)

    @staticmethod
    def md_to_html(md_content: str) -> str:
        """
        This method converts Markdown to HTML
        """
        return markdown.markdown(md_content, extensions=['extra'])


    def save_to_html_file(self, filepath: str, content: str) -> None:
        """
        This method saves HTML content to a file with a link to an external CSS file.
        """
        if not isinstance(filepath, str):
            raise ValueError("filepath must be a string")

        if not isinstance(content, str):
            raise ValueError("content must be a string")

        # Calculate the relative path from the HTML file to the CSS file
        html_dir = os.path.dirname(filepath)
        css_path = os.path.relpath("./assets/css/essay-styles.css", html_dir)
        css_path = css_path.replace(os.sep, "/")  # Ensure forward slashes for web paths

        html_content = f"""
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Markdown Content</title>
                <link rel="stylesheet" href="{css_path}">
            </head>
            <body>
                <main class="markdown-content">
                {content}
                </main>
            </body>
            </html>
        """

        with open(filepath, 'w', encoding='utf-8') as file:
            file.write(html_content)

    @staticmethod
    def get_filename_from_url(url: str, filetype: str = ".md") -> str:
        """
        Gets the filename from the URL (the ending)
        """
        if not isinstance(url, str):
            raise ValueError("url must be a string")

        if not isinstance(filetype, str):
            raise ValueError("filetype must be a string")

        if not filetype.startswith("."):
            filetype = f".{filetype}"

        return urlparse(url).path.rstrip("/").split("/")[-1] + filetype

    @staticmethod
    def combine_metadata_and_content(title: str, subtitle: str, date: str, like_count: str, content) -> str:
        """
        Combines the title, subtitle, and content into a single string with Markdown format
        """
        if not isinstance(title, str):
            raise ValueError("title must be a string")

        if not isinstance(content, str):
            raise ValueError("content must be a string")

        metadata = f"# {title}\n\n"
        if subtitle:
            metadata += f"## {subtitle}\n\n"
        metadata += f"**{date}**\n\n"
        metadata += f"**Likes:** {like_count}\n\n"

        return metadata + content

    @staticmethod
    def format_date(raw_date: str) -> str:
        """
        Normalizes an ISO 8601 timestamp to the "Feb 19, 2025" format used in the
        markdown metadata block. Returns "" if the value can't be parsed.
        """
        if not raw_date:
            return ""

        cleaned = raw_date.strip().replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(cleaned).strftime("%b %d, %Y")
        except ValueError:
            return ""

    @staticmethod
    def extract_post_date(soup: BeautifulSoup) -> str:
        """
        Gets the publication date from a post page.

        Substack renders the visible date inside a div whose class names are
        hashed and change without notice, so read the stable machine-readable
        sources first and only fall back to that markup.
        """
        # JSON-LD metadata
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string or "")
            except (TypeError, ValueError):
                continue

            entries = data if isinstance(data, list) else [data]
            for entry in entries:
                if isinstance(entry, dict):
                    date = BaseSubstackScraper.format_date(entry.get("datePublished", ""))
                    if date:
                        return date

        # <time datetime="..."> element
        time_element = soup.find("time", attrs={"datetime": True})
        if time_element:
            date = BaseSubstackScraper.format_date(time_element["datetime"])
            if date:
                return date
            if time_element.text.strip():
                return time_element.text.strip()

        # Legacy hashed-class markup
        date_element = soup.find(
            "div",
            class_="pencraft pc-reset color-pub-secondary-text-hGQ02T line-height-20-t4M0El font-meta-MWBumP size-11-NuY2Zx weight-medium-fw81nC transform-uppercase-yKDgcq reset-IxiVJZ meta-EgzBVA"
        )
        if date_element and date_element.text.strip():
            return date_element.text.strip()

        return "Date not found"

    @staticmethod
    def extract_post(soup: BeautifulSoup) -> dict:
        """
        Converts substack post soup to markdown, returning metadata and the body.
        """
        title_element = soup.select_one("h1.post-title, h2")  # Videos demote the title to h2
        title = title_element.get_text().strip() if title_element else ""

        subtitle_element = soup.select_one("h3.subtitle")
        subtitle = subtitle_element.get_text().strip() if subtitle_element else ""

        date = BaseSubstackScraper.extract_post_date(soup)

        like_count_element = soup.select_one("a.post-ufi-button .label")
        like_count = (
            like_count_element.get_text().strip()
            if like_count_element and like_count_element.get_text().strip().isdigit()
            else "0"
        )

        content_element = soup.select_one("div.available-content")
        body = BaseSubstackScraper.html_to_md(str(content_element)) if content_element else ""
        md_content = BaseSubstackScraper.combine_metadata_and_content(
            title, subtitle, date, like_count, body
        )
        return {
            "title": title,
            "subtitle": subtitle,
            "like_count": like_count,
            "date": date,
            "body": body,
            "md_content": md_content,
        }

    def extract_post_data(self, soup: BeautifulSoup) -> Tuple[str, str, str, str, str]:
        """
        Converts substack post soup to markdown, returns metadata and content
        """
        post = self.extract_post(soup)
        return (
            post["title"],
            post["subtitle"],
            post["like_count"],
            post["date"],
            post["md_content"],
        )

    @staticmethod
    def invalid_post_reason(post: dict) -> Optional[str]:
        """Return why a scraped post must not replace a good backup, if it is bad."""
        if not post["title"].strip():
            return "missing title"
        if not post["body"].strip():
            return "empty body"
        if not post["date"].strip() or post["date"] == "Date not found":
            return "Date not found"
        return None

    @abstractmethod
    def get_url_soup(self, url: str) -> str:
        raise NotImplementedError

    def scrape_posts(self, num_posts_to_scrape: int = 0) -> None:
        """
        Iterates over all posts and saves them as markdown and html files
        """
        self.essays_data = []
        self.saved_count = 0
        self.skipped_count = 0

        # Full and explicit-list runs always cover every chosen post.
        if self.mode != "feed":
            num_posts_to_scrape = 0

        count = 0
        requests_made = 0
        total = num_posts_to_scrape if num_posts_to_scrape != 0 else len(self.post_urls)
        for url in tqdm(self.post_urls, total=total):
            try:
                md_filename = self.get_filename_from_url(url, filetype=".md")
                html_filename = self.get_filename_from_url(url, filetype=".html")
                md_filepath = os.path.join(self.md_save_dir, md_filename)
                html_filepath = os.path.join(self.html_save_dir, html_filename)

                if os.path.exists(md_filepath):
                    print(f"File already exists: {md_filepath}")
                else:
                    # Be polite between page requests during bulk re-scrapes.
                    if self.mode in ("full", "explicit") and requests_made > 0:
                        time.sleep(0.5)
                    requests_made += 1

                    soup = self.get_url_soup(url)
                    if soup is None:
                        self.skipped_count += 1
                        print(f"⏭️ Skipping post (page unavailable): {url}")
                    else:
                        post = self.extract_post(soup)
                        reason = self.invalid_post_reason(post)

                        if reason:
                            self.skipped_count += 1
                            print(f"⏭️ Skipping post ({reason}): {url}")
                        elif is_test_article(md_filename):
                            self.skipped_count += 1
                            print(f"⏭️ Skipping test article: {post['title']} (from {md_filename})")
                        else:
                            self.save_to_file(md_filepath, post["md_content"])

                            # Convert markdown to HTML and save
                            html_content = self.md_to_html(post["md_content"])
                            self.save_to_html_file(html_filepath, html_content)

                            # Create S3-compatible paths
                            s3_md_path = f"posts/{os.path.basename(self.md_save_dir)}/{md_filename}"
                            s3_html_path = f"posts/{os.path.basename(self.html_save_dir)}/{html_filename}"

                            self.essays_data.append({
                                "title": post["title"],
                                "subtitle": post["subtitle"],
                                "like_count": post["like_count"],
                                "date": post["date"],
                                "file_link": s3_md_path,
                                "html_link": s3_html_path
                            })
                            self.saved_count += 1
            except Exception as e:
                self.skipped_count += 1
                print(f"Error scraping post {url}: {e}")
            count += 1
            if num_posts_to_scrape != 0 and count == num_posts_to_scrape:
                break


class SubstackScraper(BaseSubstackScraper):
    def __init__(
        self,
        base_substack_url: str,
        md_save_dir: str,
        html_save_dir: str,
        mode: str = "feed",
        slugs=None,
    ):
        super().__init__(base_substack_url, md_save_dir, html_save_dir, mode=mode, slugs=slugs)

    def get_url_soup(self, url: str) -> Optional[BeautifulSoup]:
        """
        Gets soup from URL using requests. Rate limits (429) and server errors
        are retried after a pause, because a full re-scrape of ~200 posts
        reliably trips Substack's rate limit.
        """
        try:
            page = fetch_with_retry(url)
            if page.status_code != 200:
                print(f"⚠️ Skipping page {url}: HTTP {page.status_code}")
                return None

            soup = BeautifulSoup(page.content, "html.parser")
            if soup.find("h2", class_="paywall-title"):
                print(f"Skipping premium article: {url}")
                return None
            absolutize_fragment_links(soup, url)
            return soup
        except Exception as e:
            print(f"⚠️ Error fetching page {url}: {e}")
            return None


def start_scraping(
    base_substack_url,
    md_save_dir,
    html_save_dir,
    num_posts_to_scrape=0,
    mode="feed",
    slugs=None,
    return_stats=False,
):
    scraper = SubstackScraper(
        base_substack_url=base_substack_url,
        md_save_dir=md_save_dir,
        html_save_dir=html_save_dir,
        mode=mode,
        slugs=slugs,
    )
    scraper.scrape_posts(num_posts_to_scrape=num_posts_to_scrape)

    if return_stats:
        return {
            "essays": scraper.essays_data,
            "mode": scraper.mode,
            "saved": scraper.saved_count,
            "skipped": scraper.skipped_count,
        }

    return scraper.essays_data

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape a Substack site.")
    parser.add_argument(
        "-u", "--url", type=str, help="The base URL of the Substack site to scrape."
    )
    parser.add_argument(
        "-d", "--directory", type=str, help="The directory to save scraped posts."
    )
    parser.add_argument(
        "-n",
        "--number",
        type=int,
        default=0,
        help="The number of posts to scrape. If 0 or not provided, all posts will be scraped.",
    )
    parser.add_argument(
        "--html-directory",
        type=str,
        help="The directory to save scraped posts as HTML files.",
    )
    parser.add_argument(
        "--mode",
        choices=["feed", "full", "explicit"],
        default="feed",
        help="Which posts to scrape: feed (default), full sitemap, or an explicit list.",
    )
    parser.add_argument(
        "--slugs",
        nargs="+",
        default=None,
        help="Slugs or post URLs to scrape when --mode explicit is used.",
    )

    return parser.parse_args()


def main():
    args = parse_args()

    if args.directory is None:
        args.directory = BASE_MD_DIR

    if args.html_directory is None:
        args.html_directory = BASE_HTML_DIR

    if args.url:
        start_scraping(
            args.url,
            args.directory,
            args.html_directory,
            args.number,
            mode=args.mode,
            slugs=args.slugs,
        )

    else:  # Use the hardcoded values at the top of the file
        start_scraping(
            BASE_SUBSTACK_URL,
            args.directory,
            args.html_directory,
            NUM_POSTS_TO_SCRAPE,
            mode=args.mode,
            slugs=args.slugs,
        )


if __name__ == "__main__":
    main()
