let showHTML = false; // Default to showing markdown since we're loading from markdown files
let essaysData = [];
let currentArticle = null;

// Simple markdown to HTML converter
function markdownToHtml(markdown) {
    let html = markdown;
    
    // Remove likes lines
    html = html.replace(/^\*\*Likes:\*\*\s*\d+\s*$/gm, '');
    
    // Convert headers with descriptive IDs
    html = html.replace(/^### (.*$)/gim, (match, title) => {
        const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return `<h3 id="section-${id}">${title}</h3>`;
    });
    
    html = html.replace(/^## (.*$)/gim, (match, title) => {
        const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return `<h2 id="section-${id}">${title}</h2>`;
    });
    
    html = html.replace(/^# .*$/gm, ''); // Remove entire h1 header lines completely
    
    // Convert bold with semantic class
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="emphasis">$1</strong>');
    
    // Convert italic with semantic class
    html = html.replace(/\*(.*?)\*/g, '<em class="emphasis">$1</em>');
    
    // Convert links with enhanced attributes
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="external-link">$1</a>');
    
    // Convert images with enhanced attributes
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="article-image" style="max-width: 100%; height: auto; display: block; margin: 20px auto;">');
    
    // Convert line breaks with semantic structure
    html = html.replace(/\n\n/g, '</p><p class="paragraph">');
    html = html.replace(/\n/g, '<br>');
    
    // Clean up empty paragraphs
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p><br><\/p>/g, '');
    
    // Add semantic classes to existing paragraphs
    html = html.replace(/<p>/g, '<p class="paragraph">');
    
    return html;
}

function sortEssaysByDate(data, ascending = false) {
    return data.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        const isValidDateA = !isNaN(dateA.getTime());
        const isValidDateB = !isNaN(dateB.getTime());
        
        // If both dates are invalid, keep original order
        if (!isValidDateA && !isValidDateB) {
            return 0;
        }
        
        // If only one date is invalid, put the invalid one at the end
        if (!isValidDateA) {
            return 1; // Put invalid date at the end
        }
        if (!isValidDateB) {
            return -1; // Put invalid date at the end
        }
        
        // Both dates are valid, sort normally
        return ascending ? dateA - dateB : dateB - dateA;
    });
}

function updateArticleCount(count) {
    const articleCountElement = document.getElementById('article-count');
    if (articleCountElement) {
        const articleText = count === 1 ? 'article' : 'articles';
        articleCountElement.textContent = `${count} ${articleText} published`;
    }
}



function populateEssays(data) {
    // Sort essays by date (most recent first)
    const sortedData = sortEssaysByDate([...data], false);
    
    // Update article count in footer
    updateArticleCount(sortedData.length);
    
    const essaysContainer = document.getElementById('essays-container');
    const list = sortedData.map((essay, index) => {
        const essayId = essay.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return `
        <li id="essay-item-${essayId}" class="essay-item">
            <a href="#" class="essay-link" data-filename="${essay.file_link}" id="essay-link-${essayId}" aria-describedby="essay-subtitle-${essayId} essay-date-${essayId}">${essay.title}</a>
            <div id="essay-subtitle-${essayId}" class="subtitle">${essay.subtitle}</div>
            <time id="essay-date-${essayId}" class="metadata" datetime="${essay.date}">${essay.date}</time>
        </li>
    `}).join('');
    essaysContainer.innerHTML = `<ul id="essays-list" class="essays-list">${list}</ul>`;
    
    // Add click handlers for essay links
    document.querySelectorAll('.essay-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const filename = e.target.getAttribute('data-filename');
            loadAndDisplayArticle(filename);
        });
        
        // Add touch event handling for better mobile experience
        link.addEventListener('touchstart', (e) => {
            e.target.style.opacity = '0.7';
        });
        
        link.addEventListener('touchend', (e) => {
            e.target.style.opacity = '1';
        });
    });
}

async function loadAndDisplayArticle(filename) {
    try {
        // Show loading message
        const essaysContainer = document.getElementById('essays-container');
        essaysContainer.innerHTML = '<div id="loading">Loading article...</div>';
        
        // Fetch the markdown content
        const response = await fetch(filename);
        if (!response.ok) {
            throw new Error(`Failed to load article: ${response.status}`);
        }
        
        const markdownContent = await response.text();
        
        // Convert markdown to HTML
        const htmlContent = markdownToHtml(markdownContent);
        
        // Find the essay data for this file
        const essay = essaysData.find(e => e.file_link === filename);
        
        // Display the article
        displayArticle(essay, htmlContent);
        
    } catch (error) {
        console.error('Error loading article:', error);
        const essaysContainer = document.getElementById('essays-container');
        essaysContainer.innerHTML = '<div class="error">Error loading article. Please try again.</div>';
    }
}

function displayArticle(essay, htmlContent) {
    const essaysContainer = document.getElementById('essays-container');
    
    // Create a URL-friendly ID for the article
    const articleId = essay.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    
    const articleHtml = `
        <article id="article-${articleId}" class="article-view">
            <header class="article-header">
                <button class="back-button" onclick="showEssayList()" aria-label="Return to essays list">← Back to Essays</button>
                <h1 id="article-title-${articleId}" class="article-title">${essay.title}</h1>
                <div id="article-subtitle-${articleId}" class="article-subtitle">${essay.subtitle}</div>
                <time id="article-date-${articleId}" class="article-metadata" datetime="${essay.date}">${essay.date}</time>
            </header>
            <main id="article-content-${articleId}" class="article-content">
                ${htmlContent}
            </main>
        </article>
    `;
    
    essaysContainer.innerHTML = articleHtml;
    currentArticle = essay;
}

function showEssayList() {
    populateEssays(essaysData);
    currentArticle = null;
}

// Main initialization function
async function initializeEssays() {
    try {
        // Show loading message
        const loadingElement = document.getElementById('loading');
        if (loadingElement) {
            loadingElement.textContent = 'Loading essays...';
        }
        
        // Load pre-generated data from essays-data.json
        const response = await fetch('./essays-data.json');
        if (!response.ok) {
            throw new Error(`Failed to load essays data: ${response.status}`);
        }
        
        essaysData = await response.json();
        
        // Filter out unwanted articles
        essaysData = essaysData.filter(essay => 
            essay.title !== "Page not found" && 
            essay.title !== "Coming Soon"
        );
        
        // Remove loading message and populate essays
        if (loadingElement) {
            loadingElement.remove();
        }
        
        populateEssays(essaysData);
        
        // Social media links are handled by HTML anchor tags


        
    } catch (error) {
        console.error('Error initializing essays:', error);
        const essaysContainer = document.getElementById('essays-container');
        essaysContainer.innerHTML = '<div class="error">Error loading essays. Please try refreshing the page.</div>';
        updateArticleCount(0);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeEssays);
