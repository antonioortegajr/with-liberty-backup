let showHTML = false; // Default to showing markdown since we're loading from markdown files
let essaysData = [];
let currentArticle = null;

const ESSAYS_PER_PAGE = 20;

// URL Routing Functions
function getArticleSlugFromUrl() {
    const hash = window.location.hash;
    return hash ? hash.substring(1) : null;
}

function getRequestedPage() {
    const rawPage = new URLSearchParams(window.location.search).get('page');
    if (rawPage === null || !/^\d+$/.test(rawPage)) {
        return 1;
    }
    const page = parseInt(rawPage, 10);
    return page > 0 ? page : 1;
}

function normalizePage(page, totalPages) {
    if (!Number.isInteger(page) || page < 1 || page > totalPages) {
        return 1;
    }
    return page;
}

function getTotalPages(list) {
    return Math.max(1, Math.ceil(list.length / ESSAYS_PER_PAGE));
}

function buildListUrl() {
    return `${window.location.pathname}${window.location.search}`;
}

function buildArticleUrl(slug) {
    return `${buildListUrl()}#${slug}`;
}

function buildPageUrl(page) {
    const params = new URLSearchParams(window.location.search);
    params.set('page', String(page));
    return `${window.location.pathname}?${params.toString()}`;
}

function updateUrlForArticle(slug, replace = false) {
    const url = slug ? buildArticleUrl(slug) : buildListUrl();
    const state = slug ? { slug } : {};
    if (replace) {
        window.history.replaceState(state, '', url);
    } else {
        window.history.pushState(state, '', url);
    }
}

function generateArticleSlug(title) {
    return title.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function handleUrlNavigation(options = {}) {
    const { updateHistory = true } = options;
    const slug = getArticleSlugFromUrl();
    if (slug) {
        // Find article by slug
        const article = essaysData.find(essay => 
            generateArticleSlug(essay.title) === slug
        );
        if (article) {
            loadAndDisplayArticle(article.file_link, slug, { updateHistory });
        } else {
            // Invalid slug, return to list
            showEssayList({ updateHistory });
        }
    } else {
        showEssayList({ updateHistory });
    }
}

function getShareableUrl(slug) {
    return `${window.location.origin}${window.location.pathname}#${slug}`;
}

// Sharing Functions
async function shareArticle(slug) {
    const article = essaysData.find(essay => 
        generateArticleSlug(essay.title) === slug
    );
    
    if (!article) return;
    
    const shareData = {
        title: article.title,
        text: article.subtitle,
        url: getShareableUrl(slug)
    };
    
    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        try {
            await navigator.share(shareData);
        } catch (error) {
            console.log('Share cancelled or failed:', error);
        }
    } else {
        // Fallback to copy URL
        copyArticleUrl(getShareableUrl(slug));
    }
}

async function copyArticleUrl(url) {
    try {
        await navigator.clipboard.writeText(url);
        // Show feedback
        const button = document.querySelector('.copy-url-button');
        if (button) {
            const originalText = button.textContent;
            button.textContent = 'Copied!';
            button.style.backgroundColor = '#28a745';
            setTimeout(() => {
                button.textContent = originalText;
                button.style.backgroundColor = '';
            }, 2000);
        }
    } catch (error) {
        console.error('Failed to copy URL:', error);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = url;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    }
}

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



function getPageNumbers(currentPage, totalPages) {
    const pages = [1];
    for (let page = currentPage - 1; page <= currentPage + 1; page++) {
        if (page > 1 && page < totalPages) {
            pages.push(page);
        }
    }
    if (totalPages > 1) {
        pages.push(totalPages);
    }
    return [...new Set(pages)].sort((a, b) => a - b);
}

function renderPagination(totalPages, currentPage) {
    const prev = currentPage > 1
        ? `<a class="pagination-link pagination-prev" href="${buildPageUrl(currentPage - 1)}" data-page="${currentPage - 1}" rel="prev">← Prev</a>`
        : '<span class="pagination-link pagination-prev is-disabled" aria-disabled="true">← Prev</span>';
    const next = currentPage < totalPages
        ? `<a class="pagination-link pagination-next" href="${buildPageUrl(currentPage + 1)}" data-page="${currentPage + 1}" rel="next">Next →</a>`
        : '<span class="pagination-link pagination-next is-disabled" aria-disabled="true">Next →</span>';

    const pageNumbers = getPageNumbers(currentPage, totalPages);
    const pageItems = [];
    let previousPage = null;

    pageNumbers.forEach(page => {
        if (previousPage !== null && page - previousPage > 1) {
            pageItems.push('<span class="pagination-ellipsis" aria-hidden="true">…</span>');
        }
        if (page === currentPage) {
            pageItems.push(`<span class="pagination-link is-current" aria-current="page">${page}</span>`);
        } else {
            pageItems.push(`<a class="pagination-link" href="${buildPageUrl(page)}" data-page="${page}" aria-label="Page ${page}">${page}</a>`);
        }
        previousPage = page;
    });

    return `<nav class="pagination" aria-label="Pagination">${prev}${pageItems.join('')}${next}</nav>`;
}

