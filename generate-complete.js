const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');

/**
 * Complete Article Generation System
 * 
 * This self-contained function generates all necessary files for displaying articles:
 * - essays-data.json: Complete metadata with titles, dates, and file links
 * - file-list.json: Simple array of markdown filenames
 * 
 * Combines functionality from:
 * - generate-metadata.js
 * - generate-file-list.js  
 * - generate-all.js
 * 
 * Optional S3 upload functionality for testing/deployment
 */

// S3 configuration (optional)
const S3_BUCKET = process.env.S3_BUCKET || 'substack-articles';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const UPLOAD_TO_S3 = process.env.UPLOAD_TO_S3 === 'true';

function generateCompleteArticleSystem() {
    console.log('🚀 Starting complete article generation system...\n');
    
    // Step 1: File Discovery
    console.log('📋 Step 1: Discovering markdown files...');
    const files = fs.readdirSync('.');
    const markdownFiles = files.filter(file => 
        file.endsWith('.md') && 
        file !== 'README.md' && 
        !file.startsWith('.') &&
        !file.toLowerCase().includes('test')
    );
    
    console.log(`Found ${markdownFiles.length} markdown files`);
    
    // Step 2: Metadata Extraction Function
    function extractMetadata(content, filename) {
        const lines = content.split('\n');
        let title = '';
        let subtitle = '';
        let date = '';
        let likeCount = '0';
        
        // Extract title from first line (usually starts with #)
        for (let i = 0; i < Math.min(10, lines.length); i++) {
            const line = lines[i].trim();
            if (line.startsWith('# ')) {
                title = line.substring(2).trim();
                break;
            } else if (line.startsWith('## ')) {
                title = line.substring(3).trim();
                break;
            }
        }
        
        // If no title found, use filename
        if (!title) {
            title = filename.replace('.md', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }
        
        // Try to extract subtitle from second heading
        for (let i = 0; i < Math.min(20, lines.length); i++) {
            const line = lines[i].trim();
            if (line.startsWith('### ') && !subtitle) {
                subtitle = line.substring(4).trim();
                break;
            }
        }
        
        // Try to extract date from file content (look for date patterns)
        // First look for the **Date** format used in these files
        for (let i = 0; i < Math.min(30, lines.length); i++) {
            const line = lines[i].trim();
            if (line.startsWith('**') && line.includes('**') && line.match(/\d{4}/)) {
                // Extract date from **May 10, 2025** format
                const dateMatch = line.match(/\*\*(.*?)\*\*/);
                if (dateMatch) {
                    date = dateMatch[1].trim();
                    break;
                }
            }
        }
        
        // If no date found in ** format, try other patterns
        if (!date) {
            const datePatterns = [
                /(\w{3}\s+\d{1,2},\s+\d{4})/,
                /(\d{1,2}\/\d{1,2}\/\d{4})/,
                /(\d{4}-\d{2}-\d{2})/
            ];
            
            for (let i = 0; i < Math.min(30, lines.length); i++) {
                const line = lines[i];
                for (const pattern of datePatterns) {
                    const match = line.match(pattern);
                    if (match) {
                        date = match[1];
                        break;
                    }
                }
                if (date) break;
            }
        }
        
        // If no date found, use file modification date or default
        if (!date) {
            try {
                const stats = fs.statSync(filename);
                date = stats.mtime.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                });
            } catch (error) {
                date = 'Date not found';
            }
        }
        
        return {
            title: title,
            subtitle: subtitle,
            like_count: likeCount,
            date: date,
            file_link: filename,
            html_link: filename.replace('.md', '.html')
        };
    }
    
    // Step 3: Process All Markdown Files
    console.log('📊 Step 2: Processing markdown files and extracting metadata...');
    const essays = [];
    const errors = [];
    
    for (const filename of markdownFiles) {
        try {
            const content = fs.readFileSync(filename, 'utf8');
            const metadata = extractMetadata(content, filename);
            
            // Filter out test articles
            const titleLower = metadata.title.toLowerCase();
            if (titleLower.includes('test')) {
                console.log(`⏭️  Skipping test article: ${metadata.title} (from ${filename})`);
                continue;
            }
            
            essays.push(metadata);
            console.log(`✓ Processed: ${filename}`);
        } catch (error) {
            console.error(`✗ Error processing ${filename}:`, error.message);
            errors.push({ filename, error: error.message });
        }
    }
    
    // Step 4: Sort Essays by Date (Newest First)
    console.log('📅 Step 3: Sorting essays by date...');
    essays.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
            return 0; // Keep original order for invalid dates
        }
        return dateB - dateA; // Newest first
    });
    
    // Step 5: Generate File List
    console.log('📝 Step 4: Generating file list...');
    const fileList = markdownFiles.sort(); // Alphabetical order for file list
    
    // Step 6: Write Output Files
    console.log('💾 Step 5: Writing output files...');
    
    // Write essays-data.json
    try {
        fs.writeFileSync('essays-data.json', JSON.stringify(essays, null, 2));
        console.log(`✓ Generated essays-data.json with ${essays.length} essays`);
    } catch (error) {
        console.error('✗ Error writing essays-data.json:', error.message);
    }
    
    // Write file-list.json
    try {
        fs.writeFileSync('file-list.json', JSON.stringify(fileList, null, 2));
        console.log(`✓ Generated file-list.json with ${fileList.length} files`);
    } catch (error) {
        console.error('✗ Error writing file-list.json:', error.message);
    }
    
    // Step 7: Validation and Summary
    console.log('\n✅ Step 6: Validation and summary...');
    console.log(`Total markdown files found: ${markdownFiles.length}`);
    console.log(`Total essays processed: ${essays.length}`);
    console.log(`Processing errors: ${errors.length}`);
    
    if (errors.length > 0) {
        console.log('\n⚠️  Processing errors:');
        errors.forEach(err => {
            console.log(`  - ${err.filename}: ${err.error}`);
        });
    }
    
    // Show sample entries
    console.log('\n📝 Sample essay entries:');
    essays.slice(0, 5).forEach((essay, index) => {
        console.log(`  ${index + 1}. ${essay.title} (${essay.date})`);
    });
    
    // Show date range
    const validDates = essays.filter(e => e.date !== 'Date not found' && new Date(e.date).getTime());
    if (validDates.length > 0) {
        const dates = validDates.map(e => new Date(e.date));
        const newest = new Date(Math.max(...dates));
        const oldest = new Date(Math.min(...dates));
        console.log(`\n📅 Date range: ${oldest.toLocaleDateString()} to ${newest.toLocaleDateString()}`);
    }
    
    // Show file list sample
    console.log('\n📁 Sample file list entries:');
    fileList.slice(0, 5).forEach((file, index) => {
        console.log(`  ${index + 1}. ${file}`);
    });
    
    // Step 8: Optional S3 Upload
    if (UPLOAD_TO_S3) {
        console.log('\n☁️  Step 7: Uploading to S3...');
        try {
            uploadToS3(essays, fileList);
            console.log('✓ Successfully uploaded files to S3');
        } catch (error) {
            console.error('✗ Error uploading to S3:', error.message);
        }
    }
    
    console.log('\n🎉 Complete article generation system finished successfully!');
    console.log('Generated files:');
    console.log('  - essays-data.json (complete metadata)');
    console.log('  - file-list.json (markdown filenames)');
    if (UPLOAD_TO_S3) {
        console.log('  - Uploaded to S3 bucket:', S3_BUCKET);
    }
    
    // Return summary object for programmatic use
    return {
        success: true,
        essaysCount: essays.length,
        filesCount: fileList.length,
        errorsCount: errors.length,
        errors: errors,
        newestEssay: essays[0] || null,
        oldestEssay: essays[essays.length - 1] || null,
        generatedFiles: ['essays-data.json', 'file-list.json'],
        uploadedToS3: UPLOAD_TO_S3
    };
}

function uploadToS3(essays, fileList) {
    // Upload essays-data.json and file-list.json to S3
    
    // Configure AWS SDK
    AWS.config.update({ region: AWS_REGION });
    const s3 = new AWS.S3();
    
    // Upload essays-data.json
    const essaysParams = {
        Bucket: S3_BUCKET,
        Key: 'essays-data.json',
        Body: JSON.stringify(essays, null, 2),
        ContentType: 'application/json'
    };
    
    // Upload file-list.json
    const fileListParams = {
        Bucket: S3_BUCKET,
        Key: 'file-list.json',
        Body: JSON.stringify(fileList, null, 2),
        ContentType: 'application/json'
    };
    
    return Promise.all([
        s3.upload(essaysParams).promise(),
        s3.upload(fileListParams).promise()
    ]);
}

// Export the function for use in other modules
module.exports = { generateCompleteArticleSystem, uploadToS3 };

// Run the function if this file is executed directly
if (require.main === module) {
    generateCompleteArticleSystem();
}
