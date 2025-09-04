import unittest
import requests
import xml.etree.ElementTree as ET
import sys
import os
import shutil

# Add the lambda directory to the python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'lambda')))

class TestLatestArticle(unittest.TestCase):

    def test_latest_article_title(self):
        # Fetch the feed
        feed_url = "https://heathermedwards.substack.com/feed.xml"
        response = requests.get(feed_url)
        self.assertTrue(response.ok)

        # Parse the feed and get the latest article title
        root = ET.fromstring(response.content)
        latest_article_title = root.find('.//item/title').text
        
        self.assertEqual(latest_article_title, "Friends and Trees and Fascism")

if __name__ == '__main__':
    unittest.main()