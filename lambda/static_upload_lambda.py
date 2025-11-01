import os
import boto3
import json
import re
import tempfile
from datetime import datetime
from pathlib import Path
from scrape import start_scraping

def extract_metadata_from_content(content, filename):
    """Extract metadata from markdown content using improved logic"""
    lines = content.split('\n')
    title = ''
    subtitle = ''
    date = ''
    like_count = '0'
    
    # Extract title from first line (usually starts with #)
    for i in range(min(10, len(lines))):
        line = lines[i].strip()
        if line.startswith('# '):
            title = line[2:].strip()
            break
        elif line.startswith('## '):
            title = line[3:].strip()
            break
    
    # If no title found, use filename
    if not title:
        title = filename.replace('.md', '').replace('-', ' ').replace('_', ' ')
        title = ' '.join(word.capitalize() for word in title.split())
    
    # Try to extract subtitle from second heading
    for i in range(min(20, len(lines))):
        line = lines[i].strip()
        if line.startswith('### ') and not subtitle:
            subtitle = line[4:].strip()
            break
    
    # Try to extract date from file content (look for date patterns)
    # First look for the **Date** format used in these files
    for i in range(min(30, len(lines))):
        line = lines[i].strip()
        if line.startswith('**') and '**' in line and re.search(r'\d{4}', line):
            # Extract date from **May 10, 2025** format
            date_match = re.search(r'\*\*(.*?)\*\*', line)
            if date_match:
                date = date_match.group(1).strip()
                break
    
    # If no date found in ** format, try other patterns
    if not date:
        date_patterns = [
            r'(\w{3}\s+\d{1,2},\s+\d{4})',
            r'(\d{1,2}/\d{1,2}/\d{4})',
            r'(\d{4}-\d{2}-\d{2})'
        ]
        
        for i in range(min(30, len(lines))):
            line = lines[i]
            for pattern in date_patterns:
                match = re.search(pattern, line)
                if match:
                    date = match.group(1)
                    break
            if date:
                break
    
    # Look for like count
    for i in range(min(30, len(lines))):
        line = lines[i]
        like_match = re.search(r'\*\*Likes:\*\*\s*(\d+)', line)
        if like_match:
            like_count = like_match.group(1)
            break
    
    # If no date found, use default
    if not date:
        date = 'Date not found'
    
    return {
        'title': title,
        'subtitle': subtitle,
        'like_count': like_count,
        'date': date
    }

def upload_file_to_s3(s3_client, bucket_name, local_file_path, s3_key):
    """Upload a local file to S3"""
    try:
        s3_client.upload_file(local_file_path, bucket_name, s3_key)
        print(f"✅ Uploaded {s3_key}")
        return True
    except Exception as e:
        print(f"❌ Error uploading {s3_key}: {str(e)}")
        return False

