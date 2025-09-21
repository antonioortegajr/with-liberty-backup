#!/bin/bash

# Substack Backup Deployment Script
# This script deploys the CDK-based Substack backup system to AWS

set -e  # Exit on any error

echo "🚀 Starting Substack Backup Deployment"
echo "======================================"

# Check if aws-config.env exists
if [ ! -f "aws-config.env" ]; then
    echo "❌ Error: aws-config.env file not found!"
    echo "📋 Please create aws-config.env with your AWS credentials:"
    echo "   Copy example-aws-config.env to aws-config.env"
    echo "   Fill in your actual AWS credentials"
    exit 1
fi

# Load environment variables
echo "📁 Loading AWS configuration..."
source aws-config.env

# Verify required environment variables
if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ] || [ -z "$AWS_DEFAULT_REGION" ]; then
    echo "❌ Error: Missing required AWS environment variables!"
    echo "   Please check your aws-config.env file"
    exit 1
fi

# Set AWS environment variables
export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION

echo "✅ AWS configuration loaded"
echo "   Region: $AWS_DEFAULT_REGION"
echo "   Access Key: ${AWS_ACCESS_KEY_ID:0:8}..."

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ Error: AWS CLI not found!"
    echo "📥 Please install AWS CLI: https://aws.amazon.com/cli/"
    exit 1
fi

# Verify AWS credentials
echo "🔐 Verifying AWS credentials..."
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ Error: Invalid AWS credentials!"
    echo "   Please check your aws-config.env file"
    exit 1
fi

echo "✅ AWS credentials verified"

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    echo "❌ Error: AWS CDK not found!"
    echo "📥 Please install AWS CDK:"
    echo "   npm install -g aws-cdk"
    exit 1
fi

echo "✅ AWS CDK found"

# Bootstrap CDK (if needed)
echo "🔧 Bootstrapping CDK..."
cdk bootstrap

# Install Python dependencies
echo "📦 Installing Python dependencies..."
pip install -r requirements.txt

# Deploy the stack
echo "🚀 Deploying Substack Backup Stack..."
cdk deploy --require-approval never

echo ""
echo "🎉 Deployment completed successfully!"
echo "======================================"
echo "📋 Your Substack backup system is now running on AWS"
echo "🔄 The Lambda function will run weekly to backup articles"
echo "📁 Articles will be stored in the S3 bucket: tiny-article-backup"
echo ""
echo "🔍 To check the deployment:"
echo "   aws lambda list-functions --query 'Functions[?FunctionName==`substack-back-up`]'"
echo "   aws s3 ls s3://tiny-article-backup/"
