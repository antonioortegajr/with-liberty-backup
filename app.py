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

        # S3 bucket
        bucket = s3.Bucket(self, "substack-articles")

        # Lambda Layer
        layer = _lambda_python.PythonLayerVersion(
            self,
            "ScraperLayer",
            entry=".",
            compatible_runtimes=[_lambda.Runtime.PYTHON_3_11],
        )

        # Lambda function
        lambda_fn = _lambda.Function(
            self, "substack-back-up",
            runtime=_lambda.Runtime.PYTHON_3_11,
            handler="lambda_function.lambda_handler",
            code=_lambda.Code.from_asset("lambda"),
            timeout=Duration.minutes(15),
            memory_size=512,
            layers=[layer],
            environment={
                "BUCKET_NAME": bucket.bucket_name
            }
        )

        # Grant S3 permissions
        bucket.grant_write(lambda_fn)

        # Weekly schedule (Fridays at midnight UTC)
        rule = events.Rule(
            self, "WeeklyTrigger",
            schedule=events.Schedule.cron(minute="0", hour="0", week_day="FRI")
        )
        rule.add_target(targets.LambdaFunction(lambda_fn))

app = cdk.App()
SubstackBackupStack(app, "SubstackBackupStack", env=cdk.Environment(region="us-east-1"))
app.synth()