function renderPage(list, page) {
    const essaysContainer = document.getElementById('essays-container');
    if (!essaysContainer) {
        return;
    }

    const totalPages = getTotalPages(list);
    const currentPage = normalizePage(page, totalPages);
    const start = (currentPage - 1) * ESSAYS_PER_PAGE;
    const pageItems = list.slice(start, start + ESSAYS_PER_PAGE);

    const listItems = pageItems.map((essay) => {
        const essayId = essay.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const slug = generateArticleSlug(essay.title);
        return `
        <li id="essay-item-${essayId}" class="essay-item">
            <a href="#" class="essay-link" data-filename="${essay.file_link}" data-slug="${slug}" id="essay-link-${essayId}" aria-describedby="essay-subtitle-${essayId} essay-date-${essayId}">${essay.title}</a>
            <div id="essay-subtitle-${essayId}" class="subtitle">${essay.subtitle}</div>
            <time id="essay-date-${essayId}" class="metadata" datetime="${essay.date}">${essay.date}</time>
        </li>
    `}).join('');

    const pagination = totalPages > 1 ? renderPagination(totalPages, currentPage) : '';
    essaysContainer.innerHTML = `<ul id="essays-list" class="essays-list">${listItems}</ul>${pagination}`;

    // Add click handlers for essay links
    document.querySelectorAll('.essay-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const filename = link.getAttribute('data-filename');
            const slug = link.getAttribute('data-slug');
            loadAndDisplayArticle(filename, slug);
        });
        
        // Add touch event handling for better mobile experience
        link.addEventListener('touchstart', (e) => {
            e.currentTarget.style.opacity = '0.7';
        });
        
        link.addEventListener('touchend', (e) => {
            e.currentTarget.style.opacity = '1';
        });
    });

    const paginationNav = essaysContainer.querySelector('.pagination');
    if (paginationNav) {
        paginationNav.addEventListener('click', (e) => {
            const link = e.target.closest('a[data-page]');
            if (!link) {
                return;
            }
            e.preventDefault();
            navigateToPage(parseInt(link.getAttribute('data-page'), 10));
        });
    }
}

function navigateToPage(page) {
    const totalPages = getTotalPages(essaysData);
    const targetPage = normalizePage(page, totalPages);
    window.history.pushState({ page: targetPage }, '', buildPageUrl(targetPage));
    renderPage(essaysData, targetPage);
    scrollToEssaysTop();
}

function scrollToEssaysTop() {
    const essaysContainer = document.getElementById('essays-container');
    if (essaysContainer) {
        essaysContainer.scrollIntoView({ block: 'start' });
    }
}

function populateEssays(data) {
    // Sort essays by date (most recent first)
    const sortedData = sortEssaysByDate([...data], false);
    
    // Update article count in footer
    updateArticleCount(sortedData.length);
    
    renderPage(sortedData, getRequestedPage());
}

async function loadAndDisplayArticle(filename, slug = null, options = {}) {
    const { updateHistory = true } = options;
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
        
        // Generate slug if not provided
        if (!slug) {
            slug = generateArticleSlug(essay.title);
        }
        
        // Update URL
        if (updateHistory) {
            updateUrlForArticle(slug);
        }
        
        // Display the article
        displayArticle(essay, htmlContent, slug);
        
    } catch (error) {
        console.error('Error loading article:', error);
        const essaysContainer = document.getElementById('essays-container');
        essaysContainer.innerHTML = '<div class="error">Error loading article. Please try again.</div>';
    }
}

function displayArticle(essay, htmlContent, slug) {
    const essaysContainer = document.getElementById('essays-container');
    
    // Create a URL-friendly ID for the article
    const articleId = essay.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    
    const articleHtml = `
        <article id="article-${articleId}" class="article-view">
            <header class="article-header">
                <button class="back-button" onclick="showEssayList()" aria-label="Return to Articles list">← Back to Articles</button>
                <h1 id="article-title-${articleId}" class="article-title">${essay.title}</h1>
                <div id="article-subtitle-${articleId}" class="article-subtitle">${essay.subtitle}</div>
                <time id="article-date-${articleId}" class="article-metadata" datetime="${essay.date}">${essay.date}</time>
                <div class="article-actions">
                    <button class="share-button" onclick="shareArticle('${slug}')" aria-label="Share this article">
                        📤 Share Article
                    </button>
                    <button class="copy-url-button" onclick="copyArticleUrl(getShareableUrl('${slug}'))" aria-label="Copy article URL">
                        🔗 Copy Link
                    </button>
                </div>
            </header>
            <main id="article-content-${articleId}" class="article-content">
                ${htmlContent}
            </main>
        </article>
    `;
    
    essaysContainer.innerHTML = articleHtml;
    currentArticle = essay;
}

function showEssayList(options = {}) {
    const { updateHistory = true } = options;
    // Clear URL hash while keeping the current page in the query string
    if (updateHistory) {
        updateUrlForArticle(null);
    }
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
        essaysData = essaysData.filter(essay => {
            const titleLower = essay.title.toLowerCase();
            return essay.title !== "Page not found" && 
                   essay.title !== "Coming Soon" &&
                   !titleLower.includes("test");
        });

        // Sort essays once so pagination and article lookups share the same order
        essaysData = sortEssaysByDate(essaysData, false);
        
        // Remove loading message
        if (loadingElement) {
            loadingElement.remove();
        }
        
        // Handle URL navigation
        handleUrlNavigation({ updateHistory: false });
        
        // Add browser history support
        window.addEventListener('popstate', () => {
            handleUrlNavigation({ updateHistory: false });
        });
        
    } catch (error) {
        console.error('Error initializing articles:', error);
        const essaysContainer = document.getElementById('essays-container');
        essaysContainer.innerHTML = '<div class="error">Error loading articles. Please try refreshing the page.</div>';
        updateArticleCount(0);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeEssays);
