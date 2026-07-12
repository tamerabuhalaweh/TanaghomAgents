\set ON_ERROR_STOP on

SELECT set_config('tanaghom.shadow_campaign_name', :'campaign_name', false);

SELECT campaign.id, campaign.name, campaign.status,
       campaign.budget_target, campaign.revenue_target,
       count(DISTINCT strategy.id) AS strategies,
       count(DISTINCT content.id) AS content_items,
       count(DISTINCT approval.id) AS human_approvals
FROM tanaghom.campaigns campaign
LEFT JOIN tanaghom.campaign_strategies strategy ON strategy.campaign_id = campaign.id
LEFT JOIN tanaghom.content_items content ON content.campaign_id = campaign.id
LEFT JOIN tanaghom.content_approvals approval ON approval.content_item_id = content.id
WHERE campaign.name = :'campaign_name'
GROUP BY campaign.id;

DO $$
DECLARE
  v_campaign tanaghom.campaigns%ROWTYPE;
BEGIN
  SELECT * INTO v_campaign FROM tanaghom.campaigns
  WHERE name = current_setting('tanaghom.shadow_campaign_name')
  ORDER BY created_at DESC LIMIT 1;
  IF v_campaign.id IS NULL OR v_campaign.status <> 'awaiting_approval'
     OR v_campaign.budget_target <> 0 OR v_campaign.revenue_target <> 0 THEN
    RAISE EXCEPTION 'shadow campaign did not stop at the zero-budget approval gate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tanaghom.campaign_strategies WHERE campaign_id = v_campaign.id) THEN
    RAISE EXCEPTION 'strategy evidence is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tanaghom.content_items
    WHERE campaign_id = v_campaign.id AND status = 'pending_approval'
  ) THEN
    RAISE EXCEPTION 'pending approval content is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tanaghom.content_approvals approval
    JOIN tanaghom.content_items content ON content.id = approval.content_item_id
    WHERE content.campaign_id = v_campaign.id
  ) THEN
    RAISE EXCEPTION 'shadow run must not create a human approval';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tanaghom.agent_jobs job
    WHERE job.campaign_id = v_campaign.id
      AND job.job_type NOT IN ('campaign.strategy.generate', 'campaign.content.generate')
  ) THEN
    RAISE EXCEPTION 'shadow run created an unauthorized job type';
  END IF;
END;
$$;
