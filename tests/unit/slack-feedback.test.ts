import { describe, expect, it, vi } from 'vitest';
import {
  buildFeedbackSlackPayload,
  postFeedbackToSlack,
  type FeedbackSlackData,
} from '@/lib/slack-feedback';

const baseData: FeedbackSlackData = {
  id: 'fb_123',
  userName: 'Hunter Helton',
  userEmail: 'hunter@example.com',
  userRole: 'rep',
  url: '/dashboard/projects/proj_abc123',
  message: 'The setter dropdown clears when I select a blitz mid-form.',
  userAgent: 'Mozilla/5.0 Chrome/120',
  createdAt: '2026-05-12T20:15:00.000Z',
  screenshotUrl: 'https://blob.example.com/feedback/fb_123/screenshot.jpg',
};

describe('buildFeedbackSlackPayload', () => {
  it('builds a Slack payload with the triage context Jarvis needs', () => {
    const payload = buildFeedbackSlackPayload(baseData);
    const rendered = JSON.stringify(payload);

    expect(payload.text).toContain('New Kilo feedback from Hunter Helton');
    expect(rendered).toContain('fb_123');
    expect(rendered).toContain('/dashboard/projects/proj_abc123');
    expect(rendered).toContain('Jarvis: triage this Kilo feedback');
    expect(rendered).toContain('https://blob.example.com/feedback/fb_123/screenshot.jpg');
    expect(rendered).toContain('"type":"image"');
    expect(rendered).toContain('"alt_text":"Kilo feedback screenshot"');
  });

  it('escapes Slack control characters in user-supplied values', () => {
    const payload = buildFeedbackSlackPayload({
      ...baseData,
      userName: '<bad> & user',
      message: 'This <script> & that > thing',
    });
    const rendered = JSON.stringify(payload);

    expect(rendered).not.toContain('<script>');
    expect(rendered).toContain('&lt;script&gt;');
    expect(rendered).toContain('&amp;');
  });
});

describe('postFeedbackToSlack', () => {
  it('posts the JSON payload to the configured webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await postFeedbackToSlack('https://hooks.slack.test/services/abc', baseData);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.test/services/abc',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  it('times out instead of hanging the feedback request when Slack stalls', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = postFeedbackToSlack('https://hooks.slack.test/services/abc', baseData, 100);
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toEqual({
      ok: false,
      error: 'Slack webhook timed out after 100ms',
    });
    vi.useRealTimers();
  });
});
