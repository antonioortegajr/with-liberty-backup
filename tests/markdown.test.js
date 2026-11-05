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
const { markdownToHtml } = sandbox;

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
