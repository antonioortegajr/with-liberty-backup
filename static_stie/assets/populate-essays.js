let showHTML = false; // Default to showing markdown since we're loading from markdown files
let essaysData = [];
let currentArticle = null;
let activeSearchQuery = '';
let filteredEssays = [];
let searchDebounceTimer = null;
let essaysLastModified = null;
let searchIndex = null;
let searchIndexPromise = null;

const ESSAYS_PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_INDEX_URL = './search-index.json';

// URL Routing Functions
function getArticleSlugFromUrl() {
    const hash = window.location.hash;
    return hash ? hash.substring(1) : null;
}

// Footnote anchors (#fn-2, #fnref-2) must not be treated as article slugs by
// the hash router (#6).
function isFootnoteHash(hash) {
    const value = String(hash || '').replace(/^#/, '');
    return value.startsWith('fn-') || value.startsWith('fnref-');
}

function getRequestedPage() {
    const rawPage = new URLSearchParams(window.location.search).get('page');
    if (rawPage === null || !/^\d+$/.test(rawPage)) {
        return 1;
    }
    const page = parseInt(rawPage, 10);
    return page > 0 ? page : 1;
}

function getSearchQueryFromUrl() {
    return (new URLSearchParams(window.location.search).get('q') || '').trim();
}

function syncSearchStateFromUrl() {
    activeSearchQuery = getSearchQueryFromUrl();
    const searchInput = document.getElementById('essay-search');
    if (searchInput) {
        searchInput.value = activeSearchQuery;
    }
}

function normalizeSearchText(text) {
    return String(text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[.\u2018\u2019\u201A\u201B\u2032\u2035'`]/g, '')
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036"]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function getSearchTerms(query) {
    return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

function getEssaySearchWords(essay) {
    return normalizeSearchText(`${essay.title} ${essay.subtitle}`)
        .split(/\s+/)
        .filter(Boolean);
}

function wordsMatchTerms(words, terms) {
    return terms.every(term => words.some(word => word.startsWith(term)));
}

function filterEssaysByQuery(list, query, index = null) {
    const terms = getSearchTerms(query);
    if (terms.length === 0) {
        return list;
    }

    const titleMatches = [];
    const bodyMatches = [];

    list.forEach(essay => {
        const titleWords = getEssaySearchWords(essay);
        if (wordsMatchTerms(titleWords, terms)) {
            titleMatches.push(essay);
            return;
        }

        if (!index) {
            return;
        }

        const bodyWords = index[essay.file_link] || [];
        if (wordsMatchTerms(titleWords.concat(bodyWords), terms)) {
            bodyMatches.push(essay);
        }
    });

    return titleMatches.concat(bodyMatches);
}

function normalizeSearchIndex(index) {
    const normalized = {};
    Object.keys(index || {}).forEach(fileLink => {
        normalized[fileLink] = normalizeSearchText(index[fileLink])
            .split(/\s+/)
            .filter(Boolean);
    });
    return normalized;
}

function rerunActiveSearch() {
    if (!activeSearchQuery || currentArticle || getArticleSlugFromUrl()) {
        return;
    }
    populateEssays(essaysData);
}

function ensureSearchIndexLoaded() {
    if (searchIndex) {
        return;
    }

    if (!searchIndexPromise) {
        searchIndexPromise = fetch(SEARCH_INDEX_URL)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to load search index: ${response.status}`);
                }
                return response.json();
            })
            .then(rawIndex => {
                searchIndex = normalizeSearchIndex(rawIndex);
                return searchIndex;
            })
            .catch(error => {
                console.error('Error loading search index:', error);
                searchIndex = {};
                return searchIndex;
            });

        searchIndexPromise.then(rerunActiveSearch);
    }
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

function buildSearchUrl(query, page) {
    const params = new URLSearchParams(window.location.search);

    if (query) {
        params.set('q', query);
        params.set('page', String(page));
    } else {
        params.delete('q');
        if (page > 1) {
            params.set('page', String(page));
        } else {
            params.delete('page');
        }
    }

    const search = params.toString();
    return `${window.location.pathname}${search ? `?${search}` : ''}`;
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
    if (isFootnoteHash(window.location.hash)) {
        return;
    }
    syncSearchStateFromUrl();
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

// Bold and italics. Substack exports italics as _text_ as well as *text* (#12).
function renderEmphasis(text) {
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong class="emphasis">$1</strong>');
    text = text.replace(/\*(.*?)\*/g, '<em class="emphasis">$1</em>');
    // Underscores only count at word edges, so snake_case names stay intact.
    // An italic run may span line breaks (song lyrics) but not a blank line.
    text = text.replace(/(^|[^\w\\])_(?=\S)((?:[^_\n]|\n(?!\n))*?[^\s_])_(?!\w)/gm,
        '$1<em class="emphasis">$2</em>');
    // Empty italics the scraper leaves behind, e.g. "in __ 1892"
    text = text.replace(/(\s)__[ \t]+/g, '$1');
    return text;
}

// Drop markdown backslash escapes, e.g. \( -> (
function unescapeMarkdown(text) {
    return text.replace(/\\([\\`*_{}\[\]()#+\-.!])/g, '$1');
}

function escapeAttr(text) {
    return text.replace(/&(?![a-z]+;|#\d+;)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Decorative square thumbnail shown to the left of an essay title (#10).
function renderThumbnail(thumbnail) {
    if (!thumbnail) {
        return '';
    }
    return `<img class="essay-thumbnail" src="${escapeAttr(thumbnail)}" width="80" height="80" loading="lazy" decoding="async" alt="">`;
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

    // Pull images and links out into placeholders first, so the emphasis rules
    // below can't touch the underscores and asterisks inside their URLs.
    const tokens = [];
    const stash = (rendered) => `\u0000${tokens.push(rendered) - 1}\u0000`;
    const imageTag = (alt, src) =>
        `<img src="${escapeAttr(unescapeMarkdown(src))}" alt="${escapeAttr(unescapeMarkdown(alt))}" class="article-image" style="max-width: 100%; height: auto; display: block; margin: 20px auto;">`;
    // A URL may contain backslash-escaped parentheses, e.g. ..._\(CTE\)
    const URL = '((?:\\\\.|[^)\\\\\\n])+)';

    // Substack wraps every image in a link to the full-size image file. Render
    // just the image; the wrapper link is what made paragraphs clickable (#35).
    html = html.replace(new RegExp(`\\[!\\[([^\\]]*)\\]\\(${URL}\\)\\]\\(${URL}\\)`, 'g'),
        (match, alt, src) => stash(imageTag(alt, src)));

    html = html.replace(new RegExp(`!\\[([^\\]]*)\\]\\(${URL}\\)`, 'g'),
        (match, alt, src) => stash(imageTag(alt, src)));

    const externalLinkTag = (url) => {
        const target = unescapeMarkdown(url);
        return `<a href="${escapeAttr(target)}" target="_blank" rel="noopener noreferrer" class="external-link">${escapeAttr(target)}</a>`;
    };

    const linkTag = (href, inner) => {
        const target = unescapeMarkdown(href);
        // Substack footnotes are links whose text is only the number and whose
        // URL points at a #footnote- anchor. Body references use
        // #footnote-<n>-<id>; the end-of-article source list uses
        // #footnote-anchor-<n>-<id> (#36). Link them to anchors on this page
        // instead of back to Substack (#6).
        if (/^\d+$/.test(inner) && target.includes('#footnote-')) {
            const number = inner;
            const isSource = target.includes('#footnote-anchor-');
            const className = isSource ? 'footnote-number' : 'footnote-ref';
            const id = isSource ? `fn-${number}` : `fnref-${number}`;
            const targetId = isSource ? `fnref-${number}` : `fn-${number}`;
            return `<a id="${id}" href="#${targetId}" data-footnote-target="${targetId}"><sup class="${className}">${number}</sup></a>`;
        }
        return `<a href="${escapeAttr(target)}" target="_blank" rel="noopener noreferrer" class="external-link">${inner}</a>`;
    };

    // A link wrapped around a whole heading (post cards): link inside the heading
    html = html.replace(new RegExp(`\\[\\s*<h([23]) ([^>]*)>([^<]*)</h\\1>\\s*\\]\\(${URL}\\)`, 'g'),
        (match, level, attrs, text, href) => stash(`<h${level} ${attrs}>${linkTag(href, renderEmphasis(text.trim()))}</h${level}>`));

    // Link text may wrap onto a second line, but never across a blank line
    html = html.replace(new RegExp(`\\[((?:[^\\]\\n]|\\n(?!\\n))+)\\]\\(${URL}\\)`, 'g'),
        (match, text, href) => stash(linkTag(href, renderEmphasis(text))));

    // Most footnote sources are a bare URL on its own line. A paragraph that
    // is only a URL (optionally in angle brackets) becomes a link, as does an
    // angle-bracket URL anywhere. Stash them so the emphasis rules cannot
    // mangle underscores or asterisks inside the URL (#6).
    const HTTP_URL = 'https?:\\/\\/[^\\s<>]+';
    html = html.replace(new RegExp(`(^|\\n\\n)[ \\t]*(?:<(${HTTP_URL})>|(${HTTP_URL}))[ \\t]*(?=\\n\\n|$)`, 'g'),
        (match, lead, bracketed, bare) => `${lead}${stash(externalLinkTag(bracketed || bare))}`);

    html = html.replace(/<(https?:\/\/[^\s<>]+)>/g, (match, url) => stash(externalLinkTag(url)));

    // Embedded-post cards: one link wrapped around an image, a title and a
    // "Read full story" link, across several paragraphs. The card already
    // links to the post, so drop the outer wrapper and keep the contents.
    html = html.replace(new RegExp(`\\[(\\u0000\\d+\\u0000\\n\\n[^\\]]*?)\\]\\(${URL}\\)`, 'g'), '$1');

    html = renderEmphasis(html);

    // Tokens can nest (a link wrapped around an image), so restore until done
    while (html.includes('\u0000')) {
        html = html.replace(/\u0000(\d+)\u0000/g, (match, i) => tokens[Number(i)]);
    }

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

function formatLastUpdated(lastModified) {
    if (!lastModified) {
        return null;
    }

    const date = new Date(lastModified);
    if (isNaN(date.getTime())) {
        return null;
    }

    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function updateArticleCount(count, lastModified = essaysLastModified) {
    const articleCountElement = document.getElementById('article-count');
    if (articleCountElement) {
        const articleText = count === 1 ? 'article' : 'articles';
        const countText = `${count} ${articleText} published`;
        const updatedText = formatLastUpdated(lastModified);

        if (updatedText) {
            articleCountElement.innerHTML = `${countText} · <span id="last-updated">Last updated ${updatedText}</span>`;
        } else {
            articleCountElement.textContent = countText;
        }
    }
}

function updateSearchStatus(matchCount, query) {
    const statusElement = document.getElementById('search-status');
    if (!statusElement) {
        return;
    }

    if (!query) {
        statusElement.hidden = true;
        statusElement.textContent = '';
        return;
    }

    statusElement.hidden = false;
    if (matchCount === 0) {
        statusElement.textContent = `No essays match “${query}”`;
    } else if (matchCount === 1) {
        statusElement.textContent = `1 essay matches “${query}”`;
    } else {
        statusElement.textContent = `${matchCount} essays match “${query}”`;
    }
}

function hideSearchStatus() {
    const statusElement = document.getElementById('search-status');
    if (statusElement) {
        statusElement.hidden = true;
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
        const thumbnail = renderThumbnail(essay.thumbnail);
        const essayDetails = `<a href="#" class="essay-link" data-filename="${essay.file_link}" data-slug="${slug}" id="essay-link-${essayId}" aria-describedby="essay-subtitle-${essayId} essay-date-${essayId}">${essay.title}</a>
            <div id="essay-subtitle-${essayId}" class="subtitle">${essay.subtitle}</div>
            <time id="essay-date-${essayId}" class="metadata" datetime="${essay.date}">${essay.date}</time>
        `;
        const body = thumbnail
            ? `${thumbnail}
            <div class="essay-details">${essayDetails}</div>`
            : essayDetails;
        return `
        <li id="essay-item-${essayId}" class="essay-item${thumbnail ? ' has-thumbnail' : ''}">
            ${body}
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
    const totalPages = getTotalPages(filteredEssays);
    const targetPage = normalizePage(page, totalPages);
    window.history.pushState({ page: targetPage }, '', buildPageUrl(targetPage));
    renderPage(filteredEssays, targetPage);
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
    
    filteredEssays = filterEssaysByQuery(sortedData, activeSearchQuery, searchIndex);
    renderPage(filteredEssays, getRequestedPage());
    updateSearchStatus(filteredEssays.length, activeSearchQuery);

    if (activeSearchQuery) {
        ensureSearchIndexLoaded();
    }
}

function applySearch(query) {
    activeSearchQuery = query.trim();
    filteredEssays = filterEssaysByQuery(essaysData, activeSearchQuery, searchIndex);
    currentArticle = null;

    window.history.replaceState({}, '', buildSearchUrl(activeSearchQuery, 1));
    renderPage(filteredEssays, 1);
    updateSearchStatus(filteredEssays.length, activeSearchQuery);

    if (activeSearchQuery) {
        ensureSearchIndexLoaded();
    }
}

function handleSearchInput() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        const searchInput = document.getElementById('essay-search');
        applySearch(searchInput ? searchInput.value : '');
    }, SEARCH_DEBOUNCE_MS);
}

function initializeSearchControls() {
    syncSearchStateFromUrl();

    const searchInput = document.getElementById('essay-search');
    if (!searchInput) {
        return;
    }

    searchInput.addEventListener('input', handleSearchInput);
    searchInput.addEventListener('search', handleSearchInput);
}

async function loadAndDisplayArticle(filename, slug = null, options = {}) {
    const { updateHistory = true } = options;
    try {
        hideSearchStatus();

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
                <button class="back-button" onclick="showEssayList()" aria-label="Show all essays">All essays</button>
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

    // Footnote links jump within the article without touching the URL hash,
    // which the router uses for article slugs (#6).
    const articleContent = document.getElementById(`article-content-${articleId}`);
    if (articleContent) {
        articleContent.addEventListener('click', (event) => {
            const link = event.target.closest('a[data-footnote-target]');
            if (!link) {
                return;
            }
            event.preventDefault();
            const targetId = link.getAttribute('data-footnote-target');
            const target = document.getElementById(targetId);
            if (!target) {
                return;
            }
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.classList.add('footnote-highlight');
            setTimeout(() => target.classList.remove('footnote-highlight'), 2000);
        });
    }

    hideSearchStatus();
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
        initializeSearchControls();

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

        essaysLastModified = response.headers.get('Last-Modified');

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
