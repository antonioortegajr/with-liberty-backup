import os
import boto3
import json
from pathlib import Path

def lambda_handler(event, context):
    """
    Lambda function to upload static site files from static_site directory to S3 bucket.
    This function uploads the contents of the static_site directory to the top level
    of the withliberty.heathermedwards.com S3 bucket.
    """
    try:
        print("🚀 Static Site Upload Lambda started")
        
        bucket_name = os.environ.get('BUCKET_NAME', 'withliberty.heathermedwards.com')
        print(f"🪣 S3 Bucket: {bucket_name}")
        
        s3 = boto3.client('s3')
        
        # Define the static_site directory path
        # In Lambda, the static_site directory will be at the root level
        static_site_dir = Path('/opt/static_stie')  # Note: using the actual directory name from the project
        
        # If not found in /opt, try relative path (for local testing)
        if not static_site_dir.exists():
            static_site_dir = Path('static_stie')  # Note: using the actual directory name from the project
        
        if not static_site_dir.exists():
            print(f"❌ Static site directory not found: {static_site_dir}")
            return {
                'statusCode': 500,
                'body': f'Static site directory not found: {static_site_dir}'
            }
        
        print(f"📁 Static site directory: {static_site_dir}")
        
        # Upload all files from static_site directory
        uploaded_files = []
        total_files = 0
        
        for root, dirs, files in os.walk(static_site_dir):
            for file in files:
                total_files += 1
                local_file_path = os.path.join(root, file)
                
                # Calculate relative path from static_site directory
                rel_path = os.path.relpath(local_file_path, static_site_dir)
                
                # For the S3 key, we want files at the top level, so just use the filename
                # if it's in the root of static_site, or preserve the directory structure
                if os.path.dirname(rel_path) == '.':
                    s3_key = file
                else:
                    s3_key = rel_path
                
                try:
                    # Determine content type based on file extension
                    content_type = 'text/html'
                    if file.endswith('.css'):
                        content_type = 'text/css'
                    elif file.endswith('.js'):
                        content_type = 'application/javascript'
                    elif file.endswith('.json'):
                        content_type = 'application/json'
                    elif file.endswith('.png'):
                        content_type = 'image/png'
                    elif file.endswith('.jpg') or file.endswith('.jpeg'):
                        content_type = 'image/jpeg'
                    elif file.endswith('.gif'):
                        content_type = 'image/gif'
                    elif file.endswith('.svg'):
                        content_type = 'image/svg+xml'
                    elif file.endswith('.ico'):
                        content_type = 'image/x-icon'
                    
                    # Upload file to S3
                    s3.upload_file(
                        local_file_path,
                        bucket_name,
                        s3_key,
                        ExtraArgs={'ContentType': content_type}
                    )
                    
                    uploaded_files.append(s3_key)
                    print(f"✅ Uploaded: {s3_key} ({content_type})")
                    
                except Exception as e:
                    print(f"❌ Error uploading {s3_key}: {str(e)}")
        
        print(f"📤 Successfully uploaded {len(uploaded_files)} out of {total_files} files")
        
        # List uploaded files for verification
        print("📋 Uploaded files:")
        for file in uploaded_files:
            print(f"   - {file}")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': f'Successfully uploaded {len(uploaded_files)} static site files to {bucket_name}',
                'uploaded_files': uploaded_files,
                'total_files': total_files
            })
        }
        
    except Exception as e:
        print(f"❌ Error in Static Upload Lambda: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e),
                'message': 'Failed to upload static site files'
            })
        }
