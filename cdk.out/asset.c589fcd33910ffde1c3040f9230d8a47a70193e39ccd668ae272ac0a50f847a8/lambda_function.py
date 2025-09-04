import os
import boto3
import shutil
from datetime import datetime
import scrape

def lambda_handler(event, context):
    substack_url = "https://heathermedwards.substack.com/"
    bucket_name = os.environ['BUCKET_NAME']
    
    # Define a temporary directory for the output
    tmp_dir = "/tmp/output"
    if os.path.exists(tmp_dir):
        shutil.rmtree(tmp_dir)
    os.makedirs(tmp_dir)

    # Run the scraper
    scrape.start_scraping(
        base_substack_url=substack_url,
        md_save_dir=tmp_dir,
        html_save_dir=tmp_dir,
        num_posts_to_scrape=0  # Scrape all posts
    )

    # Zip the output and upload to S3
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    zip_file_path = f"/tmp/backup_{timestamp}"
    shutil.make_archive(zip_file_path, 'zip', tmp_dir)

    s3 = boto3.client('s3')
    s3.upload_file(f"{zip_file_path}.zip", bucket_name, f"backup_{timestamp}.zip")

    # Clean up
    shutil.rmtree(tmp_dir)
    os.remove(f"{zip_file_path}.zip")

    return {
        'statusCode': 200,
        'body': f'Scraped content from {substack_url} and uploaded to {bucket_name}'
    }
