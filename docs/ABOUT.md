# About

## Starting Out

For me this proect was a few things. An chance to help a friend, and change for a fun side project, and a chence to vibe code the whole thing from my end.

To skip what I assumed would ba a lot of vibe coding head ache I started with the double great repo from github https://github.com/timf34

Having a solid a proven base was a huge reason I felt I could vibe code the rest easily.

## The Use Case

Writer Heather M. Edwards https://www.heathermedwards.com/ had the very normal concern with the writing she hadd been doing online. Substack hosted her writing and this meant should something happen to her account or the service there was nothing doing the job of backing up the wrting. This data was at he mercy of the platform it was on.

The challenge became how to back up articles easly.

## The Approcah

This application was againn based on https://github.com/timf34/Substack2Markdown Don't forget to ⭐!

Then use Cursor to create the infra as code for AWS and deploy.

New features were also nearly completly dobe via Cursor.

## The Application

Adapting parts of the orginal repo to run in AWS in a lambda. This would be the scrape from substack for new articles.

These articles are transformed to markdown files. Then rendered by a statc site hosted on S3.

The back up scrape and storage lambda fires weekely.

## Issues

While Cursor did generate code that used the scrape repo code and did back up code, like most things the devil is in the details. Formaating issures when transfomring the html to markdown.

A few new features to the site generation and presentation were made as well.

This was not difficult thanks to the sold foundation application already created.

## Results

A static site on S3 that auto updates with new stored mardown files. The author does not have to do anything further at all.

The inital back up was done by hand using the orginal repo and the logged scrape. This allowed the capture of many many articles.
The ongoing back up does not use the logged in scrape.

This system works well and has quickly moved into the features phase. I do think this repo could be easly adapted for other people use.

** Every click is friction - minimize the number of clicks to get from one place to the next




