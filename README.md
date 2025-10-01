# with-liberty-backup

A comprehensive system for backing up Substack articles and generating a static website with JSON metadata files.

Read more about this project in the ABOUT.md doc

## Features

- **Automated Substack Scraping**: Scrapes articles from any Substack publication
- **Multiple Output Formats**: Generates both Markdown and HTML versions of articles
- **JSON Metadata Generation**: Creates `essays-data.json` and `file-list.json` for easy consumption
- **S3 Integration**: Automatically uploads all files to AWS S3
- **Static Website Generation**: Creates a complete static website with sorting and filtering capabilities
- **AWS Lambda Deployment**: Runs on a scheduled basis using AWS Lambda and EventBridge

## Generated Files

### JSON Files
- **`essays-data.json`**: Complete metadata for all articles including:
  - Title and subtitle
  - Publication date
  - Like count
  - File links (both Markdown and HTML)
- **`file-list.json`**: Simple array of Markdown filenames

### Web App Files
- **`index.html`**: Main website with article listing
- **`assets/js/populate-essays.js`**: JavaScript for sorting and filtering
- **`assets/css/style.css`**: Styling for the website

## Usage

### Local Development

1. Install dependencies:
```bash
npm install
pip install -r requirements.txt
```

2. Generate JSON files locally:
```bash
node generate-complete.js
```

3. Generate and upload to S3:
```bash
UPLOAD_TO_S3=true node generate-complete.js
```

4. Test the functionality:
```bash
node test-json-generation.js
```

### AWS Deployment

1. Deploy the CDK stack:
```bash
cdk deploy
```

2. The Lambda function will run weekly (Fridays at midnight UTC) and automatically:
   - Scrape the configured Substack
   - Generate all JSON files
   - Upload everything to S3
   - Create the static website

## Configuration

Set environment variables for S3 upload:
- `S3_BUCKET`: S3 bucket name (default: 'substack-articles')
- `AWS_REGION`: AWS region (default: 'us-east-1')
- `UPLOAD_TO_S3`: Set to 'true' to enable S3 upload

## Project Structure

```
├── lambda/
│   ├── lambda_function.py    # Main Lambda function
│   └── scrape.py            # Substack scraping logic
├── generate-complete.js     # Local JSON generation script
├── test-json-generation.js  # Test script
├── app.py                   # CDK infrastructure
├── requirements.txt         # Python dependencies
├── package.json            # Node.js dependencies
└── README.md               # This file
```