# About

## starting Out

For me this proect was a few things. An chance to help a friend, and change for a fun side project, and a chence to vibe code the whole thing from my end.

To skip what I assumed would ba a lot of vibe coding head ache I started with the double great repo from github https://github.com/timf34

Having a solid a proven base was a huge reason I felt I could vibe code the rest easily.

## The Use Case

Writer Heather M. Edwards had the very normal concern with the writing she hadd been doing online. Substack hosted her writing and this meant should something happen to her account or the service there was nothing doing the job of backing up the wrting. This data was at he mercy of the platform it was on.

The challenge became how to back up articles easly.

## The Approcah

This application was againn based on https://github.com/timf34/Substack2Markdown Don't forget to Star!

Then use Cursor to create the infra as code for AWS and deploy.

## The Application

Adapting parts of the orginal repo to run in AWS in a lmabda. This would be the scrape from substack for new articles.

These articles are transformed to markdown files. Then rendered by a statc site hosted on S3.

The back up scrape and storage lambda fires weekely.

## Issues

While Cursor did generate code that used the scrape repo code and did back up code, like most things the devil is in the details. Formaating issures when transfomring the html to markdown, 




