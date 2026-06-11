export interface FeedbackSlackData {
  id: string;
  userName: string;
  userEmail: string;
  userRole: string;
  url?: string | null;
  message: string;
  userAgent?: string | null;
  createdAt: string;
  screenshotUrl?: string | null;
}

interface SlackTextObject {
  type: 'mrkdwn' | 'plain_text';
  text: string;
}

interface SlackBlock {
  type: 'header' | 'section' | 'context' | 'divider' | 'image';
  text?: SlackTextObject;
  fields?: SlackTextObject[];
  elements?: SlackTextObject[];
  image_url?: string;
  alt_text?: string;
}

export interface SlackWebhookPayload {
  text: string;
  blocks: SlackBlock[];
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}...` : value;
}

function slackEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildFeedbackSlackPayload(data: FeedbackSlackData): SlackWebhookPayload {
  const preview = truncate(data.message.replace(/\s+/g, ' ').trim(), 120);
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'New Kilo feedback',
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*From:*\n${slackEscape(data.userName)} (${slackEscape(data.userRole)})`,
        },
        {
          type: 'mrkdwn',
          text: `*Email:*\n${slackEscape(data.userEmail)}`,
        },
        {
          type: 'mrkdwn',
          text: `*Feedback ID:*\n${slackEscape(data.id)}`,
        },
        {
          type: 'mrkdwn',
          text: `*Submitted:*\n${slackEscape(data.createdAt)}`,
        },
      ],
    },
  ];

  if (data.url) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Page:*\n\`${slackEscape(data.url)}\``,
      },
    });
  }

  blocks.push(
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Message:*\n>${slackEscape(data.message).replace(/\n/g, '\n>')}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: [
            'Jarvis: triage this Kilo feedback. Summarize severity, likely area, missing context, and whether Josh should be notified.',
            data.screenshotUrl ? `Screenshot: ${slackEscape(data.screenshotUrl)}` : null,
            data.userAgent ? `User agent: ${slackEscape(truncate(data.userAgent, 240))}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    },
  );

  if (data.screenshotUrl) {
    blocks.push({
      type: 'image',
      image_url: data.screenshotUrl,
      alt_text: 'Kilo feedback screenshot',
    });
  }

  return {
    text: `New Kilo feedback from ${slackEscape(data.userName)}: ${slackEscape(preview)}`,
    blocks,
  };
}

export async function postFeedbackToSlack(
  webhookUrl: string,
  data: FeedbackSlackData,
  timeoutMs = 1500,
): Promise<{ ok: true } | { ok: false; status?: number; error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildFeedbackSlackPayload(data)),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, status: response.status, error: await response.text() };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: `Slack webhook timed out after ${timeoutMs}ms` };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}