def lambda_handler(event, context):
    """
    Lambda function to do full scraping + static site upload for WithLiberty.HeatherMEdwards subdomain.
    This function:
    1. Scrapes Substack content (like the original system)
    2. Uploads static site files
    3. Generates metadata for the website
    """
    try:
        print("🚀 WithLiberty Scraping + Static Upload Lambda started")
        
        bucket_name = os.environ.get('BUCKET_NAME', 'withliberty.heathermedwards.com')
        substack_url = os.environ.get('SUBSTACK_URL', 'https://heathermedwards.substack.com/')
        num_posts = int(os.environ.get('NUM_POSTS_TO_SCRAPE', '50'))
        
        print(f"🪣 S3 Bucket: {bucket_name}")
        print(f"📰 Substack URL: {substack_url}")
        print(f"📊 Number of posts to scrape: {num_posts}")

        s3 = boto3.client('s3')
        
        # Create temporary directories for scraping
        with tempfile.TemporaryDirectory() as temp_dir:
            md_dir = os.path.join(temp_dir, 'md_files')
            html_dir = os.path.join(temp_dir, 'html_files')
            os.makedirs(md_dir, exist_ok=True)
            os.makedirs(html_dir, exist_ok=True)
            
            print("🕷️ Starting Substack scraping...")
            
            # Scrape new articles from Substack
            try:
                essays_data = start_scraping(
                    base_substack_url=substack_url,
                    md_save_dir=md_dir,
                    html_save_dir=html_dir,
                    num_posts_to_scrape=num_posts
                )
                print(f"✅ Scraped {len(essays_data)} new articles")
            except Exception as e:
                print(f"❌ Error during scraping: {str(e)}")
                essays_data = []
            
            # Upload new markdown and HTML files to S3
            print("📤 Uploading new articles to S3...")
            uploaded_files = []
            
            # Upload markdown files
            for root, dirs, files in os.walk(md_dir):
                for file in files:
                    if file.endswith('.md'):
                        # Filter out test articles (safety check - shouldn't happen due to scraping filter)
                        if 'test' in file.lower():
                            print(f"⏭️ Skipping test article upload: {file}")
                            continue
                        
                        local_path = os.path.join(root, file)
                        # Save directly at top level - use just the filename
                        s3_key = file
                        
                        if upload_file_to_s3(s3, bucket_name, local_path, s3_key):
                            uploaded_files.append(s3_key)
            
            # HTML files are no longer uploaded - only markdown files are needed
            
            print(f"📤 Uploaded {len(uploaded_files)} new files to S3")
        
        # Now process ALL articles (existing + new) to create updated JSON
        print("🔍 Finding all .md files in S3 bucket...")
        
        all_md_files = []
        page_count = 0
        
        # Use paginator to get ALL objects
        paginator = s3.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=bucket_name)
        
        for page in pages:
            page_count += 1
            page_md_count = 0
            
            if 'Contents' in page:
                for obj in page['Contents']:
                    if obj['Key'].endswith('.md'):
                        all_md_files.append(obj['Key'])
                        page_md_count += 1
                
                print(f"📄 Page {page_count}: Found {page_md_count} .md files")
        
        total_articles = len(all_md_files)
        print(f"📊 Total .md files found: {total_articles}")
        
        # Process each .md file to extract metadata
        print("📝 Extracting metadata from .md files...")
        essays_data = []
        processed_files = set()  # Track processed files to avoid duplicates
        processed_titles = set()  # Track processed titles to avoid content duplicates
        
        for md_file in all_md_files:
            # Skip if we've already processed this file
            if md_file in processed_files:
                print(f"⏭️ Skipping duplicate file: {md_file}")
                continue
            
            processed_files.add(md_file)
            try:
                # Download the .md file content
                response = s3.get_object(Bucket=bucket_name, Key=md_file)
                content = response['Body'].read().decode('utf-8')
                
                # Extract metadata using improved logic
                filename = os.path.basename(md_file)
                metadata = extract_metadata_from_content(content, filename)
                
                # Check for duplicate title (case-insensitive)
                title_lower = metadata['title'].lower().strip()
                if title_lower in processed_titles:
                    print(f"⏭️ Skipping duplicate title: {metadata['title']} (from {filename})")
                    continue
                
                processed_titles.add(title_lower)
                
                # Add file links
                metadata['file_link'] = md_file
                
                essays_data.append(metadata)
                print(f"✅ Processed: {filename} - {metadata['title']} ({metadata['date']})")
                
            except Exception as e:
                print(f"❌ Error processing {md_file}: {str(e)}")
                # Add a basic entry even if processing fails
                filename = os.path.basename(md_file)
                essays_data.append({
                    'title': filename.replace('.md', '').replace('-', ' ').title(),
                    'subtitle': '',
                    'like_count': '0',
                    'date': 'Date not found',
                    'file_link': md_file
                })
        
        # Sort essays by date (newest first)
        def sort_key(essay):
            try:
                if essay['date'] == 'Date not found':
                    return datetime.min
                return datetime.strptime(essay['date'], '%b %d, %Y')
            except:
                return datetime.min
        
        essays_data.sort(key=sort_key, reverse=True)
        
        # Create file-list.json (just the filenames)
        file_list = [os.path.basename(f) for f in all_md_files]
        file_list.sort()
        
        # Upload essays-data.json
        print("📤 Uploading essays-data.json...")
        essays_json = json.dumps(essays_data, indent=2)
        s3.put_object(
            Bucket=bucket_name,
            Key='essays-data.json',
            Body=essays_json,
            ContentType='application/json'
        )
        
        # Upload file-list.json
        print("📤 Uploading file-list.json...")
        file_list_json = json.dumps(file_list, indent=2)
        s3.put_object(
            Bucket=bucket_name,
            Key='file-list.json',
            Body=file_list_json,
            ContentType='application/json'
        )
        
        # Upload static site files
        print("📤 Uploading static site files...")
        static_site_dir = Path('static_stie')
        static_files_uploaded = []
        
        if static_site_dir.exists():
            for root, dirs, files in os.walk(static_site_dir):
                for file in files:
                    local_file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(local_file_path, static_site_dir)
                    
                    # Determine content type
                    content_type = 'text/html'
                    if file.endswith('.css'):
                        content_type = 'text/css'
                    elif file.endswith('.js'):
                        content_type = 'application/javascript'
                    elif file.endswith('.json'):
                        content_type = 'application/json'
                    
                    # Upload file to S3
                    s3_key = rel_path if os.path.dirname(rel_path) != '.' else file
                    s3.upload_file(
                        local_file_path,
                        bucket_name,
                        s3_key,
                        ExtraArgs={'ContentType': content_type}
                    )
                    static_files_uploaded.append(s3_key)
                    print(f"✅ Uploaded static file: {s3_key}")
        
        unique_articles = len(essays_data)
        duplicates_skipped = total_articles - unique_articles
        
        print(f"✅ Successfully processed {unique_articles} unique articles")
        if duplicates_skipped > 0:
            print(f"⏭️ Skipped {duplicates_skipped} duplicate articles")
        print(f"✅ Uploaded essays-data.json with {len(essays_data)} essays")
        print(f"✅ Uploaded file-list.json with {len(file_list)} files")
        print(f"✅ Uploaded {len(static_files_uploaded)} static site files")
        
        # Show sample of processed articles
        print("📝 Sample processed articles:")
        for i, essay in enumerate(essays_data[:5], 1):
            print(f"   {i}. {essay['title']} ({essay['date']})")
        
        return {
            'statusCode': 200,
            'body': f'Successfully scraped new articles and processed {unique_articles} total articles (skipped {duplicates_skipped} duplicates) with updated JSON files and static site files in {bucket_name}'
        }
        
    except Exception as e:
        print(f"❌ Error in WithLiberty Lambda function: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'statusCode': 500,
            'body': f'Error: {str(e)}'
        }