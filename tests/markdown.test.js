// Tests for the static site's markdown renderer (static_stie/assets/populate-essays.js).
// Run with: node --test tests/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../static_stie/assets/populate-essays.js'), 'utf8');
const sandbox = { document: { addEventListener() {} }, window: {}, console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const { markdownToHtml, formatLastUpdated, renderThumbnail, isFootnoteHash, filterEssaysByQuery, filterEssays } = sandbox;

const IMG = 'https://substackcdn.com/image/fetch/$s_!0X-R!,w_1456,c_limit/abc_903x935.jpeg';
const IMG_FULL = 'https://substackcdn.com/image/fetch/$s_!0X-R!,f_auto/abc_903x935.jpeg';

// Every <a> must close, and no link may contain a paragraph break.
function assertLinksBalanced(html) {
    assert.equal((html.match(/<a /g) || []).length, (html.match(/<\/a>/g) || []).length, html);
    for (const a of html.match(/<a [^>]*>[\s\S]*?<\/a>/g) || []) {
        assert.ok(!a.includes('<p'), `link swallowed a paragraph: ${a}`);
    }
}

test('#35: linked image renders as a plain image and the caption is not a link', () => {
    const md = `[![](${IMG})](${IMG_FULL})Lighthouse. All rights reserved\n\nA subdued refrain is echoing.`;
    const html = markdownToHtml(md);
    assert.ok(html.includes(`<img src="${IMG}" alt=""`), html);
    assert.ok(!html.includes('<a '), html);
    assert.ok(html.includes('Lighthouse. All rights reserved'), html);
    assertLinksBalanced(html);
});

test('#35: image alt text is kept and quoted safely', () => {
    const html = markdownToHtml(`[![Say "hi"](${IMG})](${IMG_FULL})`);
    assert.ok(html.includes('alt="Say &quot;hi&quot;"'), html);
});

test('ordinary links still render', () => {
    const html = markdownToHtml('Read [the report](https://example.com/a?x=1&y=2) today.');
    assert.ok(html.includes('<a href="https://example.com/a?x=1&amp;y=2" target="_blank" rel="noopener noreferrer" class="external-link">the report</a>'), html);
});

test('escaped parentheses stay inside the link URL', () => {
    const html = markdownToHtml('See [CTE](https://www.alz.org/related_conditions/encephalopathy-\\(cte\\)#text) here.');
    assert.ok(html.includes('href="https://www.alz.org/related_conditions/encephalopathy-(cte)#text"'), html);
    assertLinksBalanced(html);
});

test('#12: underscore italics render as <em>', () => {
    const html = markdownToHtml('_How can I possibly make a difference? I’m just one person._');
    assert.ok(html.includes('<em class="emphasis">How can I possibly make a difference? I’m just one person.</em>'), html);
    assert.ok(!html.includes('_'), html);
});

test('#12: underscore italics mid-sentence and across a line break', () => {
    const html = markdownToHtml('we ask, _Is it still ok to be happy?_ Are we\n\n_So come on down  \nAt rich folks_');
    assert.ok(html.includes('<em class="emphasis">Is it still ok to be happy?</em>'), html);
    assert.ok(html.includes('<em class="emphasis">So come on down  <br>At rich folks</em>'), html);
});

test('#12: underscores in URLs and snake_case words are left alone', () => {
    const html = markdownToHtml('Follow @non_toxic_masculinity on [Instagram](https://www.instagram.com/non_toxic_masculinity_/).');
    assert.ok(html.includes('@non_toxic_masculinity on'), html);
    assert.ok(html.includes('href="https://www.instagram.com/non_toxic_masculinity_/"'), html);
    assert.ok(!html.includes('<em'), html);
});

test('#12: italic text that contains a link', () => {
    const html = markdownToHtml('_Read [this](https://example.com/a_b) now_');
    assert.ok(html.includes('<em class="emphasis">Read <a href="https://example.com/a_b"'), html);
    assertLinksBalanced(html);
});

test('#12: empty italics left by the scraper are removed', () => {
    const html = markdownToHtml('Wells wrote it in __ 1892.');
    assert.ok(html.includes('Wells wrote it in 1892.'), html);
});

test('#35: embedded post card is not wrapped in one giant link', () => {
    const post = 'https://heathermedwards.substack.com/p/the-us-states';
    const md = `[![The U.S. States](${IMG})\n\n#### The U.S. States\n\n[Heather M. Edwards](https://substack.com/profile/1)·Sep 10[Read full story](${post})](${post})\n\nNext paragraph.`;
    const html = markdownToHtml(md);
    assert.ok(!html.includes(']('), html);
    assert.ok(html.includes(`<a href="${post}" target="_blank" rel="noopener noreferrer" class="external-link">Read full story</a>`), html);
    assertLinksBalanced(html);
});

test('#35: link wrapped around a heading becomes a linked heading', () => {
    const post = 'https://heathermedwards.substack.com/p/made-in-the-usa';
    const html = markdownToHtml(`[\n\n## Made in the USA \n\n](${post})\n\nAfter.`);
    assert.ok(html.includes(`<h2 id="section-made-in-the-usa"><a href="${post}"`), html);
    assert.ok(!html.includes(']('), html);
    assertLinksBalanced(html);
});

test('link wrapped around an image and text renders both, no placeholder leak', () => {
    const html = markdownToHtml(`[![](${IMG})Abortion, Every Day](https://jessica.substack.com?utm_source=x)`);
    assert.ok(html.includes(`<a href="https://jessica.substack.com?utm_source=x"`), html);
    assert.ok(html.includes(`<img src="${IMG}"`), html);
    assert.ok(!html.includes('\u0000'), html);
});

test('italics never span a blank line', () => {
    const html = markdownToHtml('an _open underscore\n\nand another_ later');
    assert.ok(!html.includes('<em'), html);
});

test('#36: body footnote references render as superscript', () => {
    const url = 'https://example.com/post#footnote-2-157791656';
    const html = markdownToHtml(`Our neighbors.[2](${url}) agreed.`);
    const anchor = html.match(/<a [^>]*id="fnref-2"[^>]*>/);
    assert.ok(anchor, html);
    assert.ok(anchor[0].includes('href="#fn-2"'), html);
    assert.ok(anchor[0].includes('data-footnote-target="fn-2"'), html);
    assert.ok(!anchor[0].includes('target="_blank"'), html);
    assert.ok(html.includes('<sup class="footnote-ref">2</sup></a>'), html);
    assert.ok(!html.includes('>2</a>'), html);
});

test('#36: end-of-article footnote sources render as superscript', () => {
    const url = 'https://example.com/post#footnote-anchor-3-157791656';
    const html = markdownToHtml(`[3](${url})\n\nHeather M. Edwards, *A Source Title*.`);
    const anchor = html.match(/<a [^>]*id="fn-3"[^>]*>/);
    assert.ok(anchor, html);
    assert.ok(anchor[0].includes('href="#fnref-3"'), html);
    assert.ok(anchor[0].includes('data-footnote-target="fnref-3"'), html);
    assert.ok(!anchor[0].includes('target="_blank"'), html);
    assert.ok(html.includes('<sup class="footnote-number">3</sup></a>'), html);
    assert.ok(!html.includes('>3</a>'), html);
});

test('#36: numeric links that are not footnotes are left alone', () => {
    const html = markdownToHtml('See [2](https://example.com/page/2) for details.');
    assert.ok(html.includes('<a href="https://example.com/page/2" target="_blank" rel="noopener noreferrer" class="external-link">2</a>'), html);
    assert.ok(!html.includes('<sup'), html);
});

test('#6: footnote links point at anchors on the same page', () => {
    const bodyUrl = 'https://example.com/post#footnote-2-157791656';
    const sourceUrl = 'https://example.com/post#footnote-anchor-2-157791656';
    const html = markdownToHtml(`Body.[2](${bodyUrl})\n\n[2](${sourceUrl})\n\nSource.`);
    assert.ok(html.includes('href="#fn-2"'), html);
    assert.ok(html.includes('href="#fnref-2"'), html);
    assert.ok(!html.includes(`href="${bodyUrl}"`), html);
    assert.ok(!html.includes(`href="${sourceUrl}"`), html);
});

test('#6: a paragraph that is only a bare URL becomes an external link', () => {
    const url = 'https://example.com/a_b/c%20d';
    const html = markdownToHtml(url);
    assert.ok(html.includes(`<a href="${url}" target="_blank" rel="noopener noreferrer" class="external-link">${url}</a>`), html);
});

test('#6: an angle-bracket URL becomes an external link anywhere', () => {
    const url = 'https://example.com/a_b%20c';
    const html = markdownToHtml(`See <${url}> now.`);
    assert.ok(html.includes(`<a href="${url}" target="_blank" rel="noopener noreferrer" class="external-link">${url}</a>`), html);
});

test('#6: a bare URL in the middle of a sentence is not linked', () => {
    const url = 'https://example.com/a_b';
    const html = markdownToHtml(`Read ${url} for details.`);
    assert.ok(!html.includes('<a '), html);
    assert.ok(html.includes(url), html);
});

test('#6: footnote hashes are not treated as article slugs', () => {
    assert.equal(isFootnoteHash('#fn-2'), true);
    assert.equal(isFootnoteHash('fn-2'), true);
    assert.equal(isFootnoteHash('#fnref-2'), true);
    assert.equal(isFootnoteHash('fnref-2-157791656'), true);
    assert.equal(isFootnoteHash('#some-article-slug'), false);
    assert.equal(isFootnoteHash('#footnote-2-157791656'), false);
    assert.equal(isFootnoteHash(''), false);
});

test('#10: thumbnail renders an img with the escaped URL', () => {
    const url = 'https://substackcdn.com/image/fetch/$s_!0X-R!,w_160,h_160,c_fill/https%3A%2F%2Fexample.com%2Fa.jpg?x=1&y=2';
    const html = renderThumbnail(url);
    assert.ok(html.includes('class="essay-thumbnail"'), html);
    assert.ok(html.includes('width="80"'), html);
    assert.ok(html.includes('height="80"'), html);
    assert.ok(html.includes('loading="lazy"'), html);
    assert.ok(html.includes('decoding="async"'), html);
    assert.ok(html.includes('alt=""'), html);
    assert.ok(html.includes('src="https://substackcdn.com/image/fetch/$s_!0X-R!,w_160,h_160,c_fill/https%3A%2F%2Fexample.com%2Fa.jpg?x=1&amp;y=2"'), html);
});

test('#10: missing or empty thumbnail renders nothing', () => {
    assert.equal(renderThumbnail(), '');
    assert.equal(renderThumbnail(''), '');
    assert.equal(renderThumbnail(null), '');
});

test('#5: valid Last-Modified formats as a short local date', () => {
    const value = 'Thu, 05 Nov 2026 12:00:00 GMT';
    const formatted = formatLastUpdated(value);
    assert.match(formatted, /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    assert.equal(formatted, new Date(value).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }));
});

