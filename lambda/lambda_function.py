import boto3
import os
from datetime import datetime

def lambda_handler(event, context):
    s3 = boto3.client('s3')
    bucket_name = os.environ['BUCKET_NAME']
    
    # Create a sample file
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    file_content = f"Substack backup created at {timestamp}"
    
    # Upload to S3
    s3.put_object(
        Bucket=bucket_name,
        Key=f"backup_{timestamp}.txt",
        Body=file_content
    )
    
    return {
        'statusCode': 200,
        'body': f'File uploaded to {bucket_name}'
    }
