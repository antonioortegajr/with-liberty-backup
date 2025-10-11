# S3 Bucket Deployment Guide for WithLiberty.HeatherMEdwards

## Overview
This guide will help you deploy the new S3 bucket specifically configured for the `WithLiberty.HeatherMEdwards` subdomain.

## What's Changed
- **New S3 Bucket**: `withliberty.heathermedwards.com` (replaces the old `tiny-article-backup` bucket)
- **New Lambda Function**: `withliberty-static-upload` (uploads static site files to the WithLiberty subdomain)
- **Static Website Hosting**: Configured for hosting static websites
- **Public Access**: Enabled for public read access to serve the website
- **Custom Domain Ready**: Bucket name is optimized for subdomain usage
- **Backward Compatibility**: Original Lambda function is preserved for existing functionality

## Deployment Steps

### 1. Prerequisites
Make sure you have the AWS CDK installed and configured:
```bash
npm install -g aws-cdk
aws configure  # Set up your AWS credentials
```

### 2. Deploy the Stack
```bash
cdk deploy
```

### 3. Verify the Deployment
After deployment, you'll see outputs including:
```
WebsiteURL = http://withliberty.heathermedwards.com.s3-website-us-east-1.amazonaws.com
WithLibertyLambdaFunction = withliberty-static-upload
OriginalLambdaFunction = substack-back-up-original
```

### 4. Test the Bucket
The Lambda function will automatically upload the contents of the `static_stie` directory. You can also manually test by uploading files:
```bash
aws s3 cp static_stie/index.html s3://withliberty.heathermedwards.com/
```

## Lambda Functions

### WithLiberty Lambda Function
- **Name**: `withliberty-static-upload`
- **Purpose**: Uploads static site files from the `static_stie` directory to the WithLiberty.HeatherMEdwards subdomain
- **Target Bucket**: `withliberty.heathermedwards.com`
- **Schedule**: Daily at 12:00 UTC
- **Environment Variables**:
  - `BUCKET_NAME`: `withliberty.heathermedwards.com`

### Original Lambda Function
- **Name**: `substack-back-up-original`
- **Purpose**: Maintains existing functionality
- **Target Bucket**: `tiny-article-backup`
- **Schedule**: Daily at 12:00 UTC
- **Environment Variables**:
  - `BUCKET_NAME`: `tiny-article-backup`
  - `SUBSTACK_URL`: `https://heathermedwards.substack.com/`
  - `NUM_POSTS_TO_SCRAPE`: `50`

## Bucket Configuration Details

### Static Website Hosting
- **Index Document**: `index.html`
- **Error Document**: `index.html` (for SPA routing)
- **Public Access**: Enabled for website hosting

### Security Settings
- Public read access enabled for website hosting
- Block public access settings configured appropriately
- Lambda function has write permissions to upload content

## Custom Domain Setup (Optional)
To use this bucket with a custom domain like `withliberty.heathermedwards.com`:

1. **Route 53 Hosted Zone**: Create a hosted zone for your domain
2. **SSL Certificate**: Request an SSL certificate in ACM
3. **CloudFront Distribution**: Create a CloudFront distribution pointing to the S3 bucket
4. **DNS Records**: Point your domain to the CloudFront distribution

## Troubleshooting

### Common Issues
1. **Bucket Name Conflicts**: If the bucket name is already taken, CDK will append a random suffix
2. **Permissions**: Ensure your AWS credentials have S3 and Lambda permissions
3. **Region**: The bucket is created in `us-east-1` by default

### Verification Commands
```bash
# Check if bucket exists
aws s3 ls s3://withliberty.heathermedwards.com/

# Test website access
curl http://withliberty.heathermedwards.com.s3-website-us-east-1.amazonaws.com
```

## Next Steps
1. Deploy the stack using `cdk deploy`
2. Test the website URL
3. Configure your domain DNS if needed
4. Monitor the Lambda function logs for successful content uploads