test('#5: missing Last-Modified returns null', () => {
    assert.equal(formatLastUpdated(null), null);
    assert.equal(formatLastUpdated(undefined), null);
    assert.equal(formatLastUpdated(''), null);
});

test('#5: invalid Last-Modified returns null', () => {
    assert.equal(formatLastUpdated('not a date'), null);
});

const searchEssays = [
    { title: 'Alpha Essay', subtitle: 'On liberty', date: 'Jan 3, 2024', file_link: 'alpha.md' },
    { title: 'Beta Essay', subtitle: 'On freedom', date: 'Jan 2, 2024', file_link: 'beta.md' },
    { title: 'Gamma Essay', subtitle: 'On something', date: 'Jan 1, 2024', file_link: 'gamma.md' },
];

test('#9: body-only matches are found through the search index', () => {
    const index = { 'beta.md': ['zebra'] };
    const result = filterEssaysByQuery(searchEssays, 'zebra', index);
    assert.equal(result.map(essay => essay.file_link).join(','), 'beta.md');
});

test('#9: title and subtitle matches come before body-only matches', () => {
    const essays = [
        { title: 'Zebra', subtitle: '', date: 'Jan 3, 2024', file_link: 'zebra.md' },
        { title: 'Liberty Essay', subtitle: '', date: 'Jan 2, 2024', file_link: 'liberty.md' },
        { title: 'Another', subtitle: '', date: 'Jan 1, 2024', file_link: 'another.md' },
    ];
    const index = {
        'zebra.md': ['liberty'],
        'liberty.md': [],
        'another.md': ['liberty'],
    };
    const result = filterEssaysByQuery(essays, 'liberty', index);
    assert.equal(result.map(essay => essay.file_link).join(','), 'liberty.md,zebra.md,another.md');
});

