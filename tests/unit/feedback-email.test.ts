// Tests for the feedback email template.
//
// Privacy: confirm we never accidentally inline server-side context the
// user didn't type (commission amounts, kilo margin, etc.). The template
// should only render the user-typed message plus the explicit metadata
// fields they expect (URL, role, timestamp).

import { describe, it, expect } from 'vitest';
import { renderFeedbackEmail, type FeedbackEmailData } from '@/lib/email-templates/feedback';

const baseData: FeedbackEmailData = {
  userName: 'Hunter Helton',
  userEmail: 'hunter@example.com',
  userRole: 'rep',
  url: '/dashboard/projects/proj_abc123',
  message: 'The setter dropdown clears when I select a blitz mid-form.',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120',
  createdAt: '2026-05-12T20:15:00.000Z',
};

describe('renderFeedbackEmail', () => {
  it('subject includes the user name and a preview of the message', () => {
    const { subject } = renderFeedbackEmail(baseData);
    expect(subject).toContain('Hunter Helton');
    expect(subject).toMatch(/setter dropdown/i);
  });

  it('subject truncates messages longer than 60 chars with an ellipsis', () => {
    const long = renderFeedbackEmail({
      ...baseData,
      message: 'a'.repeat(200),
    });
    expect(long.subject.length).toBeLessThan(100);
    expect(long.subject).toContain('…');
  });

  it('body includes the user message verbatim (HTML-escaped)', () => {
    const { html } = renderFeedbackEmail(baseData);
    expect(html).toContain('The setter dropdown clears when I select a blitz mid-form.');
  });

  it('body includes user role and email for admin context', () => {
    const { html } = renderFeedbackEmail(baseData);
    expect(html).toContain('rep');
    expect(html).toContain('hunter@example.com');
  });

  it('escapes HTML in user-supplied content', () => {
    const malicious = renderFeedbackEmail({
      ...baseData,
      message: '<script>alert("xss")</script> & "quotes" & \'apostrophes\'',
      userName: '<b>Bad Name</b>',
    });
    expect(malicious.html).not.toContain('<script>');
    expect(malicious.html).toContain('&lt;script&gt;');
    expect(malicious.html).toContain('&quot;');
  });

  it('does NOT include sensitive financial context not provided in input', () => {
    // The template should ONLY render what's passed in. No commission
    // numbers, kilo margin, baseline rates, etc. — even if the caller
    // accidentally passed extra data, the type system prevents it.
    const { html } = renderFeedbackEmail(baseData);
    // Strip inline CSS so we don't false-positive on `margin:0` etc.
    const stripStyle = html.replace(/style="[^"]*"/g, '');
    expect(stripStyle.toLowerCase()).not.toContain('kilo margin');
    expect(stripStyle.toLowerCase()).not.toContain('commission');
    expect(stripStyle.toLowerCase()).not.toContain('baseline');
    expect(stripStyle).not.toMatch(/\$[\d,]+/); // no dollar amounts
  });

  it('renders without a URL when none provided', () => {
    const { html } = renderFeedbackEmail({ ...baseData, url: null });
    // Should not throw, should not include the URL block
    expect(html).toBeTruthy();
    expect(html).not.toContain('Page:');
  });

  it('renders without userAgent when none provided', () => {
    const { html } = renderFeedbackEmail({ ...baseData, userAgent: null });
    expect(html).toBeTruthy();
    expect(html).not.toContain('User agent:');
  });

  it('preserves newlines in the message via white-space:pre-wrap', () => {
    const multiline = renderFeedbackEmail({
      ...baseData,
      message: 'Line one\nLine two\nLine three',
    });
    expect(multiline.html).toContain('Line one\nLine two\nLine three');
    // Style attribute on the blockquote ensures newlines render
    expect(multiline.html).toMatch(/white-space:\s*pre-wrap/);
  });

  it('renders the screenshot inline when a URL is supplied', () => {
    const url = 'https://blob.example.com/feedback/abc/1700000000-screenshot.jpg';
    const withShot = renderFeedbackEmail({ ...baseData, screenshotUrl: url });
    expect(withShot.html).toContain('Screenshot at submission');
    expect(withShot.html).toContain(url);
    expect(withShot.html).toMatch(new RegExp(`<img[^>]+src="${url.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}"`));
  });

  it('renders the URL as plaintext-readable copy so plain readers see the link', () => {
    // Resend auto-derives plaintext from HTML; the heading paragraph
    // survives but <img> tags are stripped. By printing the URL inside
    // the heading text we guarantee non-HTML readers still get the link.
    const url = 'https://blob.example.com/feedback/abc/1700000000-screenshot.jpg';
    const { html } = renderFeedbackEmail({ ...baseData, screenshotUrl: url });
    expect(html).toMatch(/Screenshot at submission:[^<]*https:\/\/blob\.example\.com/);
  });

  it('omits the screenshot block when no URL is supplied', () => {
    const { html } = renderFeedbackEmail(baseData);
    expect(html).not.toContain('Screenshot at submission');
  });

  it('omits the screenshot block when URL is null', () => {
    const { html } = renderFeedbackEmail({ ...baseData, screenshotUrl: null });
    expect(html).not.toContain('Screenshot at submission');
  });
});
