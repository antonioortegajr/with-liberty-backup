#!/usr/bin/env python3
import aws_cdk as cdk
from constructs import Construct
from aws_cdk import (
    Stack,
    aws_lambda as _lambda,
    aws_s3 as s3,
    aws_events as events,
    aws_events_targets as targets,
    aws_iam as iam,
    Duration
)
from aws_cdk import aws_lambda_python_alpha as _lambda_python

class SubstackBackupStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Create new S3 bucket for WithLiberty.HeatherMEdwards subdomain
        bucket = s3.Bucket(
            self, "WithLibertyBucket",
            bucket_name="withliberty.heathermedwards.com",
            website_index_document="index.html",
            website_error_document="index.html",
            public_read_access=True,
            block_public_access=s3.BlockPublicAccess(
                block_public_acls=False,
                block_public_policy=False,
                ignore_public_acls=False,
                restrict_public_buckets=False
            )
        )

        # Lambda Layer for dependencies (for both scraping functions)
        layer = _lambda_python.PythonLayerVersion(
            self,
            "ScraperLayer",
            entry="lambda",  # Only include lambda directory for dependencies
            compatible_runtimes=[_lambda.Runtime.PYTHON_3_11],
        )

        # Original Lambda function (keeping for backward compatibility)
        # This function handles Substack scraping and uploads to the original bucket
        original_lambda_fn = _lambda.Function(
            self, "substack-back-up-original",
            runtime=_lambda.Runtime.PYTHON_3_11,
            handler="lambda_function.lambda_handler",
            code=_lambda.Code.from_asset("lambda"),
            timeout=Duration.minutes(15),
            memory_size=1024,  # Increased memory for scraping
            layers=[layer],
            environment={
                "BUCKET_NAME": "tiny-article-backup",  # Original bucket
                "SUBSTACK_URL": "https://heathermedwards.substack.com/",
                "NUM_POSTS_TO_SCRAPE": "50"
            }
        )

        # New Lambda function for WithLiberty.HeatherMEdwards subdomain - Full Scraping + Static Upload
        withliberty_lambda_fn = _lambda.Function(
            self, "withliberty-static-upload",
            runtime=_lambda.Runtime.PYTHON_3_11,
            handler="lambda.static_upload_lambda.lambda_handler",
            code=_lambda.Code.from_asset(".", exclude=["*.pyc", "__pycache__", "*.git*", "node_modules", "tests", "*.md", "cdk.out", "*.py", "!lambda/*.py", "!static_stie/**"]),
            timeout=Duration.minutes(15),  # Longer timeout for scraping
            memory_size=1024,  # More memory for scraping
            layers=[layer],  # Add the scraping dependencies layer
            environment={
                "BUCKET_NAME": bucket.bucket_name,
                "SUBSTACK_URL": "https://heathermedwards.substack.com/",
                "NUM_POSTS_TO_SCRAPE": "50"
            }
        )

        # Grant S3 permissions
        bucket.grant_write(withliberty_lambda_fn)
        
        # Grant read permissions to the original bucket for copying essays-data.json
        original_bucket = s3.Bucket.from_bucket_name(self, "OriginalBucket", "tiny-article-backup")
        original_bucket.grant_read(withliberty_lambda_fn)
        
        # Daily schedule for Original Lambda (every day at 11 AM UTC)
        original_rule = events.Rule(
            self, "OriginalSubstackTrigger",
            schedule=events.Schedule.cron(minute="0", hour="11")
        )
        original_rule.add_target(targets.LambdaFunction(original_lambda_fn))

        # Daily schedule for WithLiberty Lambda - Static Site Upload (every day at noon UTC)
        withliberty_rule = events.Rule(
            self, "WithLibertyStaticUploadTrigger",
            schedule=events.Schedule.cron(minute="0", hour="12")
        )
        withliberty_rule.add_target(targets.LambdaFunction(withliberty_lambda_fn))
        
        # Output the website URL
        cdk.CfnOutput(
            self, "WebsiteURL",
            value=f"http://{bucket.bucket_name}.s3-website-{self.region}.amazonaws.com",
            description="URL of the static website for WithLiberty.HeatherMEdwards subdomain"
        )
        
        # Output Lambda function information
        cdk.CfnOutput(
            self, "WithLibertyLambdaFunction",
            value=withliberty_lambda_fn.function_name,
            description="Name of the Lambda function for uploading static site files to WithLiberty.HeatherMEdwards"
        )
        
        cdk.CfnOutput(
            self, "OriginalLambdaFunction",
            value=original_lambda_fn.function_name,
            description="Name of the original Lambda function (for backward compatibility)"
        )

app = cdk.App()
SubstackBackupStack(app, "SubstackBackupStack-v2", 
    env=cdk.Environment(region="us-east-1"),
    synthesizer=cdk.DefaultStackSynthesizer(
        qualifier="myapp"
    )
)
app.synth()