test('#9: multi-term queries require every term', () => {
    const index = {
        'alpha.md': ['alpha'],
        'beta.md': ['alpha', 'beta'],
        'gamma.md': ['beta'],
    };
    const result = filterEssaysByQuery(searchEssays, 'alpha beta', index);
    assert.equal(result.map(essay => essay.file_link).join(','), 'beta.md');
});

test('#9: query terms match word prefixes', () => {
    const index = { 'gamma.md': ['extraordinary'] };
    const result = filterEssaysByQuery(searchEssays, 'extra', index);
    assert.equal(result.map(essay => essay.file_link).join(','), 'gamma.md');
});

test('#9: without an index only title and subtitle matches are returned', () => {
    const titleResults = filterEssaysByQuery(searchEssays, 'liberty');
    assert.equal(titleResults.map(essay => essay.file_link).join(','), 'alpha.md');

    const bodyOnlyResults = filterEssaysByQuery(searchEssays, 'zebra');
    assert.equal(bodyOnlyResults.length, 0);
});

test('#7/#11: only test-article- files are filtered out', () => {
    const essays = [
        { title: 'Page not found', file_link: 'page-not-found.md' },
        { title: 'Coming Soon', file_link: 'coming-soon.md' },
        { title: "Alligator Alcatraz: MAGA's Latest Spectacle", file_link: 'posts/heathermedwards/alligator-alcatraz-magas-latest-spectacle.md' },
        { title: 'The Latest in MAGA Sycophancy', file_link: 'posts/heathermedwards/mt-trumpmore-the-latest-in-maga-sycophancy.md' },
        { title: 'Protest', file_link: 'posts/heathermedwards/protest.md' },
        { title: 'Test Article', file_link: 'posts/heathermedwards/test-article-hello.md' },
        { title: 'Test Article At Root', file_link: 'test-article-root.md' },
    ];
    const filtered = filterEssays(essays);
    assert.deepEqual(filtered.map(essay => essay.file_link), [
        'posts/heathermedwards/alligator-alcatraz-magas-latest-spectacle.md',
        'posts/heathermedwards/mt-trumpmore-the-latest-in-maga-sycophancy.md',
        'posts/heathermedwards/protest.md',
    ]);
});
