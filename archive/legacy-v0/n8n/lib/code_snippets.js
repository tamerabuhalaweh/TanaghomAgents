/**
 * Reference Code-node logic for n8n workflows.
 * These snippets are embedded in the workflow JSON exports.
 * Keep them in sync when editing workflows in the n8n UI.
 */

// ---------------------------------------------------------------------------
// Agent 1 — validate campaign inputs before LLM
// ---------------------------------------------------------------------------
function agent1ValidateInputs(campaign) {
  const missing = [];
  const audience = campaign.target_audience || {};
  if (!campaign.brief || String(campaign.brief).trim().length < 20) {
    missing.push('brief');
  }
  if (!campaign.product_type) missing.push('product_type');

  const geos = audience.geographies || audience.geography || audience.countries;
  if (!geos || (Array.isArray(geos) && geos.length === 0)) {
    missing.push('target_audience.geographies');
  }
  const hasAge =
    audience.age_min != null ||
    audience.age_max != null ||
    audience.age_range ||
    audience.description;
  if (!hasAge) missing.push('target_audience.age_range_or_description');

  return {
    ok: missing.length === 0,
    missing_fields: missing,
    message:
      missing.length === 0
        ? null
        : `Missing critical fields: ${missing.join(', ')}. Do not invent values.`,
  };
}

// ---------------------------------------------------------------------------
// Agent 1 — parse LLM JSON strategy response
// ---------------------------------------------------------------------------
function agent1ParseStrategy(rawText) {
  let text = String(rawText || '').trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  const data = JSON.parse(text);
  if (data.status === 'blocked_missing_info') {
    return { kind: 'blocked', data };
  }
  if (data.status !== 'ok') {
    throw new Error(`Unexpected strategy status: ${data.status}`);
  }
  if (!data.positioning || !Array.isArray(data.key_messages) || data.key_messages.length < 3) {
    throw new Error('Strategy missing positioning or key_messages (need 3–5)');
  }
  if (!Array.isArray(data.content_pillars) || data.content_pillars.length < 4) {
    throw new Error('Strategy needs 4–8 content_pillars');
  }
  if (!Array.isArray(data.channels) || data.channels.length < 1) {
    throw new Error('Strategy needs at least one channel');
  }
  return { kind: 'ok', data };
}

// ---------------------------------------------------------------------------
// Agent 2 — parse content items
// ---------------------------------------------------------------------------
function agent2ParseItems(rawText) {
  let text = String(rawText || '').trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  const data = JSON.parse(text);
  const items = Array.isArray(data) ? data : data.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Content producer returned no items');
  }
  return items.map((item) => {
    if (!item.channel || !item.draft_copy) {
      throw new Error('Each item requires channel and draft_copy');
    }
    return {
      channel: String(item.channel).toLowerCase(),
      content_type: item.content_type || 'post',
      content_pillar: item.content_pillar || null,
      draft_copy: item.draft_copy,
      media_brief: item.media_brief || null,
      scheduled_time: item.scheduled_time_suggestion || null,
    };
  });
}

// ---------------------------------------------------------------------------
// Agent 3 — Postiz payload builder
// ---------------------------------------------------------------------------
function buildPostizPayload({ content, channel, integrationId, settings, scheduledTime, mediaUrl }) {
  const type = scheduledTime && new Date(scheduledTime) > new Date() ? 'schedule' : 'now';
  const date = scheduledTime || new Date().toISOString();
  const image = mediaUrl
    ? [{ id: 'external', path: mediaUrl }]
    : [];

  const defaultSettings = {
    instagram: { __type: 'instagram', post_type: 'post' },
    tiktok: {
      __type: 'tiktok',
      privacy_level: 'PUBLIC_TO_EVERYONE',
      duet: false,
      stitch: false,
      comment: true,
      autoAddMusic: false,
      brand_content_toggle: false,
      brand_organic_toggle: false,
      content_posting_method: 'DIRECT_POST',
    },
    facebook: { __type: 'facebook' },
    linkedin: { __type: 'linkedin' },
  };

  return {
    type,
    date,
    shortLink: false,
    tags: [],
    posts: [
      {
        integration: { id: integrationId },
        value: [{ content, image }],
        settings: settings || defaultSettings[channel] || { __type: channel },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Shared — strip markdown fences from LLM output
// ---------------------------------------------------------------------------
function parseJsonLoose(rawText) {
  let text = String(rawText || '').trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  return JSON.parse(text);
}

module.exports = {
  agent1ValidateInputs,
  agent1ParseStrategy,
  agent2ParseItems,
  buildPostizPayload,
  parseJsonLoose,
